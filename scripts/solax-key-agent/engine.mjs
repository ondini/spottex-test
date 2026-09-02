import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Orchestration only: run the current locator, and when it fails, let discovery
// author a new one and promote it. Everything with side effects (browser,
// codex) is injected, so this file is fully unit-testable and the promotion
// policy lives in one place.

export class ExtractionError extends Error {
  constructor(message, artifacts = null) {
    super(message);
    this.name = "ExtractionError";
    this.artifacts = artifacts;
  }
}

function scriptVersion(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

export function createEngine(options) {
  const {
    stateDir,
    defaultLocatorPath,
    runLocator,
    discover,
    log = () => {},
  } = options;
  if (!stateDir || !defaultLocatorPath || typeof runLocator !== "function") {
    throw new Error("ENGINE_MISCONFIGURED");
  }
  const currentPath = path.join(stateDir, "current.mjs");
  const historyDir = path.join(stateDir, "history");
  let archiveCounter = 0;

  async function ensureCurrent() {
    await mkdir(historyDir, { recursive: true });
    try {
      await readFile(currentPath);
    } catch {
      await copyFile(defaultLocatorPath, currentPath);
      log("seeded current locator from default");
    }
  }

  async function promote(script) {
    let previous = "";
    try {
      previous = await readFile(currentPath, "utf8");
    } catch {
      /* first promotion over the seed copy */
    }
    if (previous) {
      archiveCounter += 1;
      const archivePath = path.join(
        historyDir,
        `${Date.now()}-${archiveCounter}-${scriptVersion(previous)}.mjs`,
      );
      await writeFile(archivePath, previous, { mode: 0o600 });
    }
    // Write to a temp path and rename so a crash never leaves a half-written
    // current locator behind.
    const tmp = path.join(stateDir, "current.next.mjs");
    await writeFile(tmp, script, { mode: 0o600 });
    await rename(tmp, currentPath);
  }

  async function extract(credentials) {
    await ensureCurrent();
    try {
      const { tokenId } = await runLocator(currentPath, credentials);
      return {
        tokenId,
        scriptVersion: scriptVersion(await readFile(currentPath, "utf8")),
        discovered: false,
      };
    } catch (locatorError) {
      if (typeof discover !== "function") throw locatorError;
      log(`current locator failed (${locatorError.message}); starting discovery`);
      // Discovery logs in once, explores, authors a locator and validates it
      // in that same session, so it returns a token already proven to work.
      const { script, tokenId } = await discover(credentials, currentPath);
      if (typeof script !== "string" || script.length < 50 || typeof tokenId !== "string") {
        throw new Error("DISCOVERY_RETURNED_INVALID_RESULT");
      }
      await promote(script);
      log(`discovery succeeded and promoted new locator (${scriptVersion(script)})`);
      return { tokenId, scriptVersion: scriptVersion(script), discovered: true };
    }
  }

  return { extract };
}
