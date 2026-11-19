import { describe, it, expect } from "vitest";
import { splitTitle } from "../../src/title.ts";
import { buildBookHtml, type ParsedBook } from "../../src/md-renderer.ts";

function makeBook(title: string): ParsedBook {
  return {
    config: { title },
    chapters: [{ slug: "chapter-1", title: "Chapter One", content: "本文" }],
    bookPath: "/tmp",
  };
}

describe("splitTitle", () => {
  it("「: 」の前を書名、後を副題に分ける", () => {
    expect(splitTitle("本の名前 第2版: 副題の言葉")).toEqual({
      main: "本の名前 第2版",
      subtitle: "副題の言葉",
    });
  });

  it("全角のコロン「：」でも分ける", () => {
    expect(splitTitle("本の名前：副題")).toEqual({
      main: "本の名前",
      subtitle: "副題",
    });
  });

  it("コロンがなければ副題なし", () => {
    expect(splitTitle("本の名前")).toEqual({ main: "本の名前" });
  });

  it("「http://」のような空白なしの半角コロンでは分けない", () => {
    expect(splitTitle("Vue:Router入門")).toEqual({ main: "Vue:Router入門" });
  });
});

describe("書名ページと奥付の副題", () => {
  it("書名ページでは、副題を別の行に小さく出す", async () => {
    const html = await buildBookHtml(makeBook("本の名前: 副題"), {});

    expect(html).toContain('<h1 class="book-title">本の名前</h1>');
    expect(html).toContain('<p class="book-subtitle">副題</p>');
    expect(html).toContain("<title>本の名前: 副題</title>");
  });

  it("副題がなければ副題の行を出さない", async () => {
    const html = await buildBookHtml(makeBook("本の名前"), {});

    expect(html).not.toContain('<p class="book-subtitle">');
  });

  it("奥付の書名でも、副題を別の行に出す", async () => {
    const html = await buildBookHtml(makeBook("本の名前: 副題"), {
      colophon: { rows: [{ label: "発行日", value: "2026年11月21日" }] },
    });

    expect(html).toContain(
      '<p class="colophon-title">本の名前<span class="colophon-subtitle">副題</span></p>',
    );
  });
});
