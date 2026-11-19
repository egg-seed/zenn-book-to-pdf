import type { PdfColophon, PdfMargin } from "./config-loader.ts";
import { splitTitle } from "./title.ts";

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

/** 最後のページに置く奥付の HTML。奥付の設定がなければ空文字。 */
export function buildColophon(
  colophon: PdfColophon | undefined,
  bookTitle: string,
): string {
  if (!colophon) {
    return "";
  }

  const rows = colophon.rows
    .map(
      (row) =>
        `<tr><th>${escapeText(row.label)}</th><td>${formatValue(row.value)}</td></tr>`,
    )
    .join("\n");
  const note = colophon.note
    ? `<p class="colophon-note">${escapeText(colophon.note)}</p>`
    : "";
  const copyright = colophon.copyright
    ? `<p class="colophon-copyright">${escapeText(colophon.copyright)}</p>`
    : "";
  const title = splitTitle(colophon.title ?? bookTitle);
  const subtitle = title.subtitle
    ? `<span class="colophon-subtitle">${escapeText(title.subtitle)}</span>`
    : "";

  return `
<section class="colophon">
  <div class="colophon-box">
    <p class="colophon-title">${escapeText(title.main)}${subtitle}</p>
    <table class="colophon-table">${rows}</table>
    ${note}
  </div>
    ${copyright}
</section>`;
}

/** 奥付はページの下に寄せ、ページ番号は入れない。 */
export function getColophonStyles(
  heightIn: number,
  margin: PdfMargin,
  headingFamily: string,
): string {
  const pageMargin = `${margin.top} ${margin.right} ${margin.bottom} ${margin.left}`;
  return `
    @page colophon {
      margin: ${pageMargin};
      @bottom-center { content: none; }
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
    .colophon-subtitle {
      display: block;
      font-size: 10.5pt;
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
    .colophon-copyright {
      margin: 8px 0 0;
      font-size: 9pt;
      text-align: right;
    }
  `;
}
