import fs from "fs-extra";
import path from "path";
import type { PaperFormat } from "puppeteer";

export interface PdfMargin {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

export interface PdfHeaderFooter {
  enabled: boolean;
  template: string;
}

export interface PdfFonts {
  bodyFamily: string;
  headingFamily: string;
}

export interface PdfConfig {
  pageSize: PaperFormat;
  margin: PdfMargin;
  header: PdfHeaderFooter;
  footer: PdfHeaderFooter;
  fonts: PdfFonts;
}

interface PdfConfigOverrides {
  pageSize?: PaperFormat;
  margin?: Partial<PdfMargin>;
  header?: Partial<PdfHeaderFooter>;
  footer?: Partial<PdfHeaderFooter>;
  fonts?: unknown;
}

export const DEFAULT_CONFIG: PdfConfig = {
  pageSize: "A5",
  margin: {
    top: "14mm",
    bottom: "16mm",
    left: "14mm",
    right: "14mm",
  },
  header: {
    enabled: false,
    template: "<div></div>",
  },
  footer: {
    enabled: false,
    template: `
      <div style="
        width: 100%;
        font-size: 9px;
        color: #999;
        text-align: center;
        padding: 0 25mm;
      ">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>
    `,
  },
  fonts: {
    bodyFamily:
      "'Noto Serif CJK JP', 'Noto Serif JP', 'Noto Serif', 'IPAexMincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
    headingFamily:
      "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans', 'IPAexGothic', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
  },
};

export async function loadPdfConfig(
  configPath: string | null = null,
): Promise<PdfConfig> {
  let merged: PdfConfig = { ...DEFAULT_CONFIG };
  const cwdConfigPath = path.join(process.cwd(), "pdf.config.json");
  const candidates = [cwdConfigPath];

  if (configPath) {
    const resolvedConfigPath = path.resolve(configPath);
    if (resolvedConfigPath !== cwdConfigPath) {
      candidates.push(resolvedConfigPath);
    }
  }

  for (const candidate of candidates) {
    if (!(await fs.pathExists(candidate))) {
      continue;
    }

    try {
      const raw = (await fs.readJson(candidate)) as unknown;
      const overrides = normalizeConfigOverrides(raw);
      console.log(`📋 コンフィグを読み込みました: ${candidate}`);
      merged = mergeConfig(merged, overrides);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `⚠️  コンフィグの読み込みに失敗しました (${candidate}): ${message}`,
      );
    }
  }

  return merged;
}

function mergeConfig(
  defaults: PdfConfig,
  overrides: PdfConfigOverrides,
): PdfConfig {
  const fonts = mergeFontsConfig(defaults.fonts, overrides.fonts);

  return {
    pageSize: overrides.pageSize ?? defaults.pageSize,
    margin: { ...defaults.margin, ...(overrides.margin ?? {}) },
    header: { ...defaults.header, ...(overrides.header ?? {}) },
    footer: { ...defaults.footer, ...(overrides.footer ?? {}) },
    fonts,
  };
}

function mergeFontsConfig(
  defaultFonts: PdfFonts,
  overrideFonts: unknown,
): PdfFonts {
  if (overrideFonts == null) {
    return { ...defaultFonts };
  }

  if (typeof overrideFonts !== "object" || Array.isArray(overrideFonts)) {
    console.warn(
      "⚠️  fonts の設定はオブジェクトで指定してください。デフォルト値を使用します。",
    );
    return { ...defaultFonts };
  }

  const fontsRecord = overrideFonts as Record<string, unknown>;
  const bodyFamilyValue = fontsRecord.bodyFamily;
  const headingFamilyValue = fontsRecord.headingFamily;

  const bodyFamily =
    typeof bodyFamilyValue === "string" && bodyFamilyValue.trim() !== ""
      ? bodyFamilyValue
      : defaultFonts.bodyFamily;
  const headingFamily =
    typeof headingFamilyValue === "string" && headingFamilyValue.trim() !== ""
      ? headingFamilyValue
      : defaultFonts.headingFamily;

  if (
    bodyFamilyValue != null &&
    (typeof bodyFamilyValue !== "string" || bodyFamilyValue.trim() === "")
  ) {
    console.warn(
      "⚠️  fonts.bodyFamily は空でない文字列で指定してください。デフォルト値を使用します。",
    );
  }

  if (
    headingFamilyValue != null &&
    (typeof headingFamilyValue !== "string" || headingFamilyValue.trim() === "")
  ) {
    console.warn(
      "⚠️  fonts.headingFamily は空でない文字列で指定してください。デフォルト値を使用します。",
    );
  }

  return {
    bodyFamily,
    headingFamily,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeMargin(value: unknown): Partial<PdfMargin> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const margin: Partial<PdfMargin> = {};
  if (typeof value.top === "string") {
    margin.top = value.top;
  }
  if (typeof value.bottom === "string") {
    margin.bottom = value.bottom;
  }
  if (typeof value.left === "string") {
    margin.left = value.left;
  }
  if (typeof value.right === "string") {
    margin.right = value.right;
  }

  return margin;
}

function normalizeHeaderFooter(
  value: unknown,
): Partial<PdfHeaderFooter> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: Partial<PdfHeaderFooter> = {};
  if (typeof value.enabled === "boolean") {
    normalized.enabled = value.enabled;
  }
  if (typeof value.template === "string") {
    normalized.template = value.template;
  }

  return normalized;
}

function normalizeConfigOverrides(value: unknown): PdfConfigOverrides {
  if (!isRecord(value)) {
    return {};
  }

  const overrides: PdfConfigOverrides = {};

  if (isPaperFormat(value.pageSize)) {
    overrides.pageSize = value.pageSize;
  }

  const margin = normalizeMargin(value.margin);
  if (margin) {
    overrides.margin = margin;
  }

  const header = normalizeHeaderFooter(value.header);
  if (header) {
    overrides.header = header;
  }

  const footer = normalizeHeaderFooter(value.footer);
  if (footer) {
    overrides.footer = footer;
  }

  if ("fonts" in value) {
    overrides.fonts = value.fonts;
  }

  return overrides;
}

function isPaperFormat(value: unknown): value is PaperFormat {
  return [
    "letter",
    "legal",
    "tabloid",
    "ledger",
    "a0",
    "a1",
    "a2",
    "a3",
    "a4",
    "a5",
    "a6",
  ].includes(typeof value === "string" ? value.toLowerCase() : "");
}
