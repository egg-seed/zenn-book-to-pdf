import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from "pdf-lib";
import {
  checkPdfFonts,
  formatFontCheckReport,
  fontErrorOutputPath,
  hasFontProblems,
  type FontCheckResult,
} from "../../src/font-check.ts";

/** ページの /Resources /Font にフォントの参照を足す。 */
function attachFont(doc: PDFDocument, key: string, fontRef: PDFRef): void {
  const page = doc.getPage(0);
  const resources = page.node.Resources() ?? doc.context.obj({});
  const fonts =
    resources.lookupMaybe(PDFName.of("Font"), PDFDict) ?? doc.context.obj({});
  fonts.set(PDFName.of(key), fontRef);
  resources.set(PDFName.of("Font"), fonts);
  page.node.set(PDFName.of("Resources"), resources);
}

/** Skia が出す形の Type 3 フォント（BaseFont なし、名前は FontDescriptor の FontName）。 */
function addType3Font(doc: PDFDocument, fontName: string): PDFRef {
  const ctx = doc.context;
  const descriptor = ctx.register(
    ctx.obj({ Type: "FontDescriptor", FontName: fontName, Flags: 4 }),
  );
  return ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "Type3",
      FontBBox: [0, 0, 1000, 1000],
      FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: ctx.obj({}),
      Encoding: ctx.obj({ Type: "Encoding", Differences: [] }),
      FirstChar: 0,
      LastChar: 0,
      Widths: [0],
      FontDescriptor: descriptor,
    }),
  );
}

/** Chromium が出す形の Type 0 → CIDFontType2 → FontFile2 のフォント。 */
function addType0Font(
  doc: PDFDocument,
  baseFont: string,
  options: { embedded: boolean; descendantsAsRef?: boolean },
): PDFRef {
  const ctx = doc.context;
  const descriptorEntries: Record<string, unknown> = {
    Type: "FontDescriptor",
    FontName: baseFont,
    Flags: 4,
  };
  if (options.embedded) {
    descriptorEntries.FontFile2 = ctx.register(ctx.stream(new Uint8Array(4)));
  }
  const descriptor = ctx.register(
    ctx.obj(descriptorEntries as Parameters<typeof ctx.obj>[0]),
  );
  const cidFont = ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "CIDFontType2",
      BaseFont: baseFont,
      CIDSystemInfo: ctx.obj({
        Registry: ctx.obj("Adobe"),
        Ordering: ctx.obj("Identity"),
        Supplement: 0,
      }),
      FontDescriptor: descriptor,
    }),
  );
  const descendants = ctx.obj([cidFont]);
  return ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: baseFont,
      Encoding: "Identity-H",
      DescendantFonts: options.descendantsAsRef
        ? ctx.register(descendants)
        : descendants,
    }),
  );
}

async function newDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  return doc;
}

async function check(doc: PDFDocument): Promise<FontCheckResult> {
  return checkPdfFonts(await doc.save({ useObjectStreams: false }));
}

