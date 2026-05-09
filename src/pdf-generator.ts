import fs from "fs-extra";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
import path from "path";
import {
  DEFAULT_CONFIG,
  type PdfConfig,
  type PdfHeaderFooter,
  type PdfMargin,
} from "./config-loader.ts";

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

export async function mergePdfBuffers(pdfBuffers: Buffer[]): Promise<Buffer> {
  const mergedDocument = await PDFDocument.create();

  for (const pdfBuffer of pdfBuffers) {
    const sourceDocument = await PDFDocument.load(pdfBuffer);
    const pages = await mergedDocument.copyPages(
      sourceDocument,
      sourceDocument.getPageIndices(),
    );

    for (const page of pages) {
      mergedDocument.addPage(page);
    }
  }

  const mergedBytes = await mergedDocument.save();
  return Buffer.from(mergedBytes);
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
