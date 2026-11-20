import fs from "fs-extra";
import { spawnSync } from "child_process";
import { parseBook } from "./book-parser.ts";
import { buildBookHtml, resolveCoverImage } from "./md-renderer.ts";
import { generatePdf } from "./pdf-generator.ts";
import { loadPdfConfig, type PdfConfig } from "./config-loader.ts";
import { CliUsageError, parseCliArgs, printCliUsage } from "./cli-args.ts";
import type { FontCheckMode } from "./font-check.ts";
import {
  checkGlyphs,
  extractTextSegments,
  htmlToText,
  reportGlyphCheck,
  type GlyphCheckMode,
  type TextSegment,
} from "./glyph-check.ts";
import {
  checkFontFamilies,
  namedFamilies,
  resolveFontconfig,
} from "./fontconfig.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let bookPath: string;
  let outputPath: string;
  let configPath: string | null;
  let fontCheck: FontCheckMode | null;
  let glyphCheck: GlyphCheckMode | null;

  try {
    ({ bookPath, outputPath, configPath, fontCheck, glyphCheck } =
      parseCliArgs(args));
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

  const loadedConfig = await loadPdfConfig(configPath ?? null);
  // --font-check と --glyph-check は、設定ファイルの値より優先する
  const pdfConfig: PdfConfig = {
    ...loadedConfig,
    fontCheck: fontCheck ?? loadedConfig.fontCheck,
    glyphCheck: glyphCheck ?? loadedConfig.glyphCheck,
  };
  const fontconfig = resolveFontconfig(pdfConfig.fontconfigFile);
  if (fontconfig.message) {
    if (fontconfig.level === "warn") {
      console.warn(fontconfig.message);
    } else {
      console.log(fontconfig.message);
    }
  }
  warnIfFontsUnavailable(pdfConfig, fontconfig.env);

  console.log(`📖 Zenn book を読み込み中: ${bookPath}`);
  const book = await parseBook(bookPath);
  console.log(`  タイトル: ${book.config.title}`);
  console.log(`  章数: ${book.chapters.length}`);

  console.log("🔄 HTML に変換中...");
  const coverImage = await resolveCoverImage(book.bookPath);
  if (coverImage) {
    console.log(`  表紙画像: ${coverImage.fileName}`);
  }
  const html = await buildBookHtml(book, pdfConfig, coverImage);

  if (pdfConfig.glyphCheck !== "off") {
    reportGlyphCheck(
      checkGlyphs(textSegmentsOf(html, pdfConfig), {
        platform: process.platform,
        runFcList: () => runFcList(fontconfig.env),
      }),
      pdfConfig.glyphCheck,
    );
  }

  console.log("📄 PDF を生成中...");
  await generatePdf(html, outputPath, pdfConfig);
  console.log("✅ 完了!");
}

/** 字の検査で調べる文字列：組み立てた HTML と、使うときはヘッダー・フッター。 */
function textSegmentsOf(html: string, pdfConfig: PdfConfig): TextSegment[] {
  const headerFooter = [pdfConfig.header, pdfConfig.footer]
    .filter((part) => part.enabled)
    .map((part) => htmlToText(part.template))
    .join(" ");
  return [
    ...extractTextSegments(html),
    ...(headerFooter.trim()
      ? [{ label: "ヘッダー・フッター", text: headerFooter }]
      : []),
  ];
}

/** Chromium と同じ fontconfig の設定（env）で、見えるフォントの字の一覧を取る。 */
function runFcList(env: NodeJS.ProcessEnv): { ok: boolean; stdout: string } {
  const result = spawnSync("fc-list", ["--format=%{charset}\\n"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
  };
}

/**
 * 本文、見出し、（指定があれば）コードの先頭のフォントが、TrueType のフォントとして見つかるかを確かめる（Linux だけ）。
 * Chromium と同じ fontconfig の設定（env）で調べる。
 */
function warnIfFontsUnavailable(
  pdfConfig: PdfConfig,
  env: NodeJS.ProcessEnv,
): void {
  if (process.platform !== "linux") {
    return;
  }

  const families = [
    pdfConfig.fonts.bodyFamily,
    pdfConfig.fonts.headingFamily,
    pdfConfig.fonts.codeFamily,
  ]
    .filter((fontFamily): fontFamily is string => fontFamily !== undefined)
    .map((fontFamily) => namedFamilies(fontFamily)[0])
    .filter((family): family is string => family !== undefined);

  const warnings = checkFontFamilies([...new Set(families)], (family) => {
    const result = spawnSync(
      "fc-match",
      ["--format=%{family[0]}|%{fontformat}", family],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env },
    );
    return {
      ok: !result.error && result.status === 0,
      stdout: result.stdout ?? "",
    };
  });

  for (const warning of warnings) {
    console.warn(warning);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("エラー:", message);
  process.exit(1);
});
