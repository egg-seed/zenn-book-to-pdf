import path from "path";

/**
 * Chromium に渡す fontconfig の設定ファイル（FONTCONFIG_FILE）を決める。
 *
 * TrueType のフォントだけを見せる fonts.conf を使うと、PDF に Type 3 フォントが入らない
 * （docs/font-setup.md）。fontconfig を使うのは Linux の Chromium だけなので、Linux でだけ効く。
 *
 * 優先順位：設定の fontconfigFile ＞ 外から渡された環境変数 FONTCONFIG_FILE ＞ システムの設定。
 * fontconfigFile が null のときは、環境変数も外してシステムの設定を使う。
 */

export type FontconfigSource = "config" | "env" | "system" | "unsupported";

export interface FontconfigResolution {
  source: FontconfigSource;
  /** 使う fonts.conf の絶対パス（システムの設定のときはない）。 */
  file?: string;
  /** Chromium や fc-list に渡す環境変数。元の環境変数に FONTCONFIG_FILE を足した（または外した）もの。 */
  env: NodeJS.ProcessEnv;
  /** 利用者に1行で知らせる内容。知らせることがなければない。 */
  message?: string;
}

export function resolveFontconfig(
  configValue: string | null | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd: string = process.cwd(),
): FontconfigResolution {
  if (platform !== "linux") {
    return {
      source: "unsupported",
      env: { ...baseEnv },
      message:
        typeof configValue === "string"
          ? `🔤 fontconfig: fontconfigFile は Linux でだけ使います（今は ${platform}）。システムのフォントで PDF を作ります。`
          : undefined,
    };
  }

  if (typeof configValue === "string") {
    return {
      source: "config",
      file: configValue,
      env: { ...baseEnv, FONTCONFIG_FILE: configValue },
      message: `🔤 fontconfig: ${configValue} を使います（設定の fontconfigFile）`,
    };
  }

  if (configValue === null) {
    const env = { ...baseEnv };
    const hadEnv = env.FONTCONFIG_FILE != null;
    delete env.FONTCONFIG_FILE;
    return {
      source: "system",
      env,
      message: hadEnv
        ? "🔤 fontconfig: fontconfigFile が null なので、環境変数 FONTCONFIG_FILE を使わず、システムの設定を使います"
        : "🔤 fontconfig: システムの設定を使います（fontconfigFile が null）",
    };
  }

  const fromEnv = baseEnv.FONTCONFIG_FILE;
  if (fromEnv) {
    // fontconfig は相対パスの FONTCONFIG_FILE を何も言わずに無視するので、絶対パスにする
    const file = path.resolve(cwd, fromEnv);
    return {
      source: "env",
      file,
      env: { ...baseEnv, FONTCONFIG_FILE: file },
      message: `🔤 fontconfig: ${file} を使います（環境変数 FONTCONFIG_FILE）`,
    };
  }

  return { source: "system", env: { ...baseEnv } };
}
