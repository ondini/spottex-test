// Opt-in integration selftest (not part of vitest/CI: needs playwright's
// chromium). Exercises the real runner against the bundled fixture portal:
//
//   node scripts/solax-key-agent/selftest.mjs
//
// 1. the default extractor reads the fixture tokenID,
// 2. a broken current script is repaired via the codex stub and promoted,
// 3. a failed run leaves debugging artifacts behind.

import { strict as assert } from "node:assert";
import { access, chmod, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ExtractionError, createEngine } from "./engine.mjs";
import { invokeCodexRepair, runExtractorScript } from "./runner.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const portalUrl = pathToFileURL(path.join(directory, "fixture", "index.html")).href;
const credentials = { email: "fixture@example.com", password: "fixture-pass" };
const codexStub = path.join(directory, "fixture", "codex-stub.mjs");
const EXPECTED_TOKEN = "FIXTURE1234567890TOKEN";
const BROKEN_SCRIPT =
  'export default async function extract() { throw new Error("UI changed"); }\n' +
  `// padding to satisfy the minimum repair-script length ${"x".repeat(40)}\n`;

function makeRunScript() {
  return async (scriptPath, creds) => {
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-artifacts-"));
    return runExtractorScript({
      scriptPath,
      credentials: creds,
      portalUrl,
      artifactsDir,
      timeoutMs: 60_000,
    });
  };
}

// 1. Default extractor against the fixture portal.
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-a-"));
  const engine = createEngine({
    stateDir,
    defaultScriptPath: path.join(directory, "extractor.default.mjs"),
    runScript: makeRunScript(),
  });
  const result = await engine.extract(credentials);
  assert.equal(result.tokenId, EXPECTED_TOKEN);
  assert.equal(result.repaired, false);
  console.log("✓ výchozí extraktor přečetl tokenID z fixture portálu");
}

// 2. Broken current script gets repaired through the codex stub and promoted.
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-b-"));
  await writeFile(path.join(stateDir, "current.mjs"), BROKEN_SCRIPT);
  await chmod(codexStub, 0o755);
  const engine = createEngine({
    stateDir,
    defaultScriptPath: path.join(directory, "extractor.default.mjs"),
    maxRepairAttempts: 1,
    runScript: makeRunScript(),
    invokeRepair: ({ currentScript, artifacts, error }) =>
      invokeCodexRepair({
        currentScript,
        artifacts,
        error,
        promptPath: path.join(directory, "repair-prompt.md"),
        schemaPath: path.join(directory, "repair-output.schema.json"),
        timeoutMs: 30_000,
        codexBin: codexStub,
      }),
  });
  const result = await engine.extract(credentials);
  assert.equal(result.tokenId, EXPECTED_TOKEN);
  assert.equal(result.repaired, true);
  const archived = await readdir(path.join(stateDir, "history"));
  assert.equal(archived.length, 1);
  console.log("✓ rozbitý skript byl opraven codex stubem, ověřen a povýšen");
}

// 3. A failing run captures artifacts for the repair agent.
{
  const scriptDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-c-"));
  const artifactsDir = path.join(scriptDir, "artifacts");
  const brokenPath = path.join(scriptDir, "broken.mjs");
  await writeFile(
    brokenPath,
    'export default async function extract({ page, portalUrl }) {\n' +
      '  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });\n' +
      '  await page.locator("#does-not-exist").click({ timeout: 1000 });\n' +
      "}\n",
  );
  let caught = null;
  try {
    await runExtractorScript({
      scriptPath: brokenPath,
      credentials,
      portalUrl,
      artifactsDir,
      timeoutMs: 30_000,
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ExtractionError, "expected ExtractionError");
  await access(caught.artifacts.screenshotPath);
  await access(caught.artifacts.htmlPath);
  await access(caught.artifacts.consolePath);
  console.log("✓ neúspěšný běh zanechal screenshot, HTML i konzoli pro opravného agenta");
}

console.log("Selftest OK");
