import markdownHtml from "zenn-markdown-html";
import { readFileSync } from "fs";
import { createRequire } from "module";
import fs from "fs-extra";
import path from "path";
import type { PdfFonts, PdfMargin } from "./config-loader.ts";

const require = createRequire(import.meta.url);

export interface BookConfig {
  title?: string;
  summary?: string;
}

export interface Chapter {
  title?: string;
  slug: string;
  content: string;
}

export interface ParsedBook {
  config: BookConfig;
  chapters: Chapter[];
  bookPath: string;
}

export interface CoverImage {
  fileName: string;
  dataUri: string;
}

interface PdfConfigLike {
  fonts?: PdfFonts;
  margin?: Partial<PdfMargin>;
  summary?: string;
  pageSize?: string;
}

/** Puppeteer の PaperFormat と同じ寸法（インチ、幅 x 高さ） */
const PAPER_SIZES_IN: Record<string, [number, number]> = {
  letter: [8.5, 11],
  legal: [8.5, 14],
  tabloid: [11, 17],
  ledger: [17, 11],
  a0: [33.1102, 46.811],
  a1: [23.3858, 33.1102],
  a2: [16.5354, 23.3858],
  a3: [11.6929, 16.5354],
  a4: [8.2677, 11.6929],
  a5: [5.8268, 8.2677],
  a6: [4.1339, 5.8268],
};

function getPaperSize(pageSize: string | undefined): [number, number] {
  return PAPER_SIZES_IN[(pageSize ?? "a5").toLowerCase()] ?? PAPER_SIZES_IN.a5;
}

const MERMAID_EMBED_REGEX =
  /<span class="embed-block zenn-embedded zenn-embedded-mermaid"><iframe\b[^>]*?\bdata-content="([^"]*)"[^>]*><\/iframe><\/span>/gi;

function getMermaidScript(): string {
  const scriptPath = path.join(
    path.dirname(require.resolve("mermaid/package.json")),
    "dist",
    "mermaid.min.js",
  );
  // Escape any closing script tag so the inlined bundle cannot end the element early.
  return readFileSync(scriptPath, "utf8").replace(/<\/script/gi, "<\\/script");
}

/**
 * Zenn renders mermaid blocks as iframes to embed.zenn.studio, which stay blank in a PDF.
 * Replace them with <pre class="mermaid"> so mermaid can draw them inside the page.
 */
export function convertMermaidEmbeds(html: string): string {
  return html.replace(MERMAID_EMBED_REGEX, (fullMatch, encoded: string) => {
    let source: string;
    try {
      source = decodeURIComponent(encoded);
    } catch {
      console.warn(
        "⚠️  mermaid のコードを読み取れませんでした。そのまま残します。",
      );
      return fullMatch;
    }
    return `<div class="mermaid-diagram"><pre class="mermaid">${escapeHtml(source)}</pre></div>`;
  });
}

function buildMermaidScripts(html: string, fonts: PdfFonts): string {
  if (!html.includes('class="mermaid"')) {
    return "";
  }
  const options = {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    fontFamily: fonts.headingFamily,
  };
  return `<script>${getMermaidScript()}</script>
  <script>mermaid.initialize(${JSON.stringify(options).replace(/</g, "\\u003c")});</script>`;
}

function getZennCss(): string {
  try {
    const cssPath = require.resolve("zenn-content-css/lib/index.css");
    return readFileSync(cssPath, "utf8");
  } catch {
    return "";
  }
}

export async function renderMarkdown(markdownText: string): Promise<string> {
  const render = markdownHtml as (
    markdown: string,
    options: { embedOrigin: string },
  ) => Promise<string> | string;
  const rendered = await render(markdownText, {
    embedOrigin: "https://embed.zenn.studio",
  });
  const html = typeof rendered === "string" ? rendered : String(rendered);
  return convertMermaidEmbeds(html.replace(/<details>/gi, "<details open>"));
}

export async function buildBookHtml(
  book: ParsedBook,
  pdfConfig: PdfConfigLike = {},
  coverImage: CoverImage | null = null,
): Promise<string> {
  const { config, chapters } = book;
  const zennCss = getZennCss();
  const fonts = normalizeFonts(pdfConfig.fonts);
  const margin = normalizeMargin(pdfConfig.margin);

  const tocItems = chapters
    .map(
      (ch, i) =>
        `<li><a href="#chapter-${i + 1}">${escapeHtml(ch.title || ch.slug)}</a></li>`,
    )
    .join("\n");

  const chaptersHtmlArray = await Promise.all(
    chapters.map(async (ch, i) => {
      const renderedBody = await renderMarkdown(ch.content);
      const body = await embedImages(renderedBody, book.bookPath);
      const title = ch.title || ch.slug;
      return `
<section class="chapter" id="chapter-${i + 1}">
  <h1 class="chapter-title">${escapeHtml(title)}</h1>
  <div class="znc chapter-body">${body}</div>
</section>`;
    }),
  );
  const chaptersHtml = chaptersHtmlArray.join("\n");
  const summary = pdfConfig.summary ?? config.summary;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(config.title ?? "Zenn Book")}</title>
  <style>${zennCss}</style>
  <style>${getBookStyles(fonts, margin)}</style>
  ${coverImage ? `<style>${getImageCoverStyles(getPaperSize(pdfConfig.pageSize))}</style>` : ""}
