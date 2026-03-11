import { spawn } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureBookPath = fileURLToPath(
  new URL("../fixtures/book-minimal", import.meta.url),
);

const tempDirs: string[] = [];

function runCli(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(command, ["exec", "tsx", "src/index.ts", ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.remove(dir)));
});

describe("CLI E2E", () => {
  it("fixture book を PDF に変換できる", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-pdf-e2e-"));
    tempDirs.push(tmpDir);

    const outputPath = path.join(tmpDir, "output.pdf");
    const { code } = await runCli([fixtureBookPath, outputPath]);

    expect(code).toBe(0);
    expect(await fs.pathExists(outputPath)).toBe(true);

    const stats = await fs.stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);

    const pdfBuffer = await fs.readFile(outputPath);
    const pdfText = pdfBuffer.toString("latin1");

    expect(pdfText.startsWith("%PDF-")).toBe(true);
    expect(pdfText.match(/\/Type\s*\/Page\b/g)?.length ?? 0).toBeGreaterThan(0);
  }, 120000);
});
