import path from "path";

export const CLI_USAGE_LINES = [
  "使い方: node src/index.ts <bookディレクトリ> [出力ファイル.pdf] [--config <コンフィグファイル>]",
  "例: node src/index.ts ../zenn-tech-articles/books/my-book output.pdf",
  "例: node src/index.ts ../zenn-tech-articles/books/my-book output.pdf --config pdf.config.json",
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

  const positionalArgs =
    configFlagIndex !== -1
      ? args.filter(
          (_, i) => i !== configFlagIndex && i !== configFlagIndex + 1,
        )
      : args;

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
  };
}

export function printCliUsage(): void {
  for (const line of CLI_USAGE_LINES) {
    console.error(line);
  }
}
