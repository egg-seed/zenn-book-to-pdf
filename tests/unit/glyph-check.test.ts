import { describe, expect, it } from "vitest";
import {
  checkGlyphs,
  decodeHtmlEntities,
  extractTextSegments,
  findMissingGlyphs,
  formatGlyphCheckReport,
  GlyphCheckError,
  htmlToText,
  isIgnorableChar,
  parseFcCharsets,
  reportGlyphCheck,
  type GlyphCheckResult,
} from "../../src/glyph-check.ts";

function codePoints(text: string): Set<number> {
  return new Set([...text].map((char) => char.codePointAt(0) ?? 0));
}

describe("parseFcCharsets", () => {
  it("16 進の範囲と単独の値を読み、フォントごとの行をまとめる", () => {
    const covered = parseFcCharsets("20-22 41\n3042-3043 1f600\n\n");

    expect([...covered].sort((a, b) => a - b)).toEqual([
      0x20, 0x21, 0x22, 0x41, 0x3042, 0x3043, 0x1f600,
    ]);
  });
});

describe("isIgnorableChar", () => {
  it("ZWJ、異体字セレクタ、結合文字、制御文字は対象外", () => {
    for (const char of ["‍", "️", "︎", "́", "\n", "\t"]) {
      expect(isIgnorableChar(char)).toBe(true);
    }
  });

  it("ふつうの字は対象", () => {
    for (const char of ["あ", "A", "한", "🦀", " "]) {
      expect(isIgnorableChar(char)).toBe(false);
    }
  });
});

describe("findMissingGlyphs", () => {
  const covered = codePoints("あいう ABC🦀");

  it("一覧にない字を、字ごとに、場所と回数をまとめて返す", () => {
    const result = findMissingGlyphs(
      [
        { label: "第1章", text: "あ한い한" },
        { label: "第2章", text: "う한们" },
      ],
      covered,
    );

    expect(result.missing).toEqual([
      {
        char: "한",
        codePoint: 0xd55c,
        count: 3,
        locations: [
          { label: "第1章", count: 2 },
          { label: "第2章", count: 1 },
        ],
      },
      {
        char: "们",
        codePoint: 0x4eec,
        count: 1,
        locations: [{ label: "第2章", count: 1 }],
      },
    ]);
  });

  it("サロゲートペアの字を1字として扱う", () => {
    const result = findMissingGlyphs(
      [{ label: "本文", text: "🦀𠮷" }],
      covered,
    );

    expect(result.missing.map((glyph) => glyph.codePoint)).toEqual([0x20bb7]);
  });

  it("ZWJ、異体字セレクタ、結合文字は、一覧になくても足りない字にしない", () => {
    const result = findMissingGlyphs(
      [{ label: "本文", text: "🦀‍🦀️Á\n" }],
      covered,
    );

    expect(result.missing).toEqual([]);
  });
});

describe("decodeHtmlEntities / htmlToText", () => {
  it("数値と主な名前の文字参照を戻す", () => {
    expect(decodeHtmlEntities("&lt;&#xD55C;&#12354;&amp;&quot;&foo;")).toBe(
      '<한あ&"&foo;',
    );
  });

  it("タグ、script、style、コメントを外す", () => {
    expect(
      htmlToText(
        "<p>本<b>文</b></p><script>漢</script><style>.a{}</style><!-- 註 -->",
      ).replace(/\s+/g, ""),
    ).toBe("本文");
  });
});

describe("extractTextSegments", () => {
  it("表紙・目次、章（章の名前で）、奥付に分け、Mermaid の文字も含める", () => {
    const html = `<html><head><title>題</title><style>x</style></head><body>
<div class="cover"><h1>本の題</h1></div><nav class="toc">目次</nav>
<main class="content">
<section class="chapter" id="chapter-1">
  <h1 class="chapter-title">はじめに &amp; 準備</h1>
  <div class="znc chapter-body"><p>一</p><pre class="mermaid">A[入口] --&gt; B</pre></div>
</section>
<section class="chapter" id="chapter-2">
  <h1 class="chapter-title">認証</h1>
  <div class="znc chapter-body"><p>二</p></div>
</section>
</main>
<section class="colophon">奥付の文</section>
<script>window.mermaid = "台";</script>
</body></html>`;

    const segments = extractTextSegments(html).map(({ label, text }) => ({
      label,
      text: text.replace(/\s+/g, ""),
    }));

    expect(segments).toEqual([
      { label: "表紙・目次", text: "本の題目次" },
      { label: "はじめに & 準備", text: "はじめに&準備一A[入口]-->B" },
      { label: "認証", text: "認証二" },
      { label: "奥付", text: "奥付の文" },
    ]);
  });

  it("章がなければ、全体を1つにする", () => {
    expect(extractTextSegments("<body><p>字</p></body>")).toEqual([
      { label: "本文", text: expect.stringContaining("字") as string },
    ]);
  });
});

