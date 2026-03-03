import markdownHtml from "zenn-markdown-html";
import { readFileSync } from "fs";
import { createRequire } from "module";
import fs from "fs-extra";
import path from "path";
import type { PdfFonts } from "./config-loader.ts";

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

interface PdfConfigLike {
  fonts?: PdfFonts;
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
  return typeof rendered === "string" ? rendered : String(rendered);
}

export async function buildBookHtml(
  book: ParsedBook,
  pdfConfig: PdfConfigLike = {},
): Promise<string> {
  const { config, chapters } = book;
  const zennCss = getZennCss();
  const fonts = normalizeFonts(pdfConfig.fonts);

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

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(config.title ?? "Zenn Book")}</title>
  <style>${zennCss}</style>
  <style>${getBookStyles(fonts)}</style>
</head>
<body>
  <div class="cover">
    <h1 class="book-title">${escapeHtml(config.title ?? "")}</h1>
    ${config.summary ? `<p class="book-summary">${escapeHtml(config.summary)}</p>` : ""}
  </div>

  <nav class="toc">
    <h2>目次</h2>
    <ol>${tocItems}</ol>
  </nav>

  <main class="content">
    ${chaptersHtml}
  </main>
</body>
</html>`;
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
    return `data:${getMimeType(ext)};base64,${buffer.toString("base64")}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️  画像の埋め込みに失敗しました: ${src} (${message})`);
    return null;
  }
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
): string {
  const bodyFamily =
    fonts.bodyFamily ||
    "'Noto Serif CJK JP', 'Noto Serif JP', 'Noto Serif', 'IPAexMincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif";
  const headingFamily =
    fonts.headingFamily ||
    "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans', 'IPAexGothic', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif";

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
    @page { margin: 0; }
    @page :first { margin: 0; }
  `;
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
