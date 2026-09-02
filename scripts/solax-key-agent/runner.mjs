import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ExtractionError } from "./engine.mjs";

// Side-effect half of the agent: real browser runs and real codex invocations.
// Playwright is imported lazily so unit tests of the engine never load it.

let importCounter = 0;

export async function runExtractorScript({
  scriptPath,
  credentials,
  portalUrl,
  artifactsDir,
  timeoutMs = 180_000,
}) {
  const { chromium } = await import("playwright");
  await mkdir(artifactsDir, { recursive: true });
  const consoleLines = [];
  const browser = await chromium.launch({
    headless: true,
    // Container /dev/shm is tiny under read_only+tmpfs; chromium must not rely on it.
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (message) => {
      if (consoleLines.length < 500) consoleLines.push(`[${message.type()}] ${message.text()}`);
    });
    page.setDefaultTimeout(Math.min(30_000, timeoutMs));
    importCounter += 1;
    const moduleUrl = `${pathToFileURL(scriptPath).href}?v=${importCounter}`;
    const extractorModule = await import(moduleUrl);
    if (typeof extractorModule.default !== "function") {
      throw new Error("EXTRACTOR_HAS_NO_DEFAULT_EXPORT");
    }
    const run = extractorModule.default({
      page,
      credentials,
      portalUrl,
      // Extractor scripts must stay silent about secrets; the log sink is for
      // step names only and is size-capped like the console capture.
      log: (line) => {
        if (consoleLines.length < 500) consoleLines.push(`[extractor] ${String(line).slice(0, 200)}`);
      },
    });
    const tokenId = await Promise.race([
      run,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("EXTRACTION_TIMEOUT")), timeoutMs),
      ),
    ]);
    if (typeof tokenId !== "string" || tokenId.trim().length < 10) {
      throw new Error("EXTRACTOR_RETURNED_INVALID_TOKEN");
    }
    return { tokenId: tokenId.trim() };
  } catch (error) {
    const artifacts = {};
    try {
      const pages = browser.contexts().flatMap((context) => context.pages());
      const page = pages.at(-1);
      if (page) {
        artifacts.screenshotPath = path.join(artifactsDir, "failure.png");
        await page.screenshot({ path: artifacts.screenshotPath, fullPage: false });
        artifacts.htmlPath = path.join(artifactsDir, "failure.html");
        await writeFile(artifacts.htmlPath, (await page.content()).slice(0, 400_000));
      }
      artifacts.consolePath = path.join(artifactsDir, "console.log.txt");
      await writeFile(artifacts.consolePath, consoleLines.join("\n"));
    } catch {
      // Artifact capture is best-effort; the original failure matters more.
    }
    throw new ExtractionError(
      error instanceof Error ? error.message : "EXTRACTION_FAILED",
      artifacts,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

function runProcess(command, args, { input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CODEX_HOME: process.env.CODEX_HOME,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      },
    });
    const stderr = [];
    let outputBytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 1_000_000) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.concat(stderr).length < 64_000) stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(undefined);
      else {
        const diagnostic = Buffer.concat(stderr).toString("utf8").toLowerCase();
        const reason =
          diagnostic.includes("refresh_token_invalidated") ||
          diagnostic.includes("token_revoked") ||
          diagnostic.includes("refresh token was revoked")
            ? "AUTH_REVOKED"
            : diagnostic.includes("401 unauthorized")
              ? "AUTH_UNAUTHORIZED"
              : diagnostic.includes("429") || diagnostic.includes("rate limit")
                ? "RATE_LIMITED"
                : signal === "SIGKILL"
                  ? "TIMEOUT_OR_OUTPUT_LIMIT"
                  : "FAILED";
        // Never surface raw stderr: codex output can quote page content.
        reject(new Error(`REPAIR_PROCESS_FAILED:${reason}:${code ?? signal}`));
      }
    });
    if (input) child.stdin.end(input);
  });
}

export async function invokeCodexRepair({
  currentScript,
  artifacts,
  error,
  promptPath,
  schemaPath,
  timeoutMs = 480_000,
  codexBin = process.env.SOLAX_KEY_AGENT_CODEX_BIN || "codex",
}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "solax-key-repair-"));
  try {
    await writeFile(path.join(workDir, "current-script.mjs"), currentScript, { mode: 0o600 });
    await writeFile(path.join(workDir, "error.txt"), String(error).slice(0, 10_000), { mode: 0o600 });
    for (const [name, source] of [
      ["failure.html", artifacts?.htmlPath],
      ["console.log.txt", artifacts?.consolePath],
    ]) {
      if (!source) continue;
      try {
        await writeFile(path.join(workDir, name), await readFile(source), { mode: 0o600 });
      } catch {
        // A missing artifact reduces repair quality but must not abort it.
      }
    }
    const outputPath = path.join(workDir, "output.json");
    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--cd", workDir,
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
    ];
    if (artifacts?.screenshotPath) {
      try {
        const screenshot = await readFile(artifacts.screenshotPath);
        const localShot = path.join(workDir, "failure.png");
        await writeFile(localShot, screenshot, { mode: 0o600 });
        args.push("--image", localShot);
      } catch {
        // Screenshot is optional context.
      }
    }
    args.push("-");
    const prompt = await readFile(promptPath, "utf8");
    await runProcess(codexBin, args, { input: prompt, timeoutMs });
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.script !== "string") {
      throw new Error("REPAIR_OUTPUT_INVALID");
    }
    return { script: parsed.script, notes: typeof parsed.notes === "string" ? parsed.notes : "" };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
