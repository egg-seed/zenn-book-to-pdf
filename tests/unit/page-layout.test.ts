import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { loadPdfConfig } from "../../src/config-loader.ts";
import { buildBookHtml, type ParsedBook } from "../../src/md-renderer.ts";

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-page-layout-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.remove(tmpDir);
  vi.restoreAllMocks();
});

function makeBook(content: string): ParsedBook {
  return {
    config: { title: "Test Book" },
    chapters: [{ slug: "chapter-1", title: "Chapter One", content }],
    bookPath: tmpDir,
  };
}

describe("pageNumbers", () => {
  it("pdf.config.json の pageNumbers を読み込める", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      pageNumbers: true,
    });

    const config = await loadPdfConfig();

    expect(config.pageNumbers).toBe(true);
  });

  it("pageNumbers が真偽値でなければ警告して無視する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      pageNumbers: "yes",
    });

    const config = await loadPdfConfig();

    expect(config.pageNumbers).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "pageNumbers は true か false で指定してください",
      ),
    );
  });

  it("pageNumbers が true ならページ下にページ番号を入れ、画像表紙では消す", async () => {
    const html = await buildBookHtml(
      makeBook("本文"),
      { pageNumbers: true },
      { fileName: "cover.png", dataUri: "data:image/png;base64,AAAA" },
    );

    expect(html).toContain("content: counter(page)");
    expect(html).toMatch(
      /@page image-cover \{[^}]*@bottom-center \{ content: none; \}/,
    );
  });

  it("pageNumbers を指定しなければページ番号を入れない", async () => {
    const html = await buildBookHtml(makeBook("本文"), {});

    expect(html).not.toContain("counter(page)");
  });
});

describe("表と改ページの CSS", () => {
  it("表をページ幅に収め、横スクロール用の display:block を打ち消す", async () => {
    const html = await buildBookHtml(makeBook("|a|b|\n|-|-|\n|`c`|d|\n"), {});

    expect(html).toMatch(/\.znc table \{[^}]*display: table;[^}]*width: 100%;/);
    expect(html).toMatch(
      /\.znc td code,\s*\.znc th code \{[^}]*overflow-wrap: anywhere;/,
    );
  });

  it("keep-words の表では、単語の途中で改行しない", async () => {
    const html = await buildBookHtml(makeBook("|a|b|\n|-|-|\n|`c`|d|\n"), {});

    expect(html).toMatch(
      /\.znc table\.keep-words th,\s*\.znc table\.keep-words td,\s*\.znc table\.keep-words code \{[^}]*overflow-wrap: break-word;[^}]*word-break: normal;/,
    );
  });

  it("keep-headings の表では、見出しの日本語を語の途中で改行しない", async () => {
    const html = await buildBookHtml(makeBook("|番号|b|\n|-|-|\n|1|d|\n"), {});

    expect(html).toMatch(
      /\.znc table\.keep-headings th \{[^}]*word-break: keep-all;/,
    );
  });

  it("見出しとコードのファイル名の直後で改ページしない", async () => {
    const html = await buildBookHtml(makeBook("## 見出し\n"), {});

    expect(html).toMatch(
      /\.znc \.code-block-filename-container \{[^}]*break-after: avoid;/,
    );
    expect(html).toMatch(/\.chapter-body h2,/);
  });
});

describe("章題の折り返し", () => {
  it("2行になる章題は行の長さをそろえ、文節の切れ目で折り返す", async () => {
    const html = await buildBookHtml(makeBook("本文"), {});

    expect(html).toMatch(
      /\.chapter-title \{[^}]*text-wrap: balance;[^}]*word-break: auto-phrase;/,
    );
  });

  it("章の下に余白を付けない（白紙のページを作らない）", async () => {
    const html = await buildBookHtml(makeBook("本文"), {});

    expect(html).toMatch(/\.chapter \{[^}]*padding: 28px 22px 0;/);
  });
});
