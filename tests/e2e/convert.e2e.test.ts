import { spawn } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { PDFDocument, PDFName } from "pdf-lib";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureBookPath = fileURLToPath(
  new URL("../fixtures/book-minimal", import.meta.url),
);
const fixtureConfigPath = fileURLToPath(
  new URL("../fixtures/book-minimal/pdf.config.json", import.meta.url),
);
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

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

async function createFixtureBookCopy(baseDir: string): Promise<string> {
  const fixtureCopyPath = path.join(baseDir, "book-copy");
  await fs.copy(fixtureBookPath, fixtureCopyPath);
  return fixtureCopyPath;
}

async function countPdfPages(pdfBuffer: Buffer): Promise<number> {
  const pdfDocument = await PDFDocument.load(pdfBuffer);
  return pdfDocument.getPageCount();
}

describe("CLI E2E", () => {
  it("fixture book を PDF に変換できる", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-pdf-e2e-"));
    tempDirs.push(tmpDir);

    const outputPath = path.join(tmpDir, "output.pdf");
    const { code, stdout, stderr } = await runCli([
      fixtureBookPath,
      outputPath,
      "--config",
      fixtureConfigPath,
    ]);

    if (code !== 0) {
      throw new Error(
        [
          `CLI exited with code ${String(code)}.`,
          "--- stdout ---",
          stdout || "<empty>",
          "--- stderr ---",
          stderr || "<empty>",
        ].join("\n"),
      );
    }

    expect(code).toBe(0);
    expect(await fs.pathExists(outputPath)).toBe(true);

    const stats = await fs.stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);

    const pdfBuffer = await fs.readFile(outputPath);
    expect(pdfBuffer.toString("latin1").startsWith("%PDF-")).toBe(true);
    await expect(countPdfPages(pdfBuffer)).resolves.toBeGreaterThan(0);

    // PDF を作ったあとにフォントを検査し、要約の1行を出す（結果は環境のフォントによる）
    expect(`${stdout}\n${stderr}`).toContain("🔤 フォント:");
  }, 120000);

  it("--font-check の値が正しくなければ、PDF を作らずに終了コード 1 で終わる", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-pdf-e2e-"));
    tempDirs.push(tmpDir);

    const outputPath = path.join(tmpDir, "output.pdf");
    const { code, stderr } = await runCli([
      fixtureBookPath,
      outputPath,
      "--font-check",
      "strict",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("--font-check には warn / error / off");
    expect(await fs.pathExists(outputPath)).toBe(false);
  }, 120000);

  it("fontconfigFile のファイルがなければ、PDF を作らずに終了コード 1 で終わる", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-pdf-e2e-"));
    tempDirs.push(tmpDir);

    const configPath = path.join(tmpDir, "book.config.json");
    await fs.writeJson(configPath, { fontconfigFile: "missing/fonts.conf" });
    const outputPath = path.join(tmpDir, "output.pdf");
    const { code, stderr } = await runCli([
      fixtureBookPath,
      outputPath,
      "--config",
      configPath,
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("fontconfigFile のファイルが見つかりません");
    expect(await fs.pathExists(outputPath)).toBe(false);
  }, 120000);

  it("cover.png がある場合は画像表紙を追加した PDF を生成できる", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenn-pdf-cover-"));
    tempDirs.push(tmpDir);

    const fixtureBookCopyPath = await createFixtureBookCopy(tmpDir);
    await fs.writeFile(
      path.join(fixtureBookCopyPath, "cover.png"),
      TINY_PNG_BUFFER,
    );

    const outputPath = path.join(tmpDir, "output-cover.pdf");
    const { code, stdout, stderr } = await runCli([
      fixtureBookCopyPath,
      outputPath,
      "--config",
      fixtureConfigPath,
    ]);

    if (code !== 0) {
      throw new Error(
        [
          `CLI exited with code ${String(code)}.`,
          "--- stdout ---",
          stdout || "<empty>",
          "--- stderr ---",
          stderr || "<empty>",
        ].join("\n"),
      );
    }

    expect(code).toBe(0);
    expect(await fs.pathExists(outputPath)).toBe(true);

    const pdfBuffer = await fs.readFile(outputPath);
    expect(pdfBuffer.toString("latin1").startsWith("%PDF-")).toBe(true);
    await expect(countPdfPages(pdfBuffer)).resolves.toBeGreaterThanOrEqual(4);

    // 表紙と本文を1回で出力するので、しおり（Outlines）が残る
    const pdfDocument = await PDFDocument.load(pdfBuffer);
    expect(pdfDocument.catalog.has(PDFName.of("Outlines"))).toBe(true);
  }, 120000);
});
