import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { loadPdfConfig } from "../../src/config-loader.ts";
import { resolveBackImage } from "../../src/back-matter.ts";
import { buildBookHtml, type ParsedBook } from "../../src/md-renderer.ts";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-back-matter-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.remove(tmpDir);
  vi.restoreAllMocks();
});

function makeBook(): ParsedBook {
  return {
    config: { title: "Test Book" },
    chapters: [{ slug: "chapter-1", title: "Chapter One", content: "本文" }],
    bookPath: tmpDir,
  };
}

const colophon = {
  rows: [
    { label: "発行日", value: "2026年11月21日" },
    { label: "Zenn", value: "https://zenn.dev/example" },
  ],
};

describe("backMatter の設定", () => {
  it("画像のパスを設定ファイルのあるディレクトリから解決する", async () => {
    const configDir = path.join(tmpDir, "conf");
    await fs.ensureDir(configDir);
    const configPath = path.join(configDir, "book.json");
    await fs.writeJson(configPath, {
      backMatter: { image: "local/author.png", colophon },
    });

    const config = await loadPdfConfig(configPath);

    expect(config.backMatter?.image).toBe(
      path.join(configDir, "local/author.png"),
    );
    expect(config.backMatter?.colophon?.rows).toHaveLength(2);
  });

  it("奥付の行の形が正しくなければ警告して無視する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      backMatter: { colophon: { rows: [{ label: "発行日" }] } },
    });

    const config = await loadPdfConfig();

    expect(config.backMatter).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("backMatter の形が正しくありません"),
    );
  });
});

describe("resolveBackImage", () => {
  it("PNG を data URI にする", async () => {
    const imagePath = path.join(tmpDir, "author.png");
    await fs.writeFile(imagePath, PNG_1X1);

    const image = await resolveBackImage({ image: imagePath });

    expect(image?.fileName).toBe("author.png");
    expect(image?.dataUri).toMatch(/^data:image\/png;base64,/);
  });

  it("ファイルがなければ警告して null を返す", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const image = await resolveBackImage({
      image: path.join(tmpDir, "missing.png"),
    });

    expect(image).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("読み込めませんでした"),
    );
  });
});

describe("buildBookHtml の奥付", () => {
  it("本文の後に画像と奥付を置き、どちらのページにも番号を入れない", async () => {
    const html = await buildBookHtml(
      makeBook(),
      { pageNumbers: true, backMatter: { colophon } },
      null,
      { fileName: "author.png", dataUri: "data:image/png;base64,AAAA" },
    );

    const body = html.slice(html.indexOf("<body>"));
    expect(body.indexOf('class="back-image"')).toBeGreaterThan(
      body.indexOf('class="chapter"'),
    );
    expect(body.indexOf('class="colophon"')).toBeGreaterThan(
      body.indexOf('class="back-image"'),
    );
    expect(html).toContain('<p class="colophon-title">Test Book</p>');
    expect(html).toContain(
      '<a href="https://zenn.dev/example">https://zenn.dev/example</a>',
    );
    expect(html).toMatch(
      /@page colophon \{[^}]*@bottom-center \{ content: none; \}/,
    );
    expect(html).toMatch(
      /@page back-image \{[^}]*@bottom-center \{ content: none; \}/,
    );
  });

  it("奥付の値はエスケープする", async () => {
    const html = await buildBookHtml(makeBook(), {
      backMatter: { colophon: { rows: [{ label: "<b>", value: "a & b" }] } },
    });

    expect(html).toContain("<th>&lt;b&gt;</th><td>a &amp; b</td>");
  });

  it("backMatter がなければ奥付を置かない", async () => {
    const html = await buildBookHtml(makeBook(), {});

    expect(html).not.toContain('class="colophon"');
    expect(html).not.toContain('class="back-image"');
  });

  it("mermaid のツールチップを消す（奥付の後ろに白紙のページを作らない）", async () => {
    const html = await buildBookHtml(makeBook(), {});

    expect(html).toMatch(/\.mermaidTooltip \{\s*display: none !important;/);
  });
});
