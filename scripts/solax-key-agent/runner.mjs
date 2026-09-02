import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exploreForToken } from "./explorer.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const loginPath = path.join(directory, "login.mjs");

// Side-effect half of the agent: real browser sessions and real codex calls.
// Playwright is imported lazily so unit tests of the engine never load it.

export class ExtractionError extends Error {
  constructor(message, artifacts = null) {
    super(message);
    this.name = "ExtractionError";
    this.artifacts = artifacts;
  }
}

let importCounter = 0;

async function importFresh(scriptPath) {
  importCounter += 1;
  const moduleUrl = `${pathToFileURL(scriptPath).href}?v=${importCounter}`;
  const loaded = await import(moduleUrl);
  if (typeof loaded.default !== "function") {
    throw new Error(`SCRIPT_HAS_NO_DEFAULT_EXPORT:${path.basename(scriptPath)}`);
  }
  return loaded.default;
}

function makeLog(sink) {
  return (line) => {
    if (sink.length < 800) sink.push(String(line).slice(0, 200));
  };
}

// Launch a browser, log in ONCE, and hand the authenticated page to `work`.
// Every portal-touching operation goes through here so a single run never logs
// in more than once — the scarce resource this whole service is built around.
async function withSession({ credentials, portalUrl, artifactsDir, timeoutMs }, work) {
  const { chromium } = await import("playwright");
  await mkdir(artifactsDir, { recursive: true });
  const logSink = [];
  const log = makeLog(logSink);
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(Math.min(30_000, timeoutMs));
  try {
    const login = await importFresh(loginPath);
    await login({ page, credentials, portalUrl, log });
    return await work({ page, context, log, logSink });
  } catch (error) {
    const artifacts = await captureArtifacts(context, artifactsDir, logSink);
    throw new ExtractionError(
      error instanceof Error ? error.message : "SESSION_FAILED",
      artifacts,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureArtifacts(context, artifactsDir, logSink) {
  const artifacts = {};
  try {
    const page = context.pages().at(-1);
    if (page) {
      artifacts.screenshotPath = path.join(artifactsDir, "failure.png");
      await page.screenshot({ path: artifacts.screenshotPath, fullPage: false });
      artifacts.htmlPath = path.join(artifactsDir, "failure.html");
      await writeFile(artifacts.htmlPath, (await page.content()).slice(0, 400_000));
    }
    artifacts.consolePath = path.join(artifactsDir, "console.log.txt");
    await writeFile(artifacts.consolePath, logSink.join("\n"));
  } catch {
    /* best effort */
  }
  return artifacts;
}

async function runLocatorOnPage(locatorPath, page, context, log) {
  const locate = await importFresh(locatorPath);
  const tokenId = await locate({ page, context, log });
  if (typeof tokenId !== "string" || tokenId.trim().length < 10) {
    throw new Error("LOCATOR_RETURNED_INVALID_TOKEN");
  }
  return tokenId.trim();
}

// Try the current locator against a fresh authenticated session.
export async function runExtraction({ locatorPath, credentials, portalUrl, artifactsDir, timeoutMs = 180_000 }) {
  return withSession(
    { credentials, portalUrl, artifactsDir, timeoutMs },
    async ({ page, context, log }) => ({
      tokenId: await runLocatorOnPage(locatorPath, page, context, log),
    }),
  );
}

// One login, then: explore -> let codex author a locator from the evidence ->
// validate that locator in the SAME session -> return the working script.
export async function discover({
  credentials,
  portalUrl,
  artifactsDir,
  failedLocatorPath,
  promptPath,
  schemaPath,
  timeoutMs = 180_000,
  codexTimeoutMs = 480_000,
  codexBin = process.env.SOLAX_KEY_AGENT_CODEX_BIN || "codex",
}) {
  return withSession(
    { credentials, portalUrl, artifactsDir, timeoutMs },
    async ({ page, context, log }) => {
      const exploration = await exploreForToken({ page, context, artifactsDir, log });
      const failedLocator = failedLocatorPath
        ? await readFile(failedLocatorPath, "utf8").catch(() => "")
        : "";
      const { script } = await invokeCodexDiscovery({
        bundlePath: exploration.bundlePath,
        artifactsDir,
        failedLocator,
        promptPath,
        schemaPath,
        timeoutMs: codexTimeoutMs,
        codexBin,
      });
      if (typeof script !== "string" || script.length < 50) {
        throw new Error("DISCOVERY_SCRIPT_INVALID");
      }
      // Validate the freshly authored locator in this same authenticated
      // session — no extra login — before it is allowed to become current.
      const candidatePath = path.join(artifactsDir, "discovered-locator.mjs");
      await writeFile(candidatePath, script, { mode: 0o600 });
      const tokenId = await runLocatorOnPage(candidatePath, page, context, log);
      log("discovered locator validated in-session");
      return { script, tokenId };
    },
  );
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
      if (outputBytes > 2_000_000) child.kill("SIGKILL");
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
        // Never surface raw stderr: codex output can quote portal content.
        reject(new Error(`DISCOVERY_PROCESS_FAILED:${reason}:${code ?? signal}`));
      }
    });
    if (input) child.stdin.end(input);
  });
}

// Hands the exploration evidence to codex and gets back a full locator script.
// Modelled on the invoice parser's codex call: ephemeral, output-schema'd,
// prompt on stdin, one page screenshot as the image.
export async function invokeCodexDiscovery({
  bundlePath,
  artifactsDir,
  failedLocator,
  promptPath,
  schemaPath,
  timeoutMs = 480_000,
  codexBin = process.env.SOLAX_KEY_AGENT_CODEX_BIN || "codex",
}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "solax-discover-"));
  try {
    await copyFile(bundlePath, path.join(workDir, "observations.json"));
    await writeFile(
      path.join(workDir, "failed-locator.mjs"),
      String(failedLocator || "// (none)"),
      { mode: 0o600 },
    );
    // Include the page screenshots so codex can see the rendered UI.
    const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
    for (const shot of bundle.pages ?? []) {
      if (!shot.screenshot) continue;
      await copyFile(
        path.join(artifactsDir, shot.screenshot),
        path.join(workDir, shot.screenshot),
      ).catch(() => {});
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
    // The most promising page's screenshot goes in as the image.
    const promising = (bundle.tokenCandidates ?? []).find((candidate) => candidate.labelled)
      ?? (bundle.tokenCandidates ?? [])[0];
    const shotName = bundle.pages?.[promising?.pageIndex ?? 0]?.screenshot;
    if (shotName) args.push("--image", path.join(workDir, shotName));
    args.push("-");
    const prompt = await readFile(promptPath, "utf8");
    await runProcess(codexBin, args, { input: prompt, timeoutMs });
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.script !== "string") {
      throw new Error("DISCOVERY_OUTPUT_INVALID");
    }
    return { script: parsed.script, notes: typeof parsed.notes === "string" ? parsed.notes : "" };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
