import { describe, expect, it } from "vitest";
import { toCssPx } from "../../src/pdf-generator.ts";

describe("toCssPx", () => {
  it("mm・in・pt・px を CSS px に直す", () => {
    expect(toCssPx("25.4mm")).toBeCloseTo(96);
    expect(toCssPx("1in")).toBe(96);
    expect(toCssPx("72pt")).toBeCloseTo(96);
    expect(toCssPx("10px")).toBe(10);
    expect(toCssPx("10")).toBe(10);
  });

  it("読めない値は 0 にする", () => {
    expect(toCssPx("auto")).toBe(0);
  });
});
