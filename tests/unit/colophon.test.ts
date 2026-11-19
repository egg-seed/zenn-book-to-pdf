import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { loadPdfConfig } from "../../src/config-loader.ts";
import { buildBookHtml, type ParsedBook } from "../../src/md-renderer.ts";

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-colophon-"));
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

describe("colophon の設定", () => {
  it("pdf.config.json の colophon を読み込める", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), { colophon });

    const config = await loadPdfConfig();

    expect(config.colophon?.rows).toHaveLength(2);
  });

  it("行の形が正しくなければ警告して無視する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      colophon: { rows: [{ label: "発行日" }] },
    });

    const config = await loadPdfConfig();

    expect(config.colophon).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("colophon の形が正しくありません"),
    );
  });
});

describe("buildBookHtml の奥付", () => {
  it("本文の後に奥付を置き、ページ番号を入れない", async () => {
    const html = await buildBookHtml(makeBook(), {
      pageNumbers: true,
      colophon,
    });

    const body = html.slice(html.indexOf("<body>"));
    expect(body.indexOf('class="colophon"')).toBeGreaterThan(
      body.indexOf('class="chapter"'),
    );
    expect(html).toContain('<p class="colophon-title">Test Book</p>');
    expect(html).toContain(
      '<a href="https://zenn.dev/example">https://zenn.dev/example</a>',
    );
    expect(html).toMatch(
      /@page colophon \{[^}]*@bottom-center \{ content: none; \}/,
    );
  });

  it("title を指定すると書名の代わりに使う", async () => {
    const html = await buildBookHtml(makeBook(), {
      colophon: { ...colophon, title: "奥付用の書名" },
    });

    expect(html).toContain('<p class="colophon-title">奥付用の書名</p>');
  });

  it("奥付の値はエスケープする", async () => {
    const html = await buildBookHtml(makeBook(), {
      colophon: { rows: [{ label: "<b>", value: "a & b" }] },
    });

    expect(html).toContain("<th>&lt;b&gt;</th><td>a &amp; b</td>");
  });

  it("colophon がなければ奥付を置かない", async () => {
    const html = await buildBookHtml(makeBook(), {});

    expect(html).not.toContain('class="colophon"');
  });

  it("mermaid のツールチップを消す（奥付の後ろに白紙のページを作らない）", async () => {
    const html = await buildBookHtml(makeBook(), {});

    expect(html).toMatch(/\.mermaidTooltip \{\s*display: none !important;/);
  });
});
