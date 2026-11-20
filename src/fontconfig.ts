import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Chromium に渡す fontconfig の設定ファイル（FONTCONFIG_FILE）を決める。
 *
 * TrueType のフォントだけを見せる fonts.conf を使うと、PDF に Type 3 フォントが入らない
 * （docs/font-setup.md）。fontconfig を使うのは Linux の Chromium だけなので、Linux でだけ効く。
 *
 * 優先順位：設定の fontconfigFile ＞ 環境変数 FONTCONFIG_FILE ＞ fonts/fonts.conf（mise run setup-fonts で
 * フォントをそろえたとき）＞ システムの設定。fontconfigFile が null のときは、システムの設定を使う。
 */

/** このツールの fonts/ フォルダ（どのフォルダから実行しても同じ場所）。 */
export const BUNDLED_FONTS_DIR = fileURLToPath(
  new URL("../fonts", import.meta.url),
);

export type BundledFontconfig =
  | { status: "ready"; file: string }
  | { status: "absent" }
  | { status: "incomplete"; reason: string };

export type FontconfigSource =
  | "config"
  | "env"
  | "bundled"
  | "system"
  | "unsupported";

export interface FontconfigResolution {
  source: FontconfigSource;
  /** 使う fonts.conf の絶対パス（システムの設定のときはない）。 */
  file?: string;
  /** Chromium や fc-match に渡す環境変数。元の環境変数に FONTCONFIG_FILE を足した（または外した）もの。 */
  env: NodeJS.ProcessEnv;
  /** 利用者に1行で知らせる内容。知らせることがなければない。 */
  message?: string;
  level?: "info" | "warn";
}

export interface ResolveFontconfigOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
  /** 省略すると、このツールの fonts/ を調べる。 */
  bundled?: BundledFontconfig;
}

export function resolveFontconfig(
  configValue: string | null | undefined,
  options: ResolveFontconfigOptions = {},
): FontconfigResolution {
  const baseEnv = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();

  if (platform !== "linux") {
    return {
      source: "unsupported",
      env: { ...baseEnv },
      message:
        typeof configValue === "string"
          ? `🔤 fontconfig: fontconfigFile は Linux でだけ使います（今は ${platform}）。システムのフォントで PDF を作ります。`
          : undefined,
      level: "info",
    };
  }

  if (typeof configValue === "string") {
    return withFile("config", configValue, baseEnv, "設定の fontconfigFile");
  }

  if (configValue === null) {
    const env = { ...baseEnv };
    delete env.FONTCONFIG_FILE;
    return {
      source: "system",
      env,
      message:
        "🔤 fontconfig: システムの設定を使います（fontconfigFile が null）",
      level: "info",
    };
  }

  const fromEnv = baseEnv.FONTCONFIG_FILE;
  if (fromEnv) {
    // fontconfig は相対パスの FONTCONFIG_FILE を何も言わずに無視するので、絶対パスにする
    return withFile(
      "env",
      path.resolve(cwd, fromEnv),
      baseEnv,
      "環境変数 FONTCONFIG_FILE",
    );
  }

  const bundled = options.bundled ?? findBundledFontconfig();
  if (bundled.status === "ready") {
    return withFile(
      "bundled",
      bundled.file,
      baseEnv,
      "mise run setup-fonts で用意したフォント",
    );
  }
  if (bundled.status === "incomplete") {
    return {
      source: "system",
      env: { ...baseEnv },
      message: `⚠️  fonts/ttf/ のフォントがそろっていません（${bundled.reason}）。mise run setup-fonts を実行してください。システムのフォントで PDF を作ります。`,
      level: "warn",
    };
  }

  return { source: "system", env: { ...baseEnv } };
}

function withFile(
  source: FontconfigSource,
  file: string,
  baseEnv: NodeJS.ProcessEnv,
  label: string,
): FontconfigResolution {
  return {
    source,
    file,
    env: { ...baseEnv, FONTCONFIG_FILE: file },
    message: `🔤 fontconfig: ${file} を使います（${label}）`,
    level: "info",
  };
}

interface ManifestEntry {
  file: string;
  sha256: string;
}

/**
 * mise run setup-fonts で用意したフォントがそろっているかを、fonts/ttf/manifest.json で確かめる。
 * フォルダがあるだけでは使わない（途中で失敗した半端な状態で、字が抜けた PDF を作らないため）。
 */
export function findBundledFontconfig(
  fontsDir: string = BUNDLED_FONTS_DIR,
): BundledFontconfig {
  const ttfDir = path.join(fontsDir, "ttf");
  if (!fs.existsSync(ttfDir)) {
    return { status: "absent" };
  }

  const confPath = path.join(fontsDir, "fonts.conf");
  if (!fs.existsSync(confPath)) {
    return { status: "incomplete", reason: "fonts/fonts.conf がない" };
  }

  const manifestPath = path.join(ttfDir, "manifest.json");
  let entries: ManifestEntry[];
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      fonts?: ManifestEntry[];
      licenses?: ManifestEntry[];
    };
    entries = [...(manifest.fonts ?? []), ...(manifest.licenses ?? [])];
  } catch {
    return { status: "incomplete", reason: "manifest.json を読めない" };
  }
  if (entries.length === 0) {
    return { status: "incomplete", reason: "manifest.json にフォントがない" };
  }

  for (const entry of entries) {
    const filePath = path.join(ttfDir, path.basename(entry.file));
    if (!fs.existsSync(filePath)) {
      return { status: "incomplete", reason: `${entry.file} がない` };
    }
    const sha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
    if (sha256 !== entry.sha256) {
      return { status: "incomplete", reason: `${entry.file} の中身が違う` };
    }
  }

  return { status: "ready", file: confPath };
}

export type FcMatchRunner = (family: string) => {
  ok: boolean;
  stdout: string;
};

/**
 * 設定したフォントが、TrueType のフォントとして見つかるかを fc-match で確かめる。
 * 見つからなければ別のフォントに置き換わり、TrueType でなければ（CFF など）PDF に Type 3 として入る。
 */
export function checkFontFamilies(
  families: string[],
  runFcMatch: FcMatchRunner,
): string[] {
  const warnings: string[] = [];
  for (const family of families) {
    const result = runFcMatch(family);
    if (!result.ok) {
      return [
        "⚠️  fc-match が使えないので、フォントを確かめられません。PDF の Type 3 フォントは、PDF を作ったあとの検査で確かめます。",
      ];
    }
    const [matchedFamily = "", format = ""] = result.stdout.trim().split("|");
    if (matchedFamily.toLowerCase() !== family.toLowerCase()) {
      warnings.push(
        `⚠️  ${family} が見つかりません（${matchedFamily || "不明"} で代わりに描きます）。mise run setup-fonts を実行してください（docs/font-setup.md）。`,
      );
    } else if (format !== "TrueType") {
      warnings.push(
        `⚠️  ${family} が TrueType ではありません（${format || "不明"}）。PDF に Type 3 フォントとして入ります。mise run setup-fonts を実行してください（docs/font-setup.md）。`,
      );
    }
  }
  return warnings;
}

/** CSS の font-family の文字列から、名前で指定したフォントを取り出す（serif などの総称は除く）。 */
export function namedFamilies(fontFamily: string): string[] {
  const generic = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "emoji",
    "math",
  ]);
  return fontFamily
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter((name) => name !== "" && !generic.has(name.toLowerCase()));
}
