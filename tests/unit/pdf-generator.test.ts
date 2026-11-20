import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  FontCheckError,
  savePdfWithFontCheck,
  toCssPx,
} from "../../src/pdf-generator.ts";

describe("toCssPx", () => {
  it("mm・in・pt・px を CSS px に直す", () => {
    expect(toCssPx("25.4mm")).toBeCloseTo(96);
    expect(toCssPx("1in")).toBe(96);
    expect(toCssPx("72pt")).toBeCloseTo(96);
    expect(toCssPx("10px")).toBe(10);
    expect(toCssPx("10")).toBe(10);
  });

  it("読めない値は 0 にする", () => {
    expect(toCssPx("auto")).toBe(0);
  });
});

describe("savePdfWithFontCheck", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-font-check-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(tmpDir);
  });

  async function pdfWithType3(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const ctx = doc.context;
    const descriptor = ctx.register(
      ctx.obj({ Type: "FontDescriptor", FontName: "AAAAAA+NotoColorEmoji" }),
    );
    const font = ctx.register(
      ctx.obj({ Type: "Font", Subtype: "Type3", FontDescriptor: descriptor }),
    );
    page.node.set(
      PDFName.of("Resources"),
      ctx.obj({ Font: ctx.obj({ T1: font }) }),
    );
    return Buffer.from(await doc.save());
  }

  async function cleanPdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    return Buffer.from(await doc.save());
  }

  it("問題がなければ指定した名前で保存し、要約を出す", async () => {
    const outputPath = path.join(tmpDir, "book.pdf");

    await savePdfWithFontCheck(await cleanPdf(), outputPath, "error");

    expect(await fs.pathExists(outputPath)).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Type 3 なし"),
    );
  });

  it("warn では Type 3 があっても保存して警告する", async () => {
    const outputPath = path.join(tmpDir, "book.pdf");

    await savePdfWithFontCheck(await pdfWithType3(), outputPath, "warn");

    expect(await fs.pathExists(outputPath)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("NotoColorEmoji"),
    );
  });

  it("error では元の PDF を上書きせず .font-error.pdf に保存して例外を投げる", async () => {
    const outputPath = path.join(tmpDir, "book.pdf");
    await fs.writeFile(outputPath, "previous");

    await expect(
      savePdfWithFontCheck(await pdfWithType3(), outputPath, "error"),
    ).rejects.toThrow(FontCheckError);

    expect(await fs.readFile(outputPath, "utf8")).toBe("previous");
    expect(await fs.pathExists(path.join(tmpDir, "book.font-error.pdf"))).toBe(
      true,
    );
  });

  it("error では検査できなかったときも失敗にする", async () => {
    const outputPath = path.join(tmpDir, "book.pdf");

    await expect(
      savePdfWithFontCheck(Buffer.from("not a pdf"), outputPath, "error"),
    ).rejects.toThrow(FontCheckError);
    expect(await fs.pathExists(outputPath)).toBe(false);
  });

  it("off では検査せずに保存する", async () => {
    const outputPath = path.join(tmpDir, "book.pdf");

    await savePdfWithFontCheck(await pdfWithType3(), outputPath, "off");

    expect(await fs.pathExists(outputPath)).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
