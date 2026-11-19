import fs from "fs-extra";
import puppeteer from "puppeteer";
import path from "path";
import {
  DEFAULT_CONFIG,
  type PdfConfig,
  type PdfHeaderFooter,
  type PdfMargin,
} from "./config-loader.ts";
import { getPaperSize } from "./md-renderer.ts";

const CSS_PX_PER_UNIT: Record<string, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
};

/** "7mm" のような長さを CSS px に直す。読めない値は 0 とする。 */
export function toCssPx(length: string): number {
  const match = /^\s*([\d.]+)\s*(px|in|cm|mm|pt)?\s*$/i.exec(length);
  if (!match) {
    return 0;
  }
  const unit = (match[2] ?? "px").toLowerCase();
  return parseFloat(match[1] ?? "0") * (CSS_PX_PER_UNIT[unit] ?? 1);
}

export interface PdfGenerationOverrides {
  margin?: PdfMargin;
  header?: Partial<PdfHeaderFooter>;
  footer?: Partial<PdfHeaderFooter>;
}

function resolvePdfConfig(
  pdfConfig: PdfConfig,
  overrides: PdfGenerationOverrides = {},
): PdfConfig {
  return {
    ...pdfConfig,
    margin: overrides.margin ?? pdfConfig.margin,
    header: {
      ...pdfConfig.header,
      ...(overrides.header ?? {}),
    },
    footer: {
      ...pdfConfig.footer,
      ...(overrides.footer ?? {}),
    },
  };
}

export async function savePdfBuffer(
  pdfBuffer: Buffer,
  outputPath: string,
): Promise<void> {
  await fs.writeFile(outputPath, pdfBuffer);
  console.log(`PDF を生成しました: ${path.resolve(outputPath)}`);
}

export async function renderPdfBuffer(
  html: string,
  pdfConfig: PdfConfig = DEFAULT_CONFIG,
  overrides: PdfGenerationOverrides = {},
): Promise<Buffer> {
  const effectiveConfig = resolvePdfConfig(pdfConfig, overrides);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // 印刷時と同じ幅・同じメディアで組んでから計測する（タイトルの1行化や図の幅のため）
    const [paperWidthIn] = getPaperSize(effectiveConfig.pageSize);
    const contentWidth =
      paperWidthIn * 96 -
      toCssPx(effectiveConfig.margin.left) -
      toCssPx(effectiveConfig.margin.right);
    await page.setViewport({
      width: Math.max(1, Math.floor(contentWidth)),
      height: 800,
    });
    await page.emulateMediaType("print");

    await page.setContent(html, {
      waitUntil: effectiveConfig.render.waitUntil,
      timeout: effectiveConfig.render.navigationTimeout,
    });

    await page.evaluate(() => {
      document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        if (img instanceof HTMLImageElement) {
          img.loading = "eager";
        }
      });
    });

    // タイトルが少しだけはみ出すときは、文字を縮めて1行に収める。
    // 18pt まで縮めても収まらない長いタイトルは、元の大きさで折り返す。
    await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>(".book-title");
      if (!title) {
        return;
      }
      const original = parseFloat(getComputedStyle(title).fontSize);
      const minimum = (18 * 96) / 72;
      // 折り返す前の幅を基準にする（nowrap にすると親の幅が広がるため固定する）
      const available = title.clientWidth;
      title.style.width = `${available}px`;
      title.style.whiteSpace = "nowrap";
      let size = original;
      while (title.scrollWidth > available && size > minimum) {
        size -= 1;
        title.style.fontSize = `${size}px`;
      }
      if (title.scrollWidth > available) {
        title.style.whiteSpace = "";
        title.style.fontSize = "";
      }
      title.style.width = "";
    });

    // 罫線や矢印の文字で描いた図（ディレクトリツリーなど）は、折り返すと形が崩れる。
    // 折り返さずに、収まるまで文字を縮める。元の 6 割まで縮めても収まらなければ折り返す。
    await page.evaluate(() => {
      const art = /[─│┌┐└┘├┤┬┴┼▶◀▲▼]/;
      document.querySelectorAll<HTMLElement>(".znc pre").forEach((pre) => {
        const code = pre.querySelector<HTMLElement>("code");
        if (!code || !art.test(code.textContent ?? "")) {
          return;
        }
        pre.style.whiteSpace = "pre";
        if (pre.scrollWidth <= pre.clientWidth) {
          return;
        }
        const original = parseFloat(getComputedStyle(code).fontSize);
        let size = original;
        while (pre.scrollWidth > pre.clientWidth && size > original * 0.6) {
          size -= 0.25;
          code.style.fontSize = `${size}px`;
        }
        if (pre.scrollWidth > pre.clientWidth) {
          pre.style.whiteSpace = "";
          code.style.fontSize = "";
        }
      });
    });

    // 表は、まず単語の途中で改行しない組み方を試す。見出しの日本語も語の途中で改行しない。
    // ページ幅に収まらなければ、まず見出しの指定を外し、それでも収まらない表
    // （長いパスや識別子を含む表）だけ、どこでも改行する組み方に戻す。
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.querySelectorAll<HTMLElement>(".znc table").forEach((table) => {
        const container = table.parentElement;
        if (!container) {
          return;
        }
        // 関数を作ると tsx の __name がブラウザ側に入り込んで失敗するので、比較を2回書く
        table.classList.add("keep-words", "keep-headings");
        if (table.offsetWidth > container.clientWidth) {
          table.classList.remove("keep-headings");
        }
        if (table.offsetWidth > container.clientWidth) {
          table.classList.remove("keep-words");
        }
      });
    });

    const mermaidError = await page.evaluate(async () => {
      const mermaid = (
        window as unknown as {
          mermaid?: {
            run: (options: { querySelector: string }) => Promise<void>;
          };
        }
      ).mermaid;
      if (!mermaid || !document.querySelector("pre.mermaid")) {
        return null;
      }
      try {
        await mermaid.run({ querySelector: "pre.mermaid" });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });
    if (mermaidError) {
      console.warn(`⚠️  mermaid の図の描画に失敗しました: ${mermaidError}`);
    }

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("img")].every(
          (img) => !(img instanceof HTMLImageElement) || img.complete,
        ),
      { timeout: effectiveConfig.render.imageTimeout },
    );

    const useHeaderFooter =
      effectiveConfig.header.enabled || effectiveConfig.footer.enabled;

    const pdfBytes = await page.pdf({
      format: effectiveConfig.pageSize,
      printBackground: true,
      // 見出しからしおり（PDF のアウトライン）を作る。outline には tagged が必要。
      tagged: true,
      outline: true,
      margin: effectiveConfig.margin,
      displayHeaderFooter: useHeaderFooter,
      headerTemplate: effectiveConfig.header.enabled
        ? effectiveConfig.header.template
        : "<div></div>",
      footerTemplate: effectiveConfig.footer.enabled
        ? effectiveConfig.footer.template
        : "<div></div>",
    });

    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

export async function generatePdf(
  html: string,
  outputPath: string,
  pdfConfig: PdfConfig = DEFAULT_CONFIG,
  overrides: PdfGenerationOverrides = {},
): Promise<void> {
  const pdfBuffer = await renderPdfBuffer(html, pdfConfig, overrides);
  await savePdfBuffer(pdfBuffer, outputPath);
}
