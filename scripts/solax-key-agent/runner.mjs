import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

// Copy the evidence and every authored attempt into a stable directory so a
// failed discovery can be debugged offline without spending another portal
// login. Overwrites each run.
async function persistDiscovery(artifactsDir, persistDir, attempts, finalError) {
  if (!persistDir) return;
  try {
    await rm(persistDir, { recursive: true, force: true });
    await mkdir(persistDir, { recursive: true });
    const entries = await readdir(artifactsDir).catch(() => []);
    for (const name of entries) {
      if (/\.(png|json|mjs)$/.test(name)) {
        await copyFile(path.join(artifactsDir, name), path.join(persistDir, name)).catch(() => {});
      }
    }
    await writeFile(
      path.join(persistDir, "attempts.json"),
      JSON.stringify({ attempts, finalError }, null, 2),
    );
  } catch {
    /* diagnostics are best-effort */
  }
}

// One login, then loop: explore -> let codex author a locator from the
// evidence -> validate it in the SAME session. On a failed attempt, feed the
// attempt and its error back so codex can correct. All attempts share the one
// authenticated session, so discovery costs a single portal login regardless
// of how many tries it takes.
export async function discover({
  credentials,
  portalUrl,
  artifactsDir,
  failedLocatorPath,
  promptPath,
  schemaPath,
  persistDir,
  maxAttempts = 3,
  timeoutMs = 180_000,
  codexTimeoutMs = 480_000,
  codexBin = process.env.SOLAX_KEY_AGENT_CODEX_BIN || "codex",
}) {
  return withSession(
    { credentials, portalUrl, artifactsDir, timeoutMs },
    async ({ page, context, log }) => {
      const exploration = await exploreForToken({ page, context, artifactsDir, log });
      const seedLocator = failedLocatorPath
        ? await readFile(failedLocatorPath, "utf8").catch(() => "")
        : "";
      const attempts = [];
      let failedLocator = seedLocator;
      let errorText = "the current locator no longer finds the tokenID";
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        log(`discovery attempt ${attempt}/${maxAttempts}`);
        let script;
        try {
          ({ script } = await invokeCodexDiscovery({
            bundlePath: exploration.bundlePath,
            artifactsDir,
            failedLocator,
            errorText,
            promptPath,
            schemaPath,
            timeoutMs: codexTimeoutMs,
            codexBin,
          }));
        } catch (authorError) {
          errorText = authorError.message;
          attempts.push({ attempt, stage: "author", error: errorText });
          continue;
        }
        if (typeof script !== "string" || script.length < 50) {
          errorText = "authored script was too short to be a locator";
          attempts.push({ attempt, stage: "author", error: errorText });
          continue;
        }
        const candidatePath = path.join(artifactsDir, `discovered-${attempt}.mjs`);
        await writeFile(candidatePath, script, { mode: 0o600 });
        try {
          const tokenId = await runLocatorOnPage(candidatePath, page, context, log);
          log(`discovery attempt ${attempt} validated in-session`);
          attempts.push({ attempt, stage: "validate", ok: true });
          await persistDiscovery(artifactsDir, persistDir, attempts, null);
          return { script, tokenId };
        } catch (validateError) {
          // Feed this failed attempt back to the next authoring round.
          failedLocator = script;
          errorText = validateError.message;
          attempts.push({ attempt, stage: "validate", error: errorText });
          log(`discovery attempt ${attempt} did not validate: ${errorText}`);
        }
      }
      await persistDiscovery(artifactsDir, persistDir, attempts, errorText);
      throw new Error(`DISCOVERY_EXHAUSTED_AFTER_${maxAttempts}:${errorText}`);
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
  errorText,
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
    await writeFile(
      path.join(workDir, "error.txt"),
      String(errorText || "the current locator no longer finds the tokenID").slice(0, 4000),
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
      // Authoring a navigation script from screenshots and a DOM outline is a
      // hard reasoning task; the default effort produced brittle guesses.
      "-c", "model_reasoning_effort=high",
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
