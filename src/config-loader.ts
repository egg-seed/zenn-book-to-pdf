import fs from "fs-extra";
import path from "path";
import type { PaperFormat } from "puppeteer";
import { isFontCheckMode, type FontCheckMode } from "./font-check.ts";
import { isGlyphCheckMode, type GlyphCheckMode } from "./glyph-check.ts";

export type PdfWaitUntil =
  | "load"
  | "domcontentloaded"
  | "networkidle0"
  | "networkidle2";

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

export interface PdfRenderOptions {
  waitUntil: PdfWaitUntil;
  navigationTimeout: number;
  imageTimeout: number;
}

export interface ColophonRow {
  label: string;
  value: string;
}

export interface PdfColophon {
  /** 奥付の書名。省略すると config.yaml の title を使う。 */
  title?: string;
  rows: ColophonRow[];
  note?: string;
  /** 罫線の下に置く著作権の表示（例: "© 2026 発行者"）。 */
  copyright?: string;
}

export interface PdfConfig {
  pageSize: PaperFormat;
  margin: PdfMargin;
  header: PdfHeaderFooter;
  footer: PdfHeaderFooter;
  fonts: PdfFonts;
  render: PdfRenderOptions;
  /** タイトルページに出す概要。指定すると config.yaml の summary の代わりに使う。空文字なら概要を出さない。 */
  summary?: string;
  /** 各ページの下中央にページ番号を入れる。表紙画像のページには入れない。 */
  pageNumbers?: boolean;
  /** 最後のページに置く奥付。 */
  colophon?: PdfColophon;
  /** PDF を作ったあとの Type 3・埋め込みなしのフォントの検査。既定は "warn"。 */
  fontCheck: FontCheckMode;
  /** PDF を作る前の、フォントにない字（豆腐）の検査。既定は "warn"。 */
  glyphCheck: GlyphCheckMode;
  /**
   * Chromium に使わせる fontconfig の設定ファイル（絶対パス。Linux でだけ効く）。
   * null ならシステムの設定を使う。未指定なら環境変数 FONTCONFIG_FILE、それもなければシステムの設定。
   */
  fontconfigFile?: string | null;
}

/** 設定の値が正しくないとき。黙って既定値に戻すと入稿用の設定が効かなくなるので、止める。 */
export class PdfConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfConfigError";
  }
}

interface PdfConfigOverrides {
  pageSize?: PaperFormat;
  margin?: Partial<PdfMargin>;
  header?: Partial<PdfHeaderFooter>;
  footer?: Partial<PdfHeaderFooter>;
  fonts?: unknown;
  render?: unknown;
  summary?: string;
  pageNumbers?: boolean;
  colophon?: PdfColophon;
  fontCheck?: FontCheckMode;
  glyphCheck?: GlyphCheckMode;
  fontconfigFile?: string | null;
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
      "'Noto Serif JP', 'Noto Emoji', 'Hiragino Mincho ProN', 'Yu Mincho', serif",
    headingFamily:
      "'Noto Sans JP', 'Noto Emoji', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
  },
  render: {
    waitUntil: "domcontentloaded",
    navigationTimeout: 60000,
    imageTimeout: 30000,
  },
  fontCheck: "warn",
  glyphCheck: "warn",
};