</head>
<body>
  ${coverImage ? buildImageCoverSection(config.title, coverImage) : ""}
  <div class="cover">
    <h1 class="book-title">${escapeHtml(config.title ?? "")}</h1>
    ${summary ? `<p class="book-summary">${escapeHtml(summary)}</p>` : ""}
  </div>

  <nav class="toc">
    <h2>目次</h2>
    <ol>${tocItems}</ol>
  </nav>

  <main class="content">
    ${chaptersHtml}
  </main>
  ${buildMermaidScripts(chaptersHtml, fonts)}
</body>
</html>`;
}

/**
 * 全面表紙。本文と同じ HTML の先頭に置き、余白 0 の名前付きページで出力する。
 * 本文と1回で PDF にするので、目次のリンクとしおりが保たれる。
 */
function buildImageCoverSection(
  title: string | undefined,
  coverImage: CoverImage,
): string {
  return `<section class="image-cover">
    <img src="${coverImage.dataUri}" alt="${escapeHtml(title ?? "Book cover")}">
  </section>`;
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return types[ext] || "image/png";
}

function isPngBuffer(buffer: Buffer): boolean {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return pngSignature.every((byte, index) => buffer[index] === byte);
}

function isJpegBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  );
}

function validateImageBuffer(buffer: Buffer, ext: string): void {
  if (ext === "png" && !isPngBuffer(buffer)) {
    throw new Error("PNG ファイルが壊れているか形式が不正です");
  }

  if ((ext === "jpg" || ext === "jpeg") && !isJpegBuffer(buffer)) {
    throw new Error("JPEG ファイルが壊れているか形式が不正です");
  }
}

async function toDataUri(
  src: string,
  bookPath: string,
  repoRoot: string,
): Promise<string | null> {
  if (src.startsWith("data:")) return null;

  try {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "image/png";
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    }

    const imagePath = src.startsWith("/")
      ? path.join(repoRoot, src)
      : path.resolve(bookPath, src);
    const buffer = await fs.readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase().slice(1);
    validateImageBuffer(buffer, ext);
    return `data:${getMimeType(ext)};base64,${buffer.toString("base64")}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️  画像の埋め込みに失敗しました: ${src} (${message})`);
    return null;
  }
}

export async function resolveCoverImage(
  bookPath: string,
): Promise<CoverImage | null> {
  const repoRoot = path.dirname(path.dirname(bookPath));
  const coverCandidates = ["cover.png", "cover.jpeg"];

  for (const fileName of coverCandidates) {
    const coverPath = path.join(bookPath, fileName);
    if (!(await fs.pathExists(coverPath))) {
      continue;
    }

    const dataUri = await toDataUri(fileName, bookPath, repoRoot);
    if (dataUri) {
      return { fileName, dataUri };
    }
  }

  return null;
}

export async function embedImages(
  html: string,
  bookPath: string,
): Promise<string> {
  const repoRoot = path.dirname(path.dirname(bookPath));
  const imgRegex = /<img(\s[^>]*?)src="([^"]+)"([^>]*?)>/gi;
  const matches = [...html.matchAll(imgRegex)];

  for (const match of matches) {
    const fullMatch = match[0];
    const attrsBefore = match[1] ?? "";
    const src = match[2];
    const attrsAfter = match[3] ?? "";

    if (!src) {
      continue;
    }

    const dataUri = await toDataUri(src, bookPath, repoRoot);
    if (dataUri) {
      html = html.replace(
        fullMatch,
        `<img${attrsBefore}src="${dataUri}"${attrsAfter}>`,
      );
    }
  }

  return html;
}

function escapeHtml(value: unknown): string {
  const safeText =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
      ? String(value)
      : "";

  return safeText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getBookStyles(
  fonts: PdfFonts = { bodyFamily: "", headingFamily: "" },
  margin: PdfMargin = DEFAULT_MARGIN,
): string {
  const bodyFamily =
    fonts.bodyFamily ||
    "'Noto Serif CJK JP', 'Noto Serif JP', 'Noto Serif', 'IPAexMincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif";
  const headingFamily =
    fonts.headingFamily ||
    "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans', 'IPAexGothic', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif";
  const pageMargin = `${margin.top} ${margin.right} ${margin.bottom} ${margin.left}`;

  return `
    * { box-sizing: border-box; }

    body {
      font-family: ${bodyFamily};
      font-size: 11pt;
      line-height: 1.8;
      color: #1a1a1a;
    }

    h1, h2, h3,
    .book-title,
    .chapter-title,
    .toc h2 {
      font-family: ${headingFamily};
      font-weight: 700;
    }

    b, strong {
      font-family: inherit;
      font-weight: 700;
    }

    /* 表紙 */
    .cover {
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 90vh;
      padding: 44px 36px;
      background: #f8f9fa;
    }
    .book-title {
      font-size: 28pt;
      font-weight: 700;
      color: #3d7ebf;
      margin-bottom: 24px;
      line-height: 1.3;
    }
    .book-summary {
      font-size: 12pt;
      color: #555;
      line-height: 1.7;
      white-space: pre-line;
    }

    /* 目次 */
    .toc {
      page-break-after: always;
      padding: 28px 22px;
    }
    .toc h2 {
      font-size: 18pt;
      color: #3d7ebf;
      border-bottom: 2px solid #3d7ebf;
      padding-bottom: 8px;
      margin-bottom: 20px;
    }
    .toc ol { padding-left: 24px; }
    .toc li { margin: 8px 0; font-size: 11pt; }
    .toc a { color: #3d7ebf; text-decoration: none; }

    /* 章 */
    .chapter {
      page-break-before: always;
      padding: 28px 22px;
    }
    .chapter-title {
      font-size: 20pt;
      color: #3d7ebf;
      border-bottom: 3px solid #3d7ebf;
      padding-bottom: 10px;
      margin-bottom: 28px;
    }

    /* 画像 */
    .chapter-body img {
      max-width: 100%;
      display: block;
      margin: 16px auto;
    }

    /* mermaid の図（Zenn の pre 用スタイルを打ち消す） */
    .mermaid-diagram {
      margin: 16px 0;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .znc .mermaid-diagram pre.mermaid {
      background: none;
      color: inherit;
      padding: 0;
      margin: 0;
      border-radius: 0;
      white-space: pre;
      overflow: visible;
    }
    .mermaid-diagram svg {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      height: auto;
    }

    /* コードブロックの折り返し */
    .znc pre {
      max-width: 100%;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .znc pre code {
      white-space: inherit;
      overflow-wrap: inherit;
      word-break: inherit;
    }

    /* ページ設定 */
    @page { margin: ${pageMargin}; }
    @page :first { margin: ${pageMargin}; }
  `;
}

function getImageCoverStyles([widthIn, heightIn]: [number, number]): string {
  return `
    @page image-cover { margin: 0; }
    @page image-cover:first { margin: 0; }

    .image-cover {
      page: image-cover;
      width: ${widthIn}in;
      height: ${heightIn}in;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
    }

    .image-cover img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      margin: 0;
    }
  `;
}

function normalizeMargin(value: unknown): PdfMargin {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_MARGIN };
  }

  const record = value as Record<string, unknown>;

  return {
    top:
      typeof record.top === "string" && record.top.trim() !== ""
        ? record.top
        : DEFAULT_MARGIN.top,
    bottom:
      typeof record.bottom === "string" && record.bottom.trim() !== ""
        ? record.bottom
        : DEFAULT_MARGIN.bottom,
    left:
      typeof record.left === "string" && record.left.trim() !== ""
        ? record.left
        : DEFAULT_MARGIN.left,
    right:
      typeof record.right === "string" && record.right.trim() !== ""
        ? record.right
        : DEFAULT_MARGIN.right,
  };
}

function normalizeFonts(value: unknown): PdfFonts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_FONTS };
  }

  const record = value as Record<string, unknown>;
  const bodyFamily =
    typeof record.bodyFamily === "string"
      ? record.bodyFamily
      : DEFAULT_FONTS.bodyFamily;
  const headingFamily =
    typeof record.headingFamily === "string"
      ? record.headingFamily
      : DEFAULT_FONTS.headingFamily;

  return { bodyFamily, headingFamily };
}

const DEFAULT_FONTS: PdfFonts = {
  bodyFamily:
    "'Noto Serif CJK JP', 'Noto Serif JP', 'Noto Serif', 'IPAexMincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
  headingFamily:
    "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans', 'IPAexGothic', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
};

const DEFAULT_MARGIN: PdfMargin = {
  top: "14mm",
  bottom: "16mm",
  left: "14mm",
  right: "14mm",
};
