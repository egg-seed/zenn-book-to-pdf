import puppeteer from "puppeteer";
import path from "path";
import { DEFAULT_CONFIG, type PdfConfig } from "./config-loader.ts";

export async function generatePdf(
  html: string,
  outputPath: string,
  pdfConfig: PdfConfig = DEFAULT_CONFIG,
): Promise<void> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 60000,
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
      { timeout: 30000 },
    );

    const useHeaderFooter =
      pdfConfig.header.enabled || pdfConfig.footer.enabled;

    await page.pdf({
      path: outputPath,
      format: pdfConfig.pageSize,
      printBackground: true,
      margin: pdfConfig.margin,
      displayHeaderFooter: useHeaderFooter,
      headerTemplate: pdfConfig.header.enabled
        ? pdfConfig.header.template
        : "<div></div>",
      footerTemplate: pdfConfig.footer.enabled
        ? pdfConfig.footer.template
        : "<div></div>",
    });

    console.log(`PDF を生成しました: ${path.resolve(outputPath)}`);
  } finally {
    await browser.close();
  }
}
