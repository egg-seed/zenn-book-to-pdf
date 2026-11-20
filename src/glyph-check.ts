/**
 * 豆腐（フォントにない字。□ や .notdef になる）を、PDF を作る前に見つける。
 *
 * fonts/fonts.conf のように、fontconfig で見えるフォントを決めている（閉じ込めている）ときは、
 * 「見えるフォントのどれにもない字」が、そのまま「豆腐になる字」になる。
 * 見えるフォントの字の一覧は、Chromium と同じ fontconfig の設定（環境変数）で fc-list から取る。
 *
 * 豆腐は Type 3 ではないので、PDF のフォントの検査（font-check.ts）では見つからない。
 */

export type GlyphCheckMode = "warn" | "error" | "off";

export const GLYPH_CHECK_MODES: readonly GlyphCheckMode[] = [
  "warn",
  "error",
  "off",
];

export function isGlyphCheckMode(value: unknown): value is GlyphCheckMode {
  return (
    typeof value === "string" &&
    (GLYPH_CHECK_MODES as readonly string[]).includes(value)
  );
}

/** 調べる文字列。label は、足りない字がどこにあるかを示す名前（章の名前など）。 */
export interface TextSegment {
  label: string;
  text: string;
}

export interface MissingGlyph {
  char: string;
  codePoint: number;
  count: number;
  /** label ごとの回数（出てきた順）。 */
  locations: { label: string; count: number }[];
}

export type GlyphCheckResult =
  | { status: "checked"; checkedChars: number; missing: MissingGlyph[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export interface FcListResult {
  ok: boolean;
  stdout: string;
}

/**
 * fc-list の %{charset}（"20-7e a0 ff01-ff5e" のような 16 進の範囲の並び）を読む。
 * 1 行に 1 フォント。読めない語は無視する。
 */
export function parseFcCharsets(stdout: string): Set<number> {
  const covered = new Set<number>();
  for (const token of stdout.split(/\s+/)) {
    const match = /^([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(token);
    if (!match?.[1]) {
      continue;
    }
    const start = parseInt(match[1], 16);
    const end = match[2] ? parseInt(match[2], 16) : start;
    for (let codePoint = start; codePoint <= end; codePoint++) {
      covered.add(codePoint);
    }
  }
  return covered;
}

/**
 * fontconfig で見えるフォントが持つ字の一覧を作る。
 * runFcList は `fc-list --format=%{charset}\n` を、Chromium と同じ環境変数で実行する関数。
 */
export function listCoveredCodePoints(
  runFcList: () => FcListResult,
): { ok: true; covered: Set<number> } | { ok: false; error: string } {
  const result = runFcList();
  if (!result.ok) {
    return { ok: false, error: "fc-list を実行できませんでした" };
  }
  const covered = parseFcCharsets(result.stdout);
  if (covered.size === 0) {
    return { ok: false, error: "fc-list でフォントが見つかりませんでした" };
  }
  return { ok: true, covered };
}

/**
 * 字として描かない文字（豆腐にならない文字）。
 * 制御文字（Cc）、書式文字（Cf。ZWJ を含む）、結合文字（Mn・Me）、異体字セレクタ、空白の区切り。
 * 結合文字はフォントにないと崩れることがあるが、元の字と組で描かれるので対象外にする。
 */
const IGNORABLE =
  /^[\p{Cc}\p{Cf}\p{Mn}\p{Me}\p{Zl}\p{Zp}\p{Variation_Selector}]$/u;

export function isIgnorableChar(char: string): boolean {
  return IGNORABLE.test(char);
}

/** 文字列を1字ずつ調べ、一覧にない字を、字ごとにまとめる。字は最初に出てきた順に並べる。 */
export function findMissingGlyphs(
  segments: TextSegment[],
  covered: ReadonlySet<number>,
): { checkedChars: number; missing: MissingGlyph[] } {
  const missing = new Map<number, Map<string, number>>();
  const seen = new Set<number>();

  for (const { label, text } of segments) {
    for (const char of text) {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) {
        continue;
      }
      seen.add(codePoint);
      if (covered.has(codePoint) || isIgnorableChar(char)) {
        continue;
      }
      const locations = missing.get(codePoint) ?? new Map<string, number>();
      locations.set(label, (locations.get(label) ?? 0) + 1);
      missing.set(codePoint, locations);
    }
  }

  return {
    checkedChars: seen.size,
    missing: [...missing].map(([codePoint, locations]) => ({
      char: String.fromCodePoint(codePoint),
      codePoint,
      count: [...locations.values()].reduce((sum, n) => sum + n, 0),
      locations: [...locations].map(([label, count]) => ({ label, count })),
    })),
  };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTML の文字参照を戻す。知らない名前の参照はそのまま残す（名前は ASCII なので豆腐にはならない）。 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));/gi,
    (whole, hex?: string, dec?: string, name?: string) => {
      if (hex !== undefined || dec !== undefined) {
        const codePoint = hex !== undefined ? parseInt(hex, 16) : Number(dec);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
      }
      return NAMED_ENTITIES[name?.toLowerCase() ?? ""] ?? whole;
    },
  );
}

