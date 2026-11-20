import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  checkFontFamilies,
  findBundledFontconfig,
  resolveFontconfig,
  type BundledFontconfig,
} from "../../src/fontconfig.ts";

const baseEnv = { PATH: "/usr/bin", HOME: "/home/user", LANG: "ja_JP.UTF-8" };
const absent: BundledFontconfig = { status: "absent" };
const ready: BundledFontconfig = {
  status: "ready",
  file: "/tool/fonts/fonts.conf",
};

function resolve(
  configValue: string | null | undefined,
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    bundled?: BundledFontconfig;
  } = {},
) {
  return resolveFontconfig(configValue, {
    env: options.env ?? baseEnv,
    platform: options.platform ?? "linux",
    cwd: "/work",
    bundled: options.bundled ?? absent,
  });
}

describe("resolveFontconfig", () => {
  it("設定の fontconfigFile を、今の環境変数に足して渡す", () => {
    const result = resolve("/fonts/fonts.conf");

    expect(result.source).toBe("config");
    expect(result.file).toBe("/fonts/fonts.conf");
    expect(result.env).toEqual({
      ...baseEnv,
      FONTCONFIG_FILE: "/fonts/fonts.conf",
    });
    expect(result.message).toContain("/fonts/fonts.conf");
  });

  it("設定の fontconfigFile は、環境変数や fonts/ のフォントより優先する", () => {
    const result = resolve("/fonts/fonts.conf", {
      env: { ...baseEnv, FONTCONFIG_FILE: "/other/fonts.conf" },
      bundled: ready,
    });

    expect(result.env.FONTCONFIG_FILE).toBe("/fonts/fonts.conf");
  });

  it("設定がなければ、外から渡された FONTCONFIG_FILE を使う（相対パスは絶対パスにする）", () => {
    const result = resolve(undefined, {
      env: { ...baseEnv, FONTCONFIG_FILE: "fonts/fonts.conf" },
      bundled: ready,
    });

    expect(result.source).toBe("env");
    expect(result.env.FONTCONFIG_FILE).toBe(
      path.resolve("/work", "fonts/fonts.conf"),
    );
    expect(result.env.PATH).toBe("/usr/bin");
  });

  it("設定も環境変数もなく、fonts/ のフォントがそろっていれば fonts/fonts.conf を使う", () => {
    const result = resolve(undefined, { bundled: ready });

    expect(result.source).toBe("bundled");
    expect(result.env.FONTCONFIG_FILE).toBe("/tool/fonts/fonts.conf");
    expect(result.message).toContain("/tool/fonts/fonts.conf");
  });

  it("fonts/ のフォントがそろっていなければ、警告してシステムの設定を使う", () => {
    const result = resolve(undefined, {
      bundled: { status: "incomplete", reason: "NotoSansJP-Bold.ttf がない" },
    });

    expect(result.source).toBe("system");
    expect(result.env).toEqual(baseEnv);
    expect(result.level).toBe("warn");
    expect(result.message).toContain("NotoSansJP-Bold.ttf がない");
    expect(result.message).toContain("mise run setup-fonts");
  });

  it("どれもなければ、システムの設定のまま（何も出さない）", () => {
    const result = resolve(undefined);

    expect(result.source).toBe("system");
    expect(result.env).toEqual(baseEnv);
    expect(result.message).toBeUndefined();
  });

  it("fontconfigFile が null なら、環境変数も fonts/ のフォントも使わずシステムの設定を使う", () => {
    const result = resolve(null, {
      env: { ...baseEnv, FONTCONFIG_FILE: "/other/fonts.conf" },
      bundled: ready,
    });

    expect(result.source).toBe("system");
    expect(result.env).toEqual(baseEnv);
    expect(result.message).toContain("システム");
  });

  it("Linux 以外では使わず、指定があればその旨を出す", () => {
    const result = resolve("/fonts/fonts.conf", { platform: "darwin" });

    expect(result.source).toBe("unsupported");
    expect(result.env).toEqual(baseEnv);
    expect(result.message).toContain("Linux");
    expect(resolve(undefined, { platform: "win32" }).message).toBeUndefined();
  });

  it("元の環境変数のオブジェクトは変えない", () => {
    const env = { ...baseEnv, FONTCONFIG_FILE: "/other/fonts.conf" };

    resolve(null, { env });
    resolve("/fonts/fonts.conf", { env });

    expect(env.FONTCONFIG_FILE).toBe("/other/fonts.conf");
  });
});

