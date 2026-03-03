import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { loadPdfConfig, DEFAULT_CONFIG } from "../../src/config-loader.ts";
import { buildBookHtml, type ParsedBook } from "../../src/md-renderer.ts";

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-font-config-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.remove(tmpDir);
});

describe("fonts config", () => {
  it("fonts 未指定時はデフォルト設定を使う", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      pageSize: "A5",
    });

    const config = await loadPdfConfig();

    expect(config.fonts).toEqual(DEFAULT_CONFIG.fonts);
  });

  it("fonts が不正な型なら警告してデフォルト設定にフォールバックする", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fonts: "invalid",
    });

    const config = await loadPdfConfig();

    expect(config.fonts).toEqual(DEFAULT_CONFIG.fonts);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fonts の設定はオブジェクト"),
    );
  });

  it("buildBookHtml で本文と見出しフォントがCSSに反映される", async () => {
    const book: ParsedBook = {
      config: {
        title: "Test Book",
      },
      chapters: [
        {
          slug: "chapter-1",
          title: "Chapter One",
          content: "本文テキスト",
        },
      ],
      bookPath: tmpDir,
    };

    const html = await buildBookHtml(book, {
      fonts: {
        bodyFamily: "'Noto Serif JP', serif",
        headingFamily: "'Noto Sans JP', sans-serif",
      },
    });

    expect(html).toContain(
      "body {\n      font-family: 'Noto Serif JP', serif;",
    );
    expect(html).toContain("h1, h2, h3,");
    expect(html).toContain("font-family: 'Noto Sans JP', sans-serif;");
  });

  it("--config 指定ファイルは pdf.config.json より優先される", async () => {
    const cwdConfigPath = path.join(tmpDir, "pdf.config.json");
    const specifiedConfigPath = path.join(tmpDir, "custom.config.json");

    await fs.writeJson(cwdConfigPath, {
      margin: { left: "20mm", right: "20mm" },
      footer: { enabled: true },
    });

    await fs.writeJson(specifiedConfigPath, {
      margin: { left: "12mm" },
      footer: { enabled: false },
    });

    const config = await loadPdfConfig(specifiedConfigPath);

    expect(config.margin.left).toBe("12mm");
    expect(config.margin.right).toBe("20mm");
    expect(config.footer.enabled).toBe(false);
  });

  it("--config が不正でも pdf.config.json の設定は維持される", async () => {
    const cwdConfigPath = path.join(tmpDir, "pdf.config.json");
    const brokenConfigPath = path.join(tmpDir, "broken.config.json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await fs.writeJson(cwdConfigPath, {
      margin: { top: "11mm" },
      pageSize: "A4",
    });

    await fs.writeFile(brokenConfigPath, "{ invalid json");

    const config = await loadPdfConfig(brokenConfigPath);

    expect(config.pageSize).toBe("A4");
    expect(config.margin.top).toBe("11mm");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("コンフィグの読み込みに失敗"),
    );
  });
});