describe("checkGlyphs", () => {
  const segments = [{ label: "本文", text: "あ한" }];

  it("Linux 以外では調べない", () => {
    let called = false;
    const result = checkGlyphs(segments, {
      platform: "darwin",
      runFcList: () => {
        called = true;
        return { ok: true, stdout: "" };
      },
    });

    expect(result.status).toBe("skipped");
    expect(called).toBe(false);
  });

  it("fc-list の字の一覧と比べる", () => {
    const result = checkGlyphs(segments, {
      platform: "linux",
      runFcList: () => ({ ok: true, stdout: "3042\n" }),
    });

    expect(result).toMatchObject({ status: "checked", checkedChars: 2 });
    expect(
      result.status === "checked" && result.missing.map((m) => m.char),
    ).toEqual(["한"]);
  });

  it("fc-list が使えない、またはフォントがなければ failed", () => {
    expect(
      checkGlyphs(segments, {
        platform: "linux",
        runFcList: () => ({ ok: false, stdout: "" }),
      }).status,
    ).toBe("failed");
    expect(
      checkGlyphs(segments, {
        platform: "linux",
        runFcList: () => ({ ok: true, stdout: "\n" }),
      }).status,
    ).toBe("failed");
  });
});

describe("formatGlyphCheckReport / reportGlyphCheck", () => {
  const missing: GlyphCheckResult = {
    status: "checked",
    checkedChars: 10,
    missing: [
      {
        char: "한",
        codePoint: 0xd55c,
        count: 3,
        locations: [
          { label: "第1章", count: 2 },
          { label: "第2章", count: 1 },
        ],
      },
    ],
  };
  const clean: GlyphCheckResult = {
    status: "checked",
    checkedChars: 10,
    missing: [],
  };

  function capture() {
    const lines: { level: string; line: string }[] = [];
    return {
      lines,
      output: {
        log: (line: string) => lines.push({ level: "log", line }),
        warn: (line: string) => lines.push({ level: "warn", line }),
        error: (line: string) => lines.push({ level: "error", line }),
      },
    };
  }

  it("足りない字がなければ、1行の要約", () => {
    expect(formatGlyphCheckReport(clean)).toEqual({
      ok: true,
      lines: ["🔡 字: 10 種類の字が、すべてフォントにあります（豆腐なし）"],
    });
  });

  it("足りない字を、文字コード、字、場所と回数で出す", () => {
    const report = formatGlyphCheckReport(missing);

    expect(report.ok).toBe(false);
    expect(report.lines[0]).toContain("フォントにない字が 1 種類");
    expect(report.lines[1]).toBe("   U+D55C 한：第1章（2回）、第2章（1回）");
  });

  it("多いときは 30 種類まで出し、残りの数を出す", () => {
    const many: GlyphCheckResult = {
      status: "checked",
      checkedChars: 40,
      missing: Array.from({ length: 35 }, (_, i) => ({
        char: String.fromCodePoint(0xac00 + i),
        codePoint: 0xac00 + i,
        count: 1,
        locations: [{ label: "本文", count: 1 }],
      })),
    };

    expect(formatGlyphCheckReport(many).lines).toContain("   ほか 5 種類");
  });

  it("warn なら警告として出し、止めない", () => {
    const { lines, output } = capture();

    reportGlyphCheck(missing, "warn", output);

    expect(lines.every(({ level }) => level === "warn")).toBe(true);
  });

  it("error なら、足りない字があるとき GlyphCheckError を投げる", () => {
    const { lines, output } = capture();

    expect(() => reportGlyphCheck(missing, "error", output)).toThrow(
      GlyphCheckError,
    );
    expect(lines.every(({ level }) => level === "error")).toBe(true);
  });

  it("error でも、調べられなかったとき（failed）は止める。Linux 以外（skipped）は止めない", () => {
    const { output } = capture();

    expect(() =>
      reportGlyphCheck({ status: "failed", error: "x" }, "error", output),
    ).toThrow(GlyphCheckError);
    expect(() =>
      reportGlyphCheck({ status: "skipped", reason: "y" }, "error", output),
    ).not.toThrow();
    expect(() => reportGlyphCheck(clean, "error", output)).not.toThrow();
  });

  it("off なら何も出さない", () => {
    const { lines, output } = capture();

    reportGlyphCheck(missing, "off", output);

    expect(lines).toEqual([]);
  });
});