describe("findBundledFontconfig", () => {
  let fontsDir: string;

  beforeEach(async () => {
    fontsDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-fonts-"));
    await fs.writeFile(path.join(fontsDir, "fonts.conf"), "<fontconfig/>");
  });

  afterEach(async () => {
    await fs.remove(fontsDir);
  });

  async function writeTtf(files: Record<string, string>): Promise<void> {
    const ttfDir = path.join(fontsDir, "ttf");
    await fs.ensureDir(ttfDir);
    const fonts = [];
    for (const [file, content] of Object.entries(files)) {
      await fs.writeFile(path.join(ttfDir, file), content);
      fonts.push({
        file,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      });
    }
    await fs.writeJson(path.join(ttfDir, "manifest.json"), {
      version: 1,
      fonts,
      licenses: [],
    });
  }

  it("fonts/ttf/ がなければ absent", () => {
    expect(findBundledFontconfig(fontsDir)).toEqual({ status: "absent" });
  });

  it("manifest のファイルがそろっていれば ready", async () => {
    await writeTtf({ "A.ttf": "a", "B.ttf": "b" });

    expect(findBundledFontconfig(fontsDir)).toEqual({
      status: "ready",
      file: path.join(fontsDir, "fonts.conf"),
    });
  });

  it("manifest がなければ incomplete", async () => {
    await fs.ensureDir(path.join(fontsDir, "ttf"));

    const result = findBundledFontconfig(fontsDir);

    expect(result.status).toBe("incomplete");
  });

  it("ファイルが欠けている、または中身が違えば incomplete", async () => {
    await writeTtf({ "A.ttf": "a", "B.ttf": "b" });
    await fs.remove(path.join(fontsDir, "ttf", "A.ttf"));
    expect(findBundledFontconfig(fontsDir)).toEqual({
      status: "incomplete",
      reason: "A.ttf がない",
    });

    await writeTtf({ "A.ttf": "a" });
    await fs.writeFile(path.join(fontsDir, "ttf", "A.ttf"), "changed");
    expect(findBundledFontconfig(fontsDir)).toEqual({
      status: "incomplete",
      reason: "A.ttf の中身が違う",
    });
  });

  it("fonts.conf がなければ incomplete", async () => {
    await writeTtf({ "A.ttf": "a" });
    await fs.remove(path.join(fontsDir, "fonts.conf"));

    expect(findBundledFontconfig(fontsDir).status).toBe("incomplete");
  });
});

describe("checkFontFamilies", () => {
  it("TrueType で見つかれば何も出さない", () => {
    const warnings = checkFontFamilies(["Noto Serif JP"], () => ({
      ok: true,
      stdout: "Noto Serif JP|TrueType",
    }));

    expect(warnings).toEqual([]);
  });

  it("別のフォントに置き換わるときは、見つからないと警告する", () => {
    const warnings = checkFontFamilies(["Noto Serif JP"], () => ({
      ok: true,
      stdout: "DejaVu Serif|TrueType",
    }));

    expect(warnings).toEqual([
      expect.stringContaining("Noto Serif JP が見つかりません"),
    ]);
  });

  it("TrueType でなければ Type 3 になると警告する", () => {
    const warnings = checkFontFamilies(["Noto Sans JP"], () => ({
      ok: true,
      stdout: "Noto Sans JP|CFF",
    }));

    expect(warnings).toEqual([expect.stringContaining("Type 3")]);
  });

  it("fc-match が使えなければ、その旨を1つだけ出す", () => {
    const warnings = checkFontFamilies(
      ["Noto Sans JP", "Noto Serif JP"],
      () => ({
        ok: false,
        stdout: "",
      }),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("fc-match");
  });
});
