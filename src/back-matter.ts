import fs from "fs-extra";
import path from "path";
import type { PdfBackMatter, PdfColophon, PdfMargin } from "./config-loader.ts";

/** 本文の後に置く画像（data URI にしたもの） */
export interface BackImage {
  fileName: string;
  dataUri: string;
}

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** backMatter.image のファイルを読み、data URI にする。読めなければ警告して null。 */
export async function resolveBackImage(
  backMatter: PdfBackMatter | undefined,
): Promise<BackImage | null> {
  const imagePath = backMatter?.image;
  if (!imagePath) {
    return null;
  }

  const ext = path.extname(imagePath).toLowerCase().slice(1);
  const mime = MIME_TYPES[ext];
  if (!mime) {
    console.warn(
      `⚠️  奥付の前に置く画像は PNG か JPEG にしてください: ${imagePath}`,
    );
    return null;
  }

  try {
    const buffer = await fs.readFile(imagePath);
    return {
      fileName: path.basename(imagePath),
      dataUri: `data:${mime};base64,${buffer.toString("base64")}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `⚠️  奥付の前に置く画像を読み込めませんでした: ${imagePath} (${message})`,
    );
    return null;
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** URL だけの値はリンクにする。 */
function formatValue(value: string): string {
  const escaped = escapeText(value);
  return /^https?:\/\/\S+$/.test(value)
    ? `<a href="${escaped}">${escaped}</a>`
    : escaped;
}

function buildColophon(colophon: PdfColophon, bookTitle: string): string {
  const rows = colophon.rows
    .map(
      (row) =>
        `<tr><th>${escapeText(row.label)}</th><td>${formatValue(row.value)}</td></tr>`,
    )
    .join("\n");
  const note = colophon.note
    ? `<p class="colophon-note">${escapeText(colophon.note)}</p>`
    : "";

  return `
<section class="colophon">
  <div class="colophon-box">
    <p class="colophon-title">${escapeText(colophon.title ?? bookTitle)}</p>
    <table class="colophon-table">${rows}</table>
    ${note}
  </div>
</section>`;
}

/** 本文の後に置く画像と奥付の HTML。どちらもなければ空文字。 */
export function buildBackMatter(
  backImage: BackImage | null,
  colophon: PdfColophon | undefined,
  bookTitle: string,
): string {
  const image = backImage
    ? `
<section class="back-image">
  <img src="${backImage.dataUri}" alt="${escapeText(backImage.fileName)}">
</section>`
    : "";
  return image + (colophon ? buildColophon(colophon, bookTitle) : "");
}

/**
 * 画像は余白 0 のページに収め、奥付は最後のページの下に寄せる。
 * どちらのページにもページ番号は入れない。
 */
export function getBackMatterStyles(
  [widthIn, heightIn]: [number, number],
  margin: PdfMargin,
  headingFamily: string,
): string {
  const pageMargin = `${margin.top} ${margin.right} ${margin.bottom} ${margin.left}`;
  return `
    @page back-image {
      margin: 0;
      @bottom-center { content: none; }
    }
    @page colophon {
      margin: ${pageMargin};
      @bottom-center { content: none; }
    }

    .back-image {
      page: back-image;
      width: ${widthIn}in;
      /* ちょうどの高さだと次のページにはみ出すことがあるので、少しだけ低くする */
      height: calc(${heightIn}in - 1mm);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .back-image img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .colophon {
      page: colophon;
      /* ページの高さより少し小さくして、はみ出して白紙のページができないようにする */
      height: calc(${heightIn}in - ${margin.top} - ${margin.bottom} - 6mm);
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 0 22px;
    }
    .colophon-box {
      border-top: 1.5px solid #333;
      border-bottom: 1.5px solid #333;
      padding: 10px 0 12px;
      font-size: 9.5pt;
      line-height: 1.7;
    }
    .colophon-title {
      font-family: ${headingFamily};
      font-weight: 700;
      font-size: 13pt;
      margin: 0 0 8px;
    }
    .colophon-table {
      border-collapse: collapse;
    }
    .colophon-table th {
      font-weight: 400;
      color: #555;
      text-align: left;
      white-space: nowrap;
      padding: 0 1.5em 0 0;
      vertical-align: top;
    }
    .colophon-table td {
      padding: 0;
      overflow-wrap: anywhere;
    }
    .colophon-table a {
      color: inherit;
      text-decoration: none;
    }
    .colophon-note {
      margin: 8px 0 0;
      color: #555;
    }
  `;
}