/** タグを外して、ページに出る文字だけにする。 */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<[^>]*>/g, " "),
  );
}

/**
 * buildBookHtml で組み立てた HTML を、章ごとの文字列に分ける。
 * 章より前は「表紙・目次」、章のあと（</main> より後ろ）は「奥付」とする。
 * Mermaid の図の文字（<pre class="mermaid"> の中）も、本文と一緒に調べる。
 */
export function extractTextSegments(html: string): TextSegment[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "");

  const chapterStart = /<section class="chapter" id="chapter-\d+">/g;
  const starts = [...body.matchAll(chapterStart)].map((m) => m.index);
  const mainEnd = body.lastIndexOf("</main>");

  if (starts.length === 0) {
    return [{ label: "本文", text: htmlToText(body) }];
  }

  const segments: TextSegment[] = [
    { label: "表紙・目次", text: htmlToText(body.slice(0, starts[0])) },
  ];
  starts.forEach((start, i) => {
    const next = starts[i + 1];
    const end = next ?? (mainEnd > start ? mainEnd : body.length);
    const chapterHtml = body.slice(start, end);
    const title = /<h1 class="chapter-title">([\s\S]*?)<\/h1>/.exec(
      chapterHtml,
    )?.[1];
    segments.push({
      label: title ? htmlToText(title).trim() : `第${i + 1}章`,
      text: htmlToText(chapterHtml),
    });
  });
  const lastStart = starts[starts.length - 1] ?? 0;
  if (mainEnd > lastStart) {
    segments.push({ label: "奥付", text: htmlToText(body.slice(mainEnd)) });
  }
  return segments;
}

/** 1 行に出す、足りない字の数の上限。 */
const MAX_LISTED = 30;

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function formatMissingGlyph(glyph: MissingGlyph): string {
  const places = glyph.locations
    .map(({ label, count }) => `${label}（${count}回）`)
    .join("、");
  return `   ${formatCodePoint(glyph.codePoint)} ${glyph.char}：${places}`;
}

export function formatGlyphCheckReport(result: GlyphCheckResult): {
  ok: boolean;
  lines: string[];
} {
  if (result.status === "skipped") {
    return { ok: true, lines: [`🔡 字の検査: ${result.reason}`] };
  }
  if (result.status === "failed") {
    return {
      ok: false,
      lines: [
        `⚠️  字の検査ができませんでした（${result.error}）。豆腐（フォントにない字）があるかは分かりません。`,
      ],
    };
  }
  if (result.missing.length === 0) {
    return {
      ok: true,
      lines: [
        `🔡 字: ${result.checkedChars} 種類の字が、すべてフォントにあります（豆腐なし）`,
      ],
    };
  }

  const listed = result.missing.slice(0, MAX_LISTED).map(formatMissingGlyph);
  const rest = result.missing.length - listed.length;
  return {
    ok: false,
    lines: [
      `⚠️  フォントにない字が ${result.missing.length} 種類あります（PDF では豆腐 □ になります）：`,
      ...listed,
      ...(rest > 0 ? [`   ほか ${rest} 種類`] : []),
      "   直し方は docs/font-setup.md の「豆腐（フォントにない字）」を見てください。",
    ],
  };
}

/**
 * 字を調べる。fontconfig を使うのは Linux の Chromium だけなので、ほかの OS では調べない。
 * runFcList は、Chromium と同じ環境変数で fc-list を実行する関数。
 */
export function checkGlyphs(
  segments: TextSegment[],
  options: { platform: NodeJS.Platform; runFcList: () => FcListResult },
): GlyphCheckResult {
  if (options.platform !== "linux") {
    return {
      status: "skipped",
      reason:
        "Linux でだけ行います（Chromium が fontconfig でフォントを選ぶのは Linux だけのため）。",
    };
  }
  const listed = listCoveredCodePoints(options.runFcList);
  if (!listed.ok) {
    return { status: "failed", error: listed.error };
  }
  return { status: "checked", ...findMissingGlyphs(segments, listed.covered) };
}

/** glyphCheck が "error" で、フォントにない字があった（または調べられなかった）とき。 */
export class GlyphCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlyphCheckError";
  }
}

export interface GlyphCheckOutput {
  log: (line: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
}

/**
 * 結果を出す。"error" で問題があれば、PDF を作らずに止めるため GlyphCheckError を投げる。
 * "off" のときは何も出さない（呼ぶ前に検査もしない）。
 */
export function reportGlyphCheck(
  result: GlyphCheckResult,
  mode: GlyphCheckMode,
  output: GlyphCheckOutput = console,
): void {
  if (mode === "off") {
    return;
  }
  const report = formatGlyphCheckReport(result);
  if (!report.ok && mode === "error") {
    report.lines.forEach((line) => output.error(line));
    throw new GlyphCheckError(
      "字の検査で問題が見つかったので、PDF を作りませんでした（glyphCheck: error）。",
    );
  }
  report.lines.forEach((line) => (report.ok ? output.log : output.warn)(line));
}