export async function loadPdfConfig(
  configPath: string | null = null,
): Promise<PdfConfig> {
  let merged: PdfConfig = { ...DEFAULT_CONFIG };
  const cwdConfigPath = path.join(process.cwd(), "pdf.config.json");
  const explicitConfigPath = configPath ? path.resolve(configPath) : null;
  const candidates = [cwdConfigPath];

  if (explicitConfigPath && explicitConfigPath !== cwdConfigPath) {
    candidates.push(explicitConfigPath);
  }

  for (const candidate of candidates) {
    const isExplicit = candidate === explicitConfigPath;
    if (!(await fs.pathExists(candidate))) {
      if (isExplicit) {
        // --config で指定したファイルがないまま続けると、入稿用の設定（fontCheck など）が効かない
        throw new PdfConfigError(`コンフィグが見つかりません: ${candidate}`);
      }
      continue;
    }

    let raw: unknown;
    try {
      raw = (await fs.readJson(candidate)) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const text = `コンフィグの読み込みに失敗しました (${candidate}): ${message}`;
      if (isExplicit) {
        throw new PdfConfigError(text);
      }
      console.warn(`⚠️  ${text}`);
      continue;
    }

    let overrides: PdfConfigOverrides;
    try {
      overrides = normalizeConfigOverrides(raw, path.dirname(candidate));
      if (
        typeof overrides.fontconfigFile === "string" &&
        !(await fs.pathExists(overrides.fontconfigFile))
      ) {
        throw new PdfConfigError(
          `fontconfigFile のファイルが見つかりません: ${overrides.fontconfigFile}`,
        );
      }
    } catch (err) {
      if (err instanceof PdfConfigError) {
        throw new PdfConfigError(`${err.message} (${candidate})`);
      }
      throw err;
    }
    console.log(`📋 コンフィグを読み込みました: ${candidate}`);
    merged = mergeConfig(merged, overrides);
  }

  return merged;
}

