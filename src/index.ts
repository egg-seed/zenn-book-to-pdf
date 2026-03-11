import fs from "fs-extra";
import { spawnSync } from "child_process";
import { parseBook } from "./book-parser.ts";
import { buildBookHtml } from "./md-renderer.ts";
import { generatePdf } from "./pdf-generator.ts";
import { loadPdfConfig, type PdfConfig } from "./config-loader.ts";
import { CliUsageError, parseCliArgs, printCliUsage } from "./cli-args.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let bookPath: string;
  let outputPath: string;
  let configPath: string | null;

  try {
    ({ bookPath, outputPath, configPath } = parseCliArgs(args));
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(`エラー: ${err.message}`);
      printCliUsage();
      process.exit(1);
    }

    throw err;
  }

  if (!(await fs.pathExists(bookPath))) {
    console.error(`エラー: ディレクトリが見つかりません: ${bookPath}`);
    process.exit(1);
  }

  const pdfConfig = await loadPdfConfig(configPath ?? null);
  warnIfNotoFontsUnavailable(pdfConfig);

  console.log(`📖 Zenn book を読み込み中: ${bookPath}`);
  const book = await parseBook(bookPath);
  console.log(`  タイトル: ${book.config.title}`);
  console.log(`  章数: ${book.chapters.length}`);

  console.log("🔄 HTML に変換中...");
  const html = await buildBookHtml(book, pdfConfig);

  console.log("📄 PDF を生成中...");
  await generatePdf(html, outputPath, pdfConfig);

  console.log("✅ 完了!");
}

function warnIfNotoFontsUnavailable(pdfConfig: PdfConfig): void {
  const bodyFamily = pdfConfig.fonts.bodyFamily;
  const headingFamily = pdfConfig.fonts.headingFamily;
  const selectedFonts = `${bodyFamily} ${headingFamily}`.toLowerCase();

  if (!selectedFonts.includes("noto")) {
    return;
  }

  const fcList = spawnSync("fc-list", ["--format=%{family}\n"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (fcList.error || fcList.status !== 0) {
    console.warn(
      "⚠️  Noto フォント利用時は環境にフォントが必要です。Linux では fonts-noto-cjk のインストールを検討してください。",
    );
    return;
  }

  const installedFamilies = fcList.stdout.toLowerCase();
  const hasNotoSans =
    installedFamilies.includes("noto sans jp") ||
    installedFamilies.includes("noto sans cjk jp");
  const hasNotoSerif =
    installedFamilies.includes("noto serif jp") ||
    installedFamilies.includes("noto serif cjk jp");

  if (!hasNotoSans || !hasNotoSerif) {
    console.warn(
      "⚠️  Noto Sans/Serif JP が見つかりません。フォールバックフォントで出力される可能性があります。docs/font-setup.md を参照してインストールしてください。",
    );
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("エラー:", message);
  process.exit(1);
});