describe("checkPdfFonts", () => {
  it("埋め込まれた Type 0 フォントは問題なしとし、子の CIDFont を別に数えない", async () => {
    const doc = await newDoc();
    attachFont(
      doc,
      "F1",
      addType0Font(doc, "AAAAAA+NotoSerifJP-Regular", { embedded: true }),
    );
    attachFont(
      doc,
      "F2",
      addType0Font(doc, "BAAAAA+NotoSansJP-Bold", {
        embedded: true,
        descendantsAsRef: true,
      }),
    );

    const result = await check(doc);

    expect(result.status).toBe("checked");
    if (result.status !== "checked") return;
    expect(result.fonts).toEqual([
      expect.objectContaining({
        name: "NotoSansJP-Bold",
        kind: "embedded",
        subtype: "Type0",
        count: 1,
      }),
      expect.objectContaining({
        name: "NotoSerifJP-Regular",
        kind: "embedded",
        subtype: "Type0",
        count: 1,
      }),
    ]);
    expect(hasFontProblems(result)).toBe(false);
  });

  it("Type 3 フォントを FontDescriptor の FontName で見つけ、書体ごとにまとめる", async () => {
    const doc = await newDoc();
    attachFont(doc, "T1", addType3Font(doc, "AAAAAA+NotoSansCJKjp-Regular"));
    attachFont(doc, "T2", addType3Font(doc, "BAAAAA+NotoSansCJKjp-Regular"));
    attachFont(doc, "T3", addType3Font(doc, "CAAAAA+NotoColorEmoji"));

    const result = await check(doc);

    expect(result.status).toBe("checked");
    if (result.status !== "checked") return;
    expect(result.fonts).toEqual([
      expect.objectContaining({
        name: "NotoColorEmoji",
        kind: "type3",
        count: 1,
      }),
      expect.objectContaining({
        name: "NotoSansCJKjp-Regular",
        kind: "type3",
        count: 2,
      }),
    ]);
    expect(result.fonts[1]?.objectIds).toHaveLength(2);
    expect(hasFontProblems(result)).toBe(true);
  });

  it("Type 3 は「埋め込みなし」には数えない", async () => {
    const doc = await newDoc();
    attachFont(doc, "T1", addType3Font(doc, "AAAAAA+Foo"));

    const result = await check(doc);

    if (result.status !== "checked") throw new Error("checked のはず");
    expect(result.fonts.map((f) => f.kind)).toEqual(["type3"]);
  });

  it("埋め込まれていない標準フォント（Helvetica）を見つける", async () => {
    const doc = await newDoc();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPage(0).drawText("abc", { font, size: 12 });

    const result = await check(doc);

    if (result.status !== "checked") throw new Error("checked のはず");
    expect(result.fonts).toEqual([
      expect.objectContaining({
        name: "Helvetica",
        kind: "notEmbedded",
        subtype: "Type1",
      }),
    ]);
    expect(hasFontProblems(result)).toBe(true);
  });

  it("子の CIDFont に FontFile がない Type 0 は埋め込みなしにする", async () => {
    const doc = await newDoc();
    attachFont(
      doc,
      "F1",
      addType0Font(doc, "NotoSansJP-Regular", { embedded: false }),
    );

    const result = await check(doc);

    if (result.status !== "checked") throw new Error("checked のはず");
    expect(result.fonts).toEqual([
      expect.objectContaining({
        name: "NotoSansJP-Regular",
        kind: "notEmbedded",
        subtype: "Type0",
      }),
    ]);
  });

  it("フォントのない PDF は問題なし", async () => {
    const result = await check(await newDoc());

    expect(result).toEqual({ status: "checked", fonts: [] });
    expect(hasFontProblems(result)).toBe(false);
  });

  it("PDF として読めないときは failed を返す（問題なしにしない）", async () => {
    const result = await checkPdfFonts(new TextEncoder().encode("not a pdf"));

    expect(result.status).toBe("failed");
    expect(hasFontProblems(result)).toBe(true);
  });

  it("ページに直接書かれた（参照でない）フォント辞書は対象外", async () => {
    // Chromium の PDF ではフォントはすべて参照で置かれる。それ以外の形は見ない、という制限の確認。
    const doc = await newDoc();
    const ctx = doc.context;
    const page = doc.getPage(0);
    page.node.set(
      PDFName.of("Resources"),
      ctx.obj({
        Font: ctx.obj({
          F1: ctx.obj({
            Type: "Font",
            Subtype: "Type3",
            FontBBox: [0, 0, 1, 1],
          }),
        }),
      }),
    );

    const result = await check(doc);

    expect(result).toEqual({ status: "checked", fonts: [] });
  });
});

describe("formatFontCheckReport", () => {
  it("問題がなければ要約の1行だけを返す", () => {
    const report = formatFontCheckReport({
      status: "checked",
      fonts: [
        {
          name: "NotoSerifJP-Regular",
          kind: "embedded",
          subtype: "Type0",
          count: 1,
          objectIds: ["5 0 R"],
        },
        {
          name: "NotoEmoji-Regular",
          kind: "embedded",
          subtype: "Type0",
          count: 1,
          objectIds: ["7 0 R"],
        },
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.lines).toEqual([
      "🔤 フォント: 埋め込み 2 書体、Type 3 なし、埋め込みなし なし",
    ]);
  });

  it("Type 3 と埋め込みなしを、書体名と数つきで知らせる", () => {
    const report = formatFontCheckReport({
      status: "checked",
      fonts: [
        {
          name: "NotoSansCJKjp-Regular",
          kind: "type3",
          subtype: "Type3",
          count: 312,
          objectIds: [],
        },
        {
          name: "NotoColorEmoji",
          kind: "type3",
          subtype: "Type3",
          count: 3,
          objectIds: [],
        },
        {
          name: "Helvetica",
          kind: "notEmbedded",
          subtype: "Type1",
          count: 1,
          objectIds: [],
        },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.lines[0]).toBe(
      "🔤 フォント: 埋め込み 0 書体、Type 3 2 書体（315 個）、埋め込みなし 1 書体",
    );
    expect(report.lines).toContain(
      "⚠️  Type 3 のフォントがあります: NotoSansCJKjp-Regular（312 個）、NotoColorEmoji（3 個）",
    );
    expect(report.lines).toContain(
      "⚠️  埋め込まれていないフォントがあります: Helvetica",
    );
    expect(report.lines.at(-1)).toContain("docs/font-setup.md");
  });

  it("検査できなかったときは、その理由を知らせる", () => {
    const report = formatFontCheckReport({
      status: "failed",
      error: "Failed to parse PDF",
    });

    expect(report.ok).toBe(false);
    expect(report.lines).toEqual([
      "⚠️  PDF のフォントを検査できませんでした: Failed to parse PDF",
    ]);
  });
});

describe("fontErrorOutputPath", () => {
  it(".pdf の前に .font-error を入れる", () => {
    expect(fontErrorOutputPath("/tmp/out/book.pdf")).toBe(
      "/tmp/out/book.font-error.pdf",
    );
    expect(fontErrorOutputPath("/tmp/out/book.PDF")).toBe(
      "/tmp/out/book.font-error.PDF",
    );
  });

  it("拡張子が .pdf でなければ末尾に足す", () => {
    expect(fontErrorOutputPath("/tmp/out/book")).toBe(
      "/tmp/out/book.font-error.pdf",
    );
  });
});
