import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  buildImageCoverHtml,
  embedImages,
  renderMarkdown,
  resolveCoverImage,
} from "../../src/md-renderer.ts";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");
const MINIMAL_JPEG_BUFFER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
  vi.restoreAllMocks();
});

describe("embedImages", () => {
  describe("ローカル画像", () => {
    it("相対パスの PNG を data URI に変換する", async () => {
      await fs.writeFile(path.join(tmpDir, "image.png"), TINY_PNG_BUFFER);

      const html = '<img src="image.png" alt="test">';
      const result = await embedImages(html, tmpDir);

      expect(result).toContain("data:image/png;base64,");
      expect(result).not.toContain('src="image.png"');
    });

    it("./プレフィックス付き相対パスを解決する", async () => {
      await fs.writeFile(path.join(tmpDir, "photo.png"), TINY_PNG_BUFFER);

      const html = '<img src="./photo.png">';
      const result = await embedImages(html, tmpDir);

      expect(result).toContain("data:image/png;base64,");
    });

    it("/ から始まる絶対パスをリポジトリルート基準で解決する", async () => {
      const bookPath = path.join(tmpDir, "books", "my-book");
      await fs.ensureDir(bookPath);
      await fs.ensureDir(path.join(tmpDir, "images"));
      await fs.writeFile(
        path.join(tmpDir, "images", "logo.png"),
        TINY_PNG_BUFFER,
      );

      const html = '<img src="/images/logo.png">';
      const result = await embedImages(html, bookPath);

      expect(result).toContain("data:image/png;base64,");
    });

    it("JPEG ファイルを正しい MIME タイプで変換する", async () => {
      await fs.writeFile(path.join(tmpDir, "photo.jpg"), MINIMAL_JPEG_BUFFER);

      const html = '<img src="photo.jpg" class="hero">';
      const result = await embedImages(html, tmpDir);

      expect(result).toContain("data:image/jpeg;base64,");
    });

    it("複数の画像を全て変換する", async () => {
      await fs.writeFile(path.join(tmpDir, "a.png"), TINY_PNG_BUFFER);
      await fs.writeFile(path.join(tmpDir, "b.png"), TINY_PNG_BUFFER);

      const html = '<img src="a.png"><p>text</p><img src="b.png">';
      const result = await embedImages(html, tmpDir);

      expect(result).not.toContain('src="a.png"');
      expect(result).not.toContain('src="b.png"');
      expect(result.match(/data:image\/png;base64,/g)).toHaveLength(2);
    });

    it("存在しないファイルは警告を出して src を変えない", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const html = '<img src="missing.png">';
      const result = await embedImages(html, tmpDir);

      expect(result).toContain('src="missing.png"');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing.png"),
      );
    });
  });

  describe("既存の data URI", () => {
    it("data: から始まる src はそのまま保持する", async () => {
      const dataUri = `data:image/png;base64,${TINY_PNG_BASE64}`;
      const html = `<img src="${dataUri}">`;
      const result = await embedImages(html, tmpDir);

      expect(result).toBe(html);
    });
  });

  describe("リモート画像", () => {
    it("https URL を fetch して data URI に変換する", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(TINY_PNG_BUFFER.buffer),
          headers: { get: () => "image/png" },
        }),
      );

      const html = '<img src="https://example.com/img.png">';
      const result = await embedImages(html, tmpDir);

      expect(result).toContain("data:image/png;base64,");
    });

    it("fetch 失敗時は警告を出して src を変えない", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          headers: { get: () => null },
        }),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const html = '<img src="https://example.com/notfound.png">';
      const result = await embedImages(html, tmpDir);

      expect(result).toContain('src="https://example.com/notfound.png"');
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("img タグの属性保持", () => {
    it("src 以外の属性（alt, class など）を保持する", async () => {
      await fs.writeFile(path.join(tmpDir, "img.png"), TINY_PNG_BUFFER);

      const html = '<img class="hero" src="img.png" alt="description">';
      const result = await embedImages(html, tmpDir);

      expect(result).toContain('class="hero"');
      expect(result).toContain('alt="description"');
    });
  });
});

describe("resolveCoverImage", () => {
  it("cover.png を優先して data URI に変換する", async () => {
    await fs.writeFile(path.join(tmpDir, "cover.png"), TINY_PNG_BUFFER);
    await fs.writeFile(path.join(tmpDir, "cover.jpeg"), MINIMAL_JPEG_BUFFER);

    const result = await resolveCoverImage(tmpDir);

    expect(result).not.toBeNull();
    expect(result?.fileName).toBe("cover.png");
    expect(result?.dataUri).toContain("data:image/png;base64,");
  });

  it("cover.png がない場合は cover.jpeg を使う", async () => {
    await fs.writeFile(path.join(tmpDir, "cover.jpeg"), MINIMAL_JPEG_BUFFER);

    const result = await resolveCoverImage(tmpDir);

    expect(result).not.toBeNull();
    expect(result?.fileName).toBe("cover.jpeg");
    expect(result?.dataUri).toContain("data:image/jpeg;base64,");
  });

  it("表紙画像がない場合は null を返す", async () => {
    await expect(resolveCoverImage(tmpDir)).resolves.toBeNull();
  });

  it("壊れた表紙画像は警告して null を返す", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fs.writeFile(path.join(tmpDir, "cover.png"), Buffer.from("broken"));

    const result = await resolveCoverImage(tmpDir);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("cover.png"));
  });
});

describe("buildImageCoverHtml", () => {
  it("全面表紙用の HTML を組み立てる", () => {
    const html = buildImageCoverHtml(
      {
        config: { title: "Cover Book" },
        chapters: [],
        bookPath: tmpDir,
      },
      {
        fileName: "cover.png",
        dataUri: `data:image/png;base64,${TINY_PNG_BASE64}`,
      },
    );

    expect(html).toContain('class="image-cover"');
    expect(html).toContain("object-fit: cover;");
    expect(html).toContain("@page {");
    expect(html).toContain("margin: 0;");
    expect(html).toContain(`data:image/png;base64,${TINY_PNG_BASE64}`);
  });
});

describe("renderMarkdown", () => {
  describe("details タグの open 属性付与", () => {
    it(":::details から生成された <details> に open 属性を付与する", async () => {
      const md = ":::details タイトル\n内容テキスト\n:::";
      const result = await renderMarkdown(md);

      expect(result).toContain("<details open>");
      expect(result).not.toContain("<details>");
    });

    it("details を含まない Markdown には影響しない", async () => {
      const md = "# 見出し\n普通のテキスト";
      const result = await renderMarkdown(md);

      expect(result).not.toContain("<details");
    });

    it("複数の :::details が全て open 付きになる", async () => {
      const md =
        ":::details 一つ目\n内容1\n:::\n\n:::details 二つ目\n内容2\n:::";
      const result = await renderMarkdown(md);

      const matches = result.match(/<details open>/g);
      expect(matches).toHaveLength(2);
      expect(result).not.toContain("<details>");
    });
  });
});
