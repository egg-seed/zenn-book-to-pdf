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
      fontCheck: null,
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

describe("parseCliArgs --font-check", () => {
  it("未指定なら null", () => {
    expect(parseCliArgs(["book"], cwd).fontCheck).toBeNull();
  });

  it("warn / error / off を受け付け、位置引数から外す", () => {
    const result = parseCliArgs(
      ["book", "--font-check", "error", "out.pdf", "--config", "c.json"],
      cwd,
    );

    expect(result).toEqual({
      bookPath: path.resolve(cwd, "book"),
      outputPath: path.resolve(cwd, "out.pdf"),
      configPath: path.resolve(cwd, "c.json"),
      fontCheck: "error",
    });
  });

  it("値がない、または不正な値ならエラーにする", () => {
    expect(() => parseCliArgs(["book", "--font-check"], cwd)).toThrow(
      CliUsageError,
    );
    expect(() => parseCliArgs(["book", "--font-check", "strict"], cwd)).toThrow(
      "--font-check には warn / error / off のいずれかを指定してください。",
    );
  });
});
