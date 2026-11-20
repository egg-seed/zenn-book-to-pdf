import { describe, expect, it } from "vitest";
import path from "path";
import { resolveFontconfig } from "../../src/fontconfig.ts";

const baseEnv = { PATH: "/usr/bin", HOME: "/home/user", LANG: "ja_JP.UTF-8" };

describe("resolveFontconfig", () => {
  it("設定の fontconfigFile を、今の環境変数に足して渡す", () => {
    const result = resolveFontconfig("/fonts/fonts.conf", baseEnv, "linux");

    expect(result.source).toBe("config");
    expect(result.file).toBe("/fonts/fonts.conf");
    expect(result.env).toEqual({
      ...baseEnv,
      FONTCONFIG_FILE: "/fonts/fonts.conf",
    });
    expect(result.message).toContain("/fonts/fonts.conf");
  });

  it("設定の fontconfigFile は、外から渡された FONTCONFIG_FILE より優先する", () => {
    const result = resolveFontconfig(
      "/fonts/fonts.conf",
      { ...baseEnv, FONTCONFIG_FILE: "/other/fonts.conf" },
      "linux",
    );

    expect(result.env.FONTCONFIG_FILE).toBe("/fonts/fonts.conf");
  });

  it("設定がなければ、外から渡された FONTCONFIG_FILE を使う（相対パスは絶対パスにする）", () => {
    const result = resolveFontconfig(
      undefined,
      { ...baseEnv, FONTCONFIG_FILE: "fonts/fonts.conf" },
      "linux",
      "/work",
    );

    expect(result.source).toBe("env");
    expect(result.env.FONTCONFIG_FILE).toBe(
      path.resolve("/work", "fonts/fonts.conf"),
    );
    expect(result.env.PATH).toBe("/usr/bin");
  });

  it("設定も環境変数もなければ、システムの設定のまま（何も出さない）", () => {
    const result = resolveFontconfig(undefined, baseEnv, "linux");

    expect(result.source).toBe("system");
    expect(result.env).toEqual(baseEnv);
    expect(result.message).toBeUndefined();
  });

  it("fontconfigFile が null なら、外から渡された FONTCONFIG_FILE も外してシステムの設定を使う", () => {
    const result = resolveFontconfig(
      null,
      { ...baseEnv, FONTCONFIG_FILE: "/other/fonts.conf" },
      "linux",
    );

    expect(result.source).toBe("system");
    expect(result.env).toEqual(baseEnv);
    expect(result.message).toContain("システム");
  });

  it("Linux 以外では fontconfigFile を使わず、その旨を出す", () => {
    const result = resolveFontconfig("/fonts/fonts.conf", baseEnv, "darwin");

    expect(result.source).toBe("unsupported");
    expect(result.env).toEqual(baseEnv);
    expect(result.message).toContain("Linux");
  });

  it("元の環境変数のオブジェクトは変えない", () => {
    const env = { ...baseEnv, FONTCONFIG_FILE: "/other/fonts.conf" };

    resolveFontconfig(null, env, "linux");
    resolveFontconfig("/fonts/fonts.conf", env, "linux");

    expect(env.FONTCONFIG_FILE).toBe("/other/fonts.conf");
  });
});