function mergeConfig(
  defaults: PdfConfig,
  overrides: PdfConfigOverrides,
): PdfConfig {
  const fonts = mergeFontsConfig(defaults.fonts, overrides.fonts);
  const render = mergeRenderConfig(defaults.render, overrides.render);

  return {
    pageSize: overrides.pageSize ?? defaults.pageSize,
    margin: { ...defaults.margin, ...(overrides.margin ?? {}) },
    header: { ...defaults.header, ...(overrides.header ?? {}) },
    footer: { ...defaults.footer, ...(overrides.footer ?? {}) },
    fonts,
    render,
    summary: overrides.summary ?? defaults.summary,
    pageNumbers: overrides.pageNumbers ?? defaults.pageNumbers,
    colophon: overrides.colophon ?? defaults.colophon,
    fontCheck: overrides.fontCheck ?? defaults.fontCheck,
    glyphCheck: overrides.glyphCheck ?? defaults.glyphCheck,
    fontconfigFile:
      overrides.fontconfigFile !== undefined
        ? overrides.fontconfigFile
        : defaults.fontconfigFile,
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

function mergeRenderConfig(
  defaultRender: PdfRenderOptions,
  overrideRender: unknown,
): PdfRenderOptions {
  if (overrideRender == null) {
    return { ...defaultRender };
  }

  if (typeof overrideRender !== "object" || Array.isArray(overrideRender)) {
    console.warn(
      "⚠️  render の設定はオブジェクトで指定してください。デフォルト値を使用します。",
    );
    return { ...defaultRender };
  }

  const renderRecord = overrideRender as Record<string, unknown>;
  const waitUntilValue = renderRecord.waitUntil;
  const navigationTimeoutValue = renderRecord.navigationTimeout;
  const imageTimeoutValue = renderRecord.imageTimeout;

  const waitUntil = isPdfWaitUntil(waitUntilValue)
    ? waitUntilValue
    : defaultRender.waitUntil;
  const navigationTimeout =
    typeof navigationTimeoutValue === "number" &&
    Number.isFinite(navigationTimeoutValue) &&
    navigationTimeoutValue >= 0
      ? navigationTimeoutValue
      : defaultRender.navigationTimeout;
  const imageTimeout =
    typeof imageTimeoutValue === "number" &&
    Number.isFinite(imageTimeoutValue) &&
    imageTimeoutValue >= 0
      ? imageTimeoutValue
      : defaultRender.imageTimeout;

  if (waitUntilValue != null && !isPdfWaitUntil(waitUntilValue)) {
    console.warn(
      "⚠️  render.waitUntil は load, domcontentloaded, networkidle0, networkidle2 のいずれかを指定してください。デフォルト値を使用します。",
    );
  }

  if (
    navigationTimeoutValue != null &&
    (typeof navigationTimeoutValue !== "number" ||
      !Number.isFinite(navigationTimeoutValue) ||
      navigationTimeoutValue < 0)
  ) {
    console.warn(
      "⚠️  render.navigationTimeout は 0 以上の数値で指定してください。デフォルト値を使用します。",
    );
  }

  if (
    imageTimeoutValue != null &&
    (typeof imageTimeoutValue !== "number" ||
      !Number.isFinite(imageTimeoutValue) ||
      imageTimeoutValue < 0)
  ) {
    console.warn(
      "⚠️  render.imageTimeout は 0 以上の数値で指定してください。デフォルト値を使用します。",
    );
  }

  return {
    waitUntil,
    navigationTimeout,
    imageTimeout,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPdfWaitUntil(value: unknown): value is PdfWaitUntil {
  return ["load", "domcontentloaded", "networkidle0", "networkidle2"].includes(
    typeof value === "string" ? value : "",
  );
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

function normalizeConfigOverrides(
  value: unknown,
  configDir: string,
): PdfConfigOverrides {
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

  if ("render" in value) {
    overrides.render = value.render;
  }

  if ("summary" in value) {
    if (typeof value.summary === "string") {
      overrides.summary = value.summary;
    } else {
      console.warn(
        "⚠️  summary は文字列で指定してください。config.yaml の summary を使用します。",
      );
    }
  }

  if ("colophon" in value) {
    const colophon = normalizeColophon(value.colophon);
    if (colophon) {
      overrides.colophon = colophon;
    } else {
      console.warn(
        "⚠️  colophon の形が正しくありません。README の colophon の説明を見てください。",
      );
    }
  }

  if ("pageNumbers" in value) {
    if (typeof value.pageNumbers === "boolean") {
      overrides.pageNumbers = value.pageNumbers;
    } else {
      console.warn(
        "⚠️  pageNumbers は true か false で指定してください。ページ番号は入れません。",
      );
    }
  }

  if ("fontCheck" in value) {
    if (!isFontCheckMode(value.fontCheck)) {
      throw new PdfConfigError(
        "fontCheck は warn / error / off のいずれかを指定してください。",
      );
    }
    overrides.fontCheck = value.fontCheck;
  }

  if ("glyphCheck" in value) {
    if (!isGlyphCheckMode(value.glyphCheck)) {
      throw new PdfConfigError(
        "glyphCheck は warn / error / off のいずれかを指定してください。",
      );
    }
    overrides.glyphCheck = value.glyphCheck;
  }

  if ("fontconfigFile" in value) {
    const fontconfigFile = value.fontconfigFile;
    if (fontconfigFile === null) {
      overrides.fontconfigFile = null;
    } else if (typeof fontconfigFile === "string" && fontconfigFile.trim()) {
      // 相対パスのまま FONTCONFIG_FILE に渡すと fontconfig が黙って無視するので、
      // 設定ファイルの場所を基準に絶対パスにする
      overrides.fontconfigFile = path.resolve(configDir, fontconfigFile);
    } else {
      throw new PdfConfigError(
        "fontconfigFile は fonts.conf のパスか null で指定してください。",
      );
    }
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

function normalizeColophon(value: unknown): PdfColophon | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return null;
  }

  const rows: ColophonRow[] = [];
  for (const row of value.rows) {
    if (
      !isRecord(row) ||
      typeof row.label !== "string" ||
      typeof row.value !== "string"
    ) {
      return null;
    }
    rows.push({ label: row.label, value: row.value });
  }

  const colophon: PdfColophon = { rows };
  if (typeof value.title === "string") {
    colophon.title = value.title;
  }
  if (typeof value.note === "string") {
    colophon.note = value.note;
  }
  if (typeof value.copyright === "string") {
    colophon.copyright = value.copyright;
  }
  return colophon;
}
