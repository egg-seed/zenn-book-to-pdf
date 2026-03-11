import { describe, expect, it } from "vitest";
import path from "path";
import { CliUsageError, parseCliArgs } from "../../src/cli-args.ts";

const cwd = "/tmp/zenn-book-to-pdf";

describe("parseCliArgs", () => {
  it("--config に値がある場合は正常に解釈する", () => {
    const result = parseCliArgs(
      ["book", "output.pdf", "--config", "pdf.config.json"],
      cwd,
    );

    expect(result).toEqual({
      bookPath: path.resolve(cwd, "book"),
      outputPath: path.resolve(cwd, "output.pdf"),
      configPath: path.resolve(cwd, "pdf.config.json"),
    });
  });

  it("--config が末尾ならエラーにする", () => {
    expect(() => parseCliArgs(["book", "--config"], cwd)).toThrowError(
      new CliUsageError("--config にはファイルパスが必要です。"),
    );
  });

  it("--config の次が別フラグならエラーにする", () => {
    expect(() => parseCliArgs(["book", "--config", "--foo"], cwd)).toThrow(
      "--config にはファイルパスが必要です。",
    );
  });

  it("--config の値が空文字ならエラーにする", () => {
    expect(() => parseCliArgs(["book", "--config", ""], cwd)).toThrow(
      "--config にはファイルパスが必要です。",
    );
  });
});
