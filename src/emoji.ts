import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * カラーの絵文字を、Type 3 フォントを使わずに PDF に入れる。
 *
 * Chromium（Skia）はカラー絵文字のフォントを Type 3 として PDF に入れるので、絵文字は白黒の
 * Noto Emoji で描いている。emoji: "twemoji" のときは、絵文字の字を透明にして残し、その上に
 * Twemoji の SVG を背景として重ねる。
 * - 字が残るので、PDF から文字としてコピーでき、字の検査（豆腐）もそのまま働く。
 * - 字の幅は白黒のときと同じ（Noto Emoji）なので、組みはほぼ変わらない。
 * - SVG は単純な図形だけなので、PDF ではベクターのまま入り、フォントも画像も増えない。
 */

export type EmojiMode = "text" | "twemoji";

export const EMOJI_MODES: readonly EmojiMode[] = ["text", "twemoji"];

export function isEmojiMode(value: unknown): value is EmojiMode {
  return (
    typeof value === "string" &&
    (EMOJI_MODES as readonly string[]).includes(value)
  );
}

/** mise run setup-fonts で Twemoji の SVG を置く場所。 */
export const BUNDLED_TWEMOJI_DIR = fileURLToPath(
  new URL("../fonts/twemoji", import.meta.url),
);

/** PDF に入れる Twemoji のクレジット（絵は CC BY 4.0）。 */
export const TWEMOJI_CREDIT =
  "絵文字の画像：Twemoji（© Twitter, Inc and other contributors、https://github.com/jdecked/twemoji）、CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）";

/** 絵文字の並び（ZWJ、異体字セレクタ、国旗、肌の色を含む）。ES2024 の v フラグを使う。 */
const EMOJI_SEQUENCE = new RegExp("\\p{RGI_Emoji}", "gv");

const VARIATION_TEXT = "︎";
const VARIATION_EMOJI = "️";
const ZWJ = "‍";

function toCodePoints(sequence: string): string[] {
  return [...sequence].map((char) => (char.codePointAt(0) ?? 0).toString(16));
}

/**
 * Twemoji の SVG のファイル名の候補（拡張子なし）。
 * Twemoji は、ZWJ を含まない並びでは U+FE0F を外した名前にしている。
 */
export function twemojiFileNames(sequence: string): string[] {
  const full = toCodePoints(sequence).join("-");
  const withoutVs = toCodePoints(
    [...sequence].filter((char) => char !== VARIATION_EMOJI).join(""),
  ).join("-");
  const names = sequence.includes(ZWJ) ? [full, withoutVs] : [withoutVs, full];
  return [...new Set(names)];
}

export interface TwemojiSource {
  /** 絵文字の並びの SVG を返す。なければ null。 */
  readSvg: (sequence: string) => string | null;
}

/** fonts/twemoji/ の SVG を読む。そろっていなければ理由を返す。 */
export function openTwemoji(
  twemojiDir: string = BUNDLED_TWEMOJI_DIR,
): { ok: true; source: TwemojiSource } | { ok: false; reason: string } {
  const svgDir = path.join(twemojiDir, "svg");
  if (
    !fs.existsSync(path.join(twemojiDir, "manifest.json")) ||
    !fs.existsSync(svgDir)
  ) {
    return {
      ok: false,
      reason: `${twemojiDir} がありません。mise run setup-fonts を実行してください。`,
    };
  }
  return {
    ok: true,
    source: {
      readSvg: (sequence) => {
        for (const name of twemojiFileNames(sequence)) {
          const file = path.join(svgDir, `${name}.svg`);
          if (fs.existsSync(file)) {
            return fs.readFileSync(file, "utf8");
          }
        }
        return null;
      },
    },
  };
}

export interface EmojiReplacement {
  html: string;
  /** 使った絵文字の CSS のクラス名と SVG。 */
  used: Map<string, string>;
  /** SVG がなく、白黒のまま残した絵文字。 */
  missing: Set<string>;
}

function className(sequence: string): string {
  return `twemoji-${twemojiFileNames(sequence)[0] ?? "x"}`;
}

/**
 * HTML の文字の部分にある絵文字を、Twemoji の span で包む。
 * タグの中（属性）、script、style、Mermaid の図（pre.mermaid）は変えない。
 * 異体字セレクタ U+FE0E（文字として描く指定）が続く絵文字は変えない。
 */
export function wrapEmoji(
  html: string,
  source: TwemojiSource,
): EmojiReplacement {
  const used = new Map<string, string>();
  const missing = new Set<string>();
  let skipUntil: RegExp | null = null;

  const parts = html.split(/(<[^>]*>)/);
  const out = parts.map((part) => {
    if (part.startsWith("<")) {
      if (skipUntil) {
        if (skipUntil.test(part)) {
          skipUntil = null;
        }
      } else if (/^<script\b/i.test(part)) {
        skipUntil = /^<\/script\s*>/i;
      } else if (/^<style\b/i.test(part)) {
        skipUntil = /^<\/style\s*>/i;
      } else if (/^<pre\b[^>]*\bclass="[^"]*\bmermaid\b/i.test(part)) {
        skipUntil = /^<\/pre\s*>/i;
      }
      return part;
    }
    if (skipUntil || part === "") {
      return part;
    }
    return part.replace(
      EMOJI_SEQUENCE,
      (sequence: string, offset: number, whole: string) => {
        if (whole.slice(offset + sequence.length).startsWith(VARIATION_TEXT)) {
          return sequence;
        }
        const svg = source.readSvg(sequence);
        if (svg === null) {
          missing.add(sequence);
          return sequence;
        }
        const name = className(sequence);
        used.set(name, svg);
        return `<span class="twemoji ${name}">${sequence}</span>`;
      },
    );
  });

  return { html: out.join(""), used, missing };
}

/** 使った絵文字の CSS。字は透明にし、SVG を背景として重ねる。 */
export function twemojiStyles(used: Map<string, string>): string {
  if (used.size === 0) {
    return "";
  }
  const images = [...used]
    .map(
      ([name, svg]) =>
        `.${name} { background-image: url("data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"); }`,
    )
    .join("\n");
  return `
    /* 絵文字：字は透明にして残し（コピーと字の検査のため）、Twemoji の SVG を重ねる。
       字の幅は白黒の Noto Emoji と同じにする（半角で描く等幅フォントの字にしない）。 */
    .twemoji {
      color: transparent;
      font-family: 'Noto Emoji', sans-serif;
      font-style: normal;
      font-weight: 400;
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
${images}`;
}
