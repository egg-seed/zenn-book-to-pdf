import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { parseBook } from "../../src/book-parser.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-book-test-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

async function createMinimalBook(
  dir: string,
  overrides: { title?: string; summary?: string } = {},
): Promise<{ title: string; summary: string }> {
  const config = {
    title: "テスト本",
    summary: "テスト用の本です",
    ...overrides,
  };
  await fs.writeFile(
    path.join(dir, "config.yaml"),
    `title: "${config.title}"\nsummary: "${config.summary}"`,
  );
  await fs.writeFile(
    path.join(dir, "chapter1.md"),
    "---\ntitle: 第1章\n---\n# はじめに\nテスト内容",
  );
  return config;
}

describe("parseBook", () => {
  it("bookPath を返り値に含む", async () => {
    await createMinimalBook(tmpDir);
    const book = await parseBook(tmpDir);
    expect(book.bookPath).toBe(tmpDir);
  });

  it("config と chapters も正しく返す", async () => {
    await createMinimalBook(tmpDir);
    const book = await parseBook(tmpDir);
    expect(book.config.title).toBe("テスト本");
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe("第1章");
  });

  it("config.yaml が存在しない場合はエラーを投げる", async () => {
    await expect(parseBook(tmpDir)).rejects.toThrow(
      "config.yaml が見つかりません",
    );
  });
});
