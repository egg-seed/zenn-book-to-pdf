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

  it("render 未指定時はデフォルト設定を使う", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      pageSize: "A5",
    });

    const config = await loadPdfConfig();

    expect(config.render).toEqual(DEFAULT_CONFIG.render);
  });

  it("render の各設定を読み込める", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      render: {
        waitUntil: "load",
        navigationTimeout: 45000,
        imageTimeout: 12000,
      },
    });

    const config = await loadPdfConfig();

    expect(config.render).toEqual({
      waitUntil: "load",
      navigationTimeout: 45000,
      imageTimeout: 12000,
    });
  });

  it("render が不正な型なら警告してデフォルト設定にフォールバックする", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      render: "invalid",
    });

    const config = await loadPdfConfig();

    expect(config.render).toEqual(DEFAULT_CONFIG.render);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("render の設定はオブジェクト"),
    );
  });

  it("render の不正値は警告してデフォルト値にフォールバックする", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      render: {
        waitUntil: "invalid",
        navigationTimeout: -1,
        imageTimeout: "bad",
      },
    });

    const config = await loadPdfConfig();

    expect(config.render).toEqual(DEFAULT_CONFIG.render);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("render.waitUntil"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("render.navigationTimeout"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("render.imageTimeout"),
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

  it("codeFamily の既定は UDEV Gothic で、指定すれば上書きできる", async () => {
    expect(DEFAULT_CONFIG.fonts.codeFamily).toMatch(/^'UDEV Gothic'/);

    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fonts: { codeFamily: "'Liberation Mono', monospace" },
    });
    const config = await loadPdfConfig();

    expect(config.fonts.codeFamily).toBe("'Liberation Mono', monospace");
    expect(config.fonts.bodyFamily).toBe(DEFAULT_CONFIG.fonts.bodyFamily);
  });

  it("codeFamily が空なら警告して既定を使う", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fonts: { codeFamily: " " },
    });

    const config = await loadPdfConfig();

    expect(config.fonts.codeFamily).toBe(DEFAULT_CONFIG.fonts.codeFamily);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fonts.codeFamily"),
    );
  });

  it("buildBookHtml で codeFamily がコードとコードのファイル名の CSS に反映される", async () => {
    const book: ParsedBook = {
      config: { title: "Test Book" },
      chapters: [{ slug: "c", title: "C", content: "`code`" }],
      bookPath: tmpDir,
    };

    const html = await buildBookHtml(book, {
      fonts: {
        bodyFamily: "serif",
        headingFamily: "sans-serif",
        codeFamily: "'UDEV Gothic', monospace",
      },
    });

    expect(html).toMatch(
      /\.znc code,\s*\.znc \.code-block-filename \{\s*font-family: 'UDEV Gothic', monospace;/,
    );
  });

  it("buildBookHtml で margin が @page に反映される", async () => {
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
      margin: {
        top: "20mm",
        right: "10mm",
        bottom: "24mm",
        left: "12mm",
      },
    });

    expect(html).toContain("@page { margin: 20mm 10mm 24mm 12mm; }");
    expect(html).toContain("@page :first { margin: 20mm 10mm 24mm 12mm; }");
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

  it("--config で指定したファイルが壊れていたらエラーにする", async () => {
    const brokenConfigPath = path.join(tmpDir, "broken.config.json");
    await fs.writeFile(brokenConfigPath, "{ invalid json");

    await expect(loadPdfConfig(brokenConfigPath)).rejects.toThrow(
      /コンフィグの読み込みに失敗しました/,
    );
  });

  it("--config で指定したファイルがなければエラーにする", async () => {
    await expect(
      loadPdfConfig(path.join(tmpDir, "missing.config.json")),
    ).rejects.toThrow(/コンフィグが見つかりません/);
  });

  it("カレントディレクトリの pdf.config.json が壊れていても、警告して続ける", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeFile(path.join(tmpDir, "pdf.config.json"), "{ invalid json");

    const config = await loadPdfConfig();

    expect(config.pageSize).toBe(DEFAULT_CONFIG.pageSize);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("コンフィグの読み込みに失敗"),
    );
  });
});

describe("fontCheck config", () => {
  it("未指定なら warn", async () => {
    const config = await loadPdfConfig();

    expect(config.fontCheck).toBe("warn");
  });

  it("error / off を読み込む", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fontCheck: "error",
    });
    expect((await loadPdfConfig()).fontCheck).toBe("error");

    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fontCheck: "off",
    });
    expect((await loadPdfConfig()).fontCheck).toBe("off");
  });

  it("warn / error / off 以外の値はエラーにする", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fontCheck: "strict",
    });

    await expect(loadPdfConfig()).rejects.toThrow(
      /fontCheck は warn \/ error \/ off のいずれか/,
    );
  });
});

describe("glyphCheck config", () => {
  it("未指定なら warn", async () => {
    expect((await loadPdfConfig()).glyphCheck).toBe("warn");
  });

  it("error / off を読み込む", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      glyphCheck: "error",
    });
    expect((await loadPdfConfig()).glyphCheck).toBe("error");

    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      glyphCheck: "off",
    });
    expect((await loadPdfConfig()).glyphCheck).toBe("off");
  });

  it("warn / error / off 以外の値はエラーにする", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      glyphCheck: true,
    });

    await expect(loadPdfConfig()).rejects.toThrow(
      /glyphCheck は warn \/ error \/ off のいずれか/,
    );
  });
});

describe("fontconfigFile config", () => {
  it("未指定なら undefined", async () => {
    expect((await loadPdfConfig()).fontconfigFile).toBeUndefined();
  });

  it("相対パスは、設定ファイルの場所を基準に絶対パスにする", async () => {
    const configDir = path.join(tmpDir, "configs");
    await fs.ensureDir(path.join(configDir, "fonts"));
    await fs.writeFile(
      path.join(configDir, "fonts", "fonts.conf"),
      "<fontconfig/>",
    );
    const configPath = path.join(configDir, "book.config.json");
    await fs.writeJson(configPath, { fontconfigFile: "fonts/fonts.conf" });

    const config = await loadPdfConfig(configPath);

    expect(config.fontconfigFile).toBe(
      path.join(configDir, "fonts", "fonts.conf"),
    );
  });

  it("null を読み込む（システムの設定を使う）", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fontconfigFile: null,
    });

    expect((await loadPdfConfig()).fontconfigFile).toBeNull();
  });

  it("指定したファイルがなければエラーにする", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fontconfigFile: "missing/fonts.conf",
    });

    await expect(loadPdfConfig()).rejects.toThrow(
      /fontconfigFile のファイルが見つかりません/,
    );
  });

  it("文字列でも null でもなければエラーにする", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      fontconfigFile: 1,
    });

    await expect(loadPdfConfig()).rejects.toThrow(
      /fontconfigFile は fonts.conf のパスか null/,
    );
  });
});
