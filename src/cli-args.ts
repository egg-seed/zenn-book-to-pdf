import path from "path";
import { isFontCheckMode, type FontCheckMode } from "./font-check.ts";

export const CLI_USAGE_LINES = [
  "使い方: node src/index.ts <bookディレクトリ> [出力ファイル.pdf] [--config <コンフィグファイル>] [--font-check warn|error|off]",
  "例: node src/index.ts ../zenn-tech-articles/books/my-book output.pdf",
  "例: node src/index.ts ../zenn-tech-articles/books/my-book output.pdf --config pdf.config.json",
  "例: node src/index.ts ../zenn-tech-articles/books/my-book output.pdf --font-check error",
] as const;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface ParsedCliArgs {
  bookPath: string;
  outputPath: string;
  configPath: string | null;
  /** --font-check の値。指定がなければ null（設定ファイルの fontCheck を使う）。 */
  fontCheck: FontCheckMode | null;
}

export function parseCliArgs(
  args: string[],
  cwd: string = process.cwd(),
): ParsedCliArgs {
  const configFlagIndex = args.indexOf("--config");
  let configPath: string | null = null;

  if (configFlagIndex !== -1) {
    const configValue = args[configFlagIndex + 1];

    if (
      configValue == null ||
      configValue.trim() === "" ||
      configValue.startsWith("--")
    ) {
      throw new CliUsageError("--config にはファイルパスが必要です。");
    }

    configPath = path.resolve(cwd, configValue);
  }

  const fontCheckFlagIndex = args.indexOf("--font-check");
  let fontCheck: FontCheckMode | null = null;

  if (fontCheckFlagIndex !== -1) {
    const fontCheckValue = args[fontCheckFlagIndex + 1];
    if (!isFontCheckMode(fontCheckValue)) {
      throw new CliUsageError(
        "--font-check には warn / error / off のいずれかを指定してください。",
      );
    }
    fontCheck = fontCheckValue;
  }

  const flagArgIndexes = new Set<number>();
  for (const index of [configFlagIndex, fontCheckFlagIndex]) {
    if (index !== -1) {
      flagArgIndexes.add(index);
      flagArgIndexes.add(index + 1);
    }
  }
  const positionalArgs = args.filter((_, i) => !flagArgIndexes.has(i));

  const bookArg = positionalArgs[0];

  if (!bookArg) {
    throw new CliUsageError("bookディレクトリを指定してください。");
  }

  return {
    bookPath: path.resolve(cwd, bookArg),
    outputPath: positionalArgs[1]
      ? path.resolve(cwd, positionalArgs[1])
      : path.join(cwd, "output.pdf"),
    configPath,
    fontCheck,
  };
}

export function printCliUsage(): void {
  for (const line of CLI_USAGE_LINES) {
    console.error(line);
  }
}
