import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  isEmojiMode,
  openTwemoji,
  twemojiFileNames,
  twemojiStyles,
  wrapEmoji,
  type TwemojiSource,
} from "../../src/emoji.ts";
import { buildColophon } from "../../src/colophon.ts";

/** 名前の一覧にある SVG だけを持つ、テスト用の Twemoji。 */
function fakeSource(names: string[]): TwemojiSource {
  return {
    readSvg: (sequence) => {
      const name = twemojiFileNames(sequence).find((n) => names.includes(n));
      return name ? `<svg id="${name}"/>` : null;
    },
  };
}

describe("twemojiFileNames", () => {
  it("ZWJ を含まなければ、U+FE0F を外した名前を先に試す", () => {
    expect(twemojiFileNames("🚀")).toEqual(["1f680"]);
    expect(twemojiFileNames("⚠️")).toEqual(["26a0", "26a0-fe0f"]);
  });

  it("ZWJ を含めば、U+FE0F を残した名前を先に試す", () => {
    expect(twemojiFileNames("🏳️‍🌈")).toEqual([
      "1f3f3-fe0f-200d-1f308",
      "1f3f3-200d-1f308",
    ]);
  });
});

describe("wrapEmoji", () => {
  const source = fakeSource(["1f680", "26a0", "1f468-200d-1f469-200d-1f467"]);

  it("文字の部分の絵文字を span で包み、字は残す", () => {
    const result = wrapEmoji("<p>出発 🚀 と ⚠️</p>", source);

    expect(result.html).toBe(
      '<p>出発 <span class="twemoji twemoji-1f680">🚀</span> と <span class="twemoji twemoji-26a0">⚠️</span></p>',
    );
    expect([...result.used.keys()]).toEqual(["twemoji-1f680", "twemoji-26a0"]);
  });

  it("ZWJ の並びは1つの絵文字として扱う", () => {
    const result = wrapEmoji("<p>👨‍👩‍👧</p>", source);

    expect(result.html).toBe(
      '<p><span class="twemoji twemoji-1f468-200d-1f469-200d-1f467">👨‍👩‍👧</span></p>',
    );
  });

  it("コードブロックの色付けの span の中も包む", () => {
    const result = wrapEmoji(
      '<pre><code><span class="token string">"🚀 start"</span></code></pre>',
      source,
    );

    expect(result.html).toContain(
      '<span class="twemoji twemoji-1f680">🚀</span> start',
    );
  });

  it("U+FE0F のない記号（▶ ⚠ ©）と、U+FE0E の付いた絵文字は変えない", () => {
    const html = "<p>▶ ⚠ © 🚀︎</p>";

    expect(wrapEmoji(html, source).html).toBe(html);
  });

  it("属性、script、style、Mermaid の図は変えない", () => {
    const html = [
      '<img alt="🚀">',
      "<script>const a = '🚀';</script>",
      "<style>.x::after { content: '🚀'; }</style>",
      '<div class="mermaid-diagram"><pre class="mermaid">A[🚀] --> B</pre></div>',
    ].join("");

    const result = wrapEmoji(html, source);

    expect(result.html).toBe(html);
    expect(result.used.size).toBe(0);
  });

  it("Mermaid の図のあとの文字は、また包む", () => {
    const result = wrapEmoji(
      '<pre class="mermaid">A[🚀]</pre><p>🚀</p>',
      source,
    );

    expect(result.html).toBe(
      '<pre class="mermaid">A[🚀]</pre><p><span class="twemoji twemoji-1f680">🚀</span></p>',
    );
  });

  it("SVG のない絵文字は白黒のまま残し、missing に入れる", () => {
    const result = wrapEmoji("<p>🐍</p>", source);

    expect(result.html).toBe("<p>🐍</p>");
    expect([...result.missing]).toEqual(["🐍"]);
  });
});

describe("twemojiStyles", () => {
  it("字を透明にし、SVG を data URI の背景にする", () => {
    const css = twemojiStyles(new Map([["twemoji-1f680", "<svg/>"]]));

    expect(css).toContain("color: transparent;");
    expect(css).toContain("print-color-adjust: exact;");
    expect(css).toContain(
      `.twemoji-1f680 { background-image: url("data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}"); }`,
    );
  });

  it("使った絵文字がなければ空", () => {
    expect(twemojiStyles(new Map())).toBe("");
  });
});

describe("openTwemoji", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-twemoji-"));
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  it("manifest と svg/ がなければ、setup-fonts を案内する", () => {
    const result = openTwemoji(dir);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("mise run setup-fonts");
  });

  it("svg/ の SVG を、U+FE0F を外した名前でも探す", async () => {
    await fs.ensureDir(path.join(dir, "svg"));
    await fs.writeJson(path.join(dir, "manifest.json"), { version: 1 });
    await fs.writeFile(path.join(dir, "svg", "26a0.svg"), "<svg/>");

    const result = openTwemoji(dir);

    expect(result.ok && result.source.readSvg("⚠️")).toBe("<svg/>");
    expect(result.ok && result.source.readSvg("🚀")).toBeNull();
  });
});

describe("isEmojiMode", () => {
  it("text と twemoji だけ", () => {
    expect(isEmojiMode("text")).toBe(true);
    expect(isEmojiMode("twemoji")).toBe(true);
    expect(isEmojiMode("color")).toBe(false);
  });
});

describe("buildColophon の credits", () => {
  it("奥付があれば、奥付の中に入れる", () => {
    const html = buildColophon(
      { rows: [{ label: "著者", value: "A" }] },
      "本",
      ["絵文字の画像：Twemoji"],
    );

    expect(html).toContain(
      '<p class="colophon-note">絵文字の画像：Twemoji</p>',
    );
  });

  it("奥付がなくても、クレジットだけは本の最後に入れる", () => {
    expect(buildColophon(undefined, "本", ["絵文字の画像：Twemoji"])).toContain(
      '<section class="book-credits">',
    );
    expect(buildColophon(undefined, "本")).toBe("");
  });
});
