import path from "path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  PDFHexString,
  type PDFObject,
} from "pdf-lib";

/**
 * PDF に入ったフォントを調べ、Type 3 のフォントと埋め込まれていないフォントを見つける。
 *
 * Chromium（Skia）は OTF/CFF のフォントやカラー絵文字を Type 3 として PDF に入れる。
 * Type 3 は入稿先によっては受け付けられない（技術書典では「T3_Font」として非承認になった）。
 *
 * 対象は Chromium が作る PDF とする。フォントの辞書は間接オブジェクトから集めるので、
 * ページや Form XObject の中に直接書かれた（参照でない）フォントの辞書は見ない。
 */

export type FontCheckMode = "warn" | "error" | "off";

export const FONT_CHECK_MODES: readonly FontCheckMode[] = [
  "warn",
  "error",
  "off",
];

export type FontKind = "embedded" | "type3" | "notEmbedded";

export interface FontReport {
  /** サブセットの接頭辞（AAAAAA+）を外した書体名。 */
  name: string;
  kind: FontKind;
  /** 最上位のフォントの Subtype（Type0、Type3、TrueType など）。 */
  subtype: string;
  /** 同じ書体名・同じ種類のフォント辞書の数。 */
  count: number;
  /** pdffonts の object ID と照らし合わせるための参照（例: "12 0 R"）。 */
  objectIds: string[];
}

export type FontCheckResult =
  | { status: "checked"; fonts: FontReport[] }
  | { status: "failed"; error: string };

export interface FontCheckReport {
  ok: boolean;
  lines: string[];
}

/** Type 0 の子として使われるフォント。単独では数えない。 */
const DESCENDANT_SUBTYPES = new Set(["CIDFontType0", "CIDFontType2"]);
const FONT_FILE_KEYS = ["FontFile", "FontFile2", "FontFile3"];
const UNNAMED_FONT = "（名前なし）";

export async function checkPdfFonts(
  pdfBytes: Uint8Array,
): Promise<FontCheckResult> {
  try {
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const groups = new Map<string, FontReport>();

    for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || nameOf(object, "Type") !== "Font") {
        continue;
      }
      const subtype = nameOf(object, "Subtype") ?? "";
      if (DESCENDANT_SUBTYPES.has(subtype)) {
        continue;
      }

      const name = fontName(object);
      const kind = classifyFont(object, subtype);
      const key = `${kind}\u0000${name}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        existing.objectIds.push(ref.toString());
      } else {
        groups.set(key, {
          name,
          kind,
          subtype,
          count: 1,
          objectIds: [ref.toString()],
        });
      }
    }

    const fonts = [...groups.values()].sort((a, b) =>
      a.name === b.name
        ? a.kind.localeCompare(b.kind)
        : a.name < b.name
          ? -1
          : 1,
    );
    return { status: "checked", fonts };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 検査できなかったときも「問題あり」とする（問題なしと見分けるため）。 */
export function hasFontProblems(result: FontCheckResult): boolean {
  if (result.status === "failed") {
    return true;
  }
  return result.fonts.some((font) => font.kind !== "embedded");
}

export function formatFontCheckReport(
  result: FontCheckResult,
): FontCheckReport {
  if (result.status === "failed") {
    return {
      ok: false,
      lines: [`⚠️  PDF のフォントを検査できませんでした: ${result.error}`],
    };
  }

  const embedded = result.fonts.filter((f) => f.kind === "embedded");
  const type3 = byCountDesc(result.fonts.filter((f) => f.kind === "type3"));
  const notEmbedded = byCountDesc(
    result.fonts.filter((f) => f.kind === "notEmbedded"),
  );
  const type3Total = type3.reduce((sum, f) => sum + f.count, 0);

  const summary = [
    `埋め込み ${embedded.length} 書体`,
    type3.length === 0
      ? "Type 3 なし"
      : `Type 3 ${type3.length} 書体（${type3Total} 個）`,
    notEmbedded.length === 0
      ? "埋め込みなし なし"
      : `埋め込みなし ${notEmbedded.length} 書体`,
  ].join("、");
  const lines = [`🔤 フォント: ${summary}`];

  if (type3.length > 0) {
    lines.push(
      `⚠️  Type 3 のフォントがあります: ${type3
        .map((f) => `${f.name}（${f.count} 個）`)
        .join("、")}`,
    );
  }
  if (notEmbedded.length > 0) {
    lines.push(
      `⚠️  埋め込まれていないフォントがあります: ${notEmbedded
        .map((f) => f.name)
        .join("、")}`,
    );
  }

  const ok = type3.length === 0 && notEmbedded.length === 0;
  if (!ok) {
    lines.push(
      "   入稿先によっては受け付けられない可能性があります。docs/font-setup.md を見てください。",
    );
  }
  return { ok, lines };
}

/** fontCheck が "error" のとき、問題のある PDF を保存する名前（元の PDF を上書きしないため）。 */
export function fontErrorOutputPath(outputPath: string): string {
  const ext = path.extname(outputPath);
  if (ext.toLowerCase() === ".pdf") {
    return `${outputPath.slice(0, -ext.length)}.font-error${ext}`;
  }
  return `${outputPath}.font-error.pdf`;
}

export function isFontCheckMode(value: unknown): value is FontCheckMode {
  return (
    typeof value === "string" &&
    (FONT_CHECK_MODES as readonly string[]).includes(value)
  );
}

function classifyFont(font: PDFDict, subtype: string): FontKind {
  if (subtype === "Type3") {
    // Type 3 は CharProcs に字形を持つので FontFile がないのが正常。埋め込みなしとは分ける。
    return "type3";
  }
  if (subtype === "Type0") {
    const descendant = firstDescendant(font);
    return descendant && hasFontFile(descendant) ? "embedded" : "notEmbedded";
  }
  return hasFontFile(font) ? "embedded" : "notEmbedded";
}

function firstDescendant(font: PDFDict): PDFDict | undefined {
  const descendants = font.lookup(PDFName.of("DescendantFonts"));
  if (!(descendants instanceof PDFArray) || descendants.size() === 0) {
    return undefined;
  }
  const first = descendants.lookup(0);
  return first instanceof PDFDict ? first : undefined;
}

function hasFontFile(font: PDFDict): boolean {
  const descriptor = font.lookup(PDFName.of("FontDescriptor"));
  if (!(descriptor instanceof PDFDict)) {
    return false;
  }
  return FONT_FILE_KEYS.some((key) => descriptor.has(PDFName.of(key)));
}

function fontName(font: PDFDict): string {
  const descriptor = font.lookup(PDFName.of("FontDescriptor"));
  const descendant = firstDescendant(font);
  const raw =
    nameOf(font, "BaseFont") ??
    (descriptor instanceof PDFDict
      ? nameOf(descriptor, "FontName")
      : undefined) ??
    (descendant ? nameOf(descendant, "BaseFont") : undefined) ??
    nameOf(font, "Name");
  if (!raw) {
    return UNNAMED_FONT;
  }
  return raw.replace(/^[A-Z]{6}\+/, "");
}

function nameOf(dict: PDFDict, key: string): string | undefined {
  const value: PDFObject | undefined = dict.lookup(PDFName.of(key));
  if (value instanceof PDFName) {
    return value.decodeText();
  }
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return value.decodeText();
  }
  return undefined;
}

function byCountDesc(fonts: FontReport[]): FontReport[] {
  return [...fonts].sort((a, b) => b.count - a.count);
}
