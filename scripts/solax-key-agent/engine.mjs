import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Orchestration only: which script runs, when a repair is attempted, and how a
// validated candidate becomes the new current script. Everything with side
// effects beyond the state directory (browser, codex process) is injected, so
// this file is fully unit-testable and the repair policy stays in one place.

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
    defaultScriptPath,
    runScript,
    invokeRepair,
    maxRepairAttempts = 2,
    log = () => {},
  } = options;
  if (!stateDir || !defaultScriptPath || typeof runScript !== "function") {
    throw new Error("ENGINE_MISCONFIGURED");
  }
  const currentPath = path.join(stateDir, "current.mjs");
  const historyDir = path.join(stateDir, "history");
  // Monotonic archive names without wall-clock reads at import time.
  let archiveCounter = 0;

  async function ensureCurrent() {
    await mkdir(historyDir, { recursive: true });
    try {
      await readFile(currentPath);
    } catch {
      await copyFile(defaultScriptPath, currentPath);
      log("seeded current extractor from default script");
    }
  }

  async function promote(candidatePath) {
    const previous = await readFile(currentPath, "utf8");
    archiveCounter += 1;
    const archivePath = path.join(
      historyDir,
      `${Date.now()}-${archiveCounter}-${scriptVersion(previous)}.mjs`,
    );
    await writeFile(archivePath, previous, { mode: 0o600 });
    // rename() is atomic on one filesystem, so a crash mid-promotion can never
    // leave a half-written current script behind.
    await rename(candidatePath, currentPath);
  }

  async function extract(credentials) {
    await ensureCurrent();
    try {
      const { tokenId } = await runScript(currentPath, credentials);
      const version = scriptVersion(await readFile(currentPath, "utf8"));
      return { tokenId, scriptVersion: version, repaired: false };
    } catch (initialError) {
      if (typeof invokeRepair !== "function") throw initialError;
      let lastError = initialError;
      for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
        log(`extractor failed, repair attempt ${attempt}/${maxRepairAttempts}`);
        try {
          const { script } = await invokeRepair({
            currentScript: await readFile(currentPath, "utf8"),
            artifacts: lastError instanceof ExtractionError ? lastError.artifacts : null,
            error: lastError.message,
          });
          if (typeof script !== "string" || script.length < 50) {
            throw new Error("REPAIR_SCRIPT_INVALID");
          }
          const candidatePath = path.join(stateDir, `candidate-${attempt}.mjs`);
          await writeFile(candidatePath, script, { mode: 0o600 });
          const { tokenId } = await runScript(candidatePath, credentials);
          await promote(candidatePath);
          const version = scriptVersion(script);
          log(`repair attempt ${attempt} validated and promoted (${version})`);
          return { tokenId, scriptVersion: version, repaired: true };
        } catch (repairError) {
          lastError = repairError;
        }
      }
      throw lastError;
    }
  }

  return { extract };
}
