import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { loadPdfConfig } from "../../src/config-loader.ts";
import {
  buildBookHtml,
  convertMermaidEmbeds,
  formatSummary,
  renderMarkdown,
  type ParsedBook,
} from "../../src/md-renderer.ts";

let tmpDir: string;
let originalCwd: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-mermaid-summary-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.remove(tmpDir);
  vi.restoreAllMocks();
});

function makeBook(content: string, summary?: string): ParsedBook {
  return {
    config: { title: "Test Book", summary },
    chapters: [{ slug: "chapter-1", title: "Chapter One", content }],
    bookPath: tmpDir,
  };
}

describe("mermaid", () => {
  it("mermaid のコードブロックを iframe ではなく pre.mermaid にする", async () => {
    const md = '```mermaid\nflowchart LR\n  A["a<br/>b"] --> B{"x & y"}\n```\n';
    const result = await renderMarkdown(md);

    expect(result).not.toContain("<iframe");
    expect(result).toContain('<pre class="mermaid">');
    expect(result).toContain(
      "flowchart LR\n  A[&quot;a&lt;br/&gt;b&quot;] --&gt; B{&quot;x &amp; y&quot;}",
    );
  });

  it("data-content を読み取れない場合は警告して元の HTML を残す", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html =
      '<span class="embed-block zenn-embedded zenn-embedded-mermaid"><iframe src="x" data-content="%E0%A4%A"></iframe></span>';

    expect(convertMermaidEmbeds(html)).toBe(html);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("mermaid のコードを読み取れませんでした"),
    );
  });

  it("mermaid を含む本だけに mermaid のスクリプトを埋め込む", async () => {
    const withMermaid = await buildBookHtml(
      makeBook("```mermaid\nflowchart LR\n  A --> B\n```\n"),
    );
    const withoutMermaid = await buildBookHtml(makeBook("本文だけ"));

    expect(withMermaid).toContain("mermaid.initialize(");
    expect(withoutMermaid).not.toContain("mermaid.initialize(");
  });
});

describe("summary", () => {
  it("pdf.config.json の summary を読み込める", async () => {
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), {
      summary: "技術書典版の概要",
    });

    const config = await loadPdfConfig();

    expect(config.summary).toBe("技術書典版の概要");
  });

  it("summary が文字列でなければ警告して無視する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeJson(path.join(tmpDir, "pdf.config.json"), { summary: 1 });

    const config = await loadPdfConfig();

    expect(config.summary).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("summary は文字列で指定してください"),
    );
  });

  it("指定した summary を config.yaml の summary の代わりに使う", async () => {
    const html = await buildBookHtml(makeBook("本文", "Zenn用の概要"), {
      summary: "PDF用の概要",
    });

    expect(html).toContain("PDF用の概要");
    expect(html).not.toContain("Zenn用の概要");
  });

  it("summary が空文字ならタイトルページに概要を出さない", async () => {
    const html = await buildBookHtml(makeBook("本文", "Zenn用の概要"), {
      summary: "",
    });

    expect(html).not.toContain("Zenn用の概要");
    expect(html).not.toContain('<p class="book-summary">');
  });

  it("summary を指定しなければ config.yaml の summary を使う", async () => {
    const html = await buildBookHtml(makeBook("本文", "Zenn用の概要"));

    expect(html).toContain("Zenn用の概要");
  });
});

describe("formatSummary", () => {
  it("**太字** を strong にし、ほかの HTML はエスケープする", () => {
    expect(formatSummary("**基礎**：<b>型</b>")).toBe(
      "<strong>基礎</strong>：&lt;b&gt;型&lt;/b&gt;",
    );
  });

  it("「・」で始まる行を、2行目以降を字下げする要素にする", () => {
    expect(formatSummary("説明です。\n\n・**基礎**：型\n・構成")).toBe(
      '説明です。\n\n<span class="summary-item">・<strong>基礎</strong>：型</span><span class="summary-item">・構成</span>',
    );
  });

  it("対になっていない ** はそのまま残す", () => {
    expect(formatSummary("a ** b")).toBe("a ** b");
  });
});
