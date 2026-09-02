// Opt-in integration selftest (not in vitest/CI: needs playwright chromium).
//
//   node scripts/solax-key-agent/selftest.mjs
//
// Serves two fixture portals over loopback and drives the REAL runner + engine:
// 1. old portal — the seed locator reads the tokenID directly (no discovery);
// 2. new portal — the token moved into a separate developer tab, so the seed
//    locator fails, the engine explores, the codex stub authors a locator from
//    the crawl evidence, it is validated in-session and promoted, and a second
//    run then uses the promoted locator with no further discovery.

import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createEngine } from "./engine.mjs";
import { discover, runExtraction } from "./runner.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const credentials = { email: "fixture@example.com", password: "fixture-pass" };
const codexStub = path.join(directory, "fixture", "codex-stub.mjs");
const seedLocator = path.join(directory, "locator.default.mjs");

const CONTENT_TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serveDir(dir) {
  const server = createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(req.url.split("?")[0]);
      let filePath = path.join(dir, rel === "/" ? "index.html" : rel);
      if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
      res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(filePath)] || "text/plain" });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function makeEngine(stateDir, portalUrl) {
  return createEngine({
    stateDir,
    defaultLocatorPath: seedLocator,
    log: (line) => console.log(`  [engine] ${line}`),
    runLocator: async (locatorPath, creds) => {
      const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-run-"));
      return runExtraction({ locatorPath, credentials: creds, portalUrl, artifactsDir, timeoutMs: 60_000 });
    },
    discover: async (creds, failedLocatorPath) => {
      const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-disc-"));
      return discover({
        credentials: creds,
        portalUrl,
        artifactsDir,
        failedLocatorPath,
        promptPath: path.join(directory, "discover-prompt.md"),
        schemaPath: path.join(directory, "discover-output.schema.json"),
        timeoutMs: 60_000,
        codexTimeoutMs: 60_000,
        codexBin: codexStub,
      });
    },
  });
}

await chmod(codexStub, 0o755);

// 1. Old portal: seed locator works, no discovery.
{
  const { server, url } = await serveDir(path.join(directory, "fixture", "old-portal"));
  try {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-old-"));
    const engine = makeEngine(stateDir, url);
    const result = await engine.extract(credentials);
    assert.equal(result.tokenId, "OLDPORTALTOKEN1234567890");
    assert.equal(result.discovered, false);
    console.log("✓ starý portál: seed lokátor přečetl tokenID bez průzkumu");
  } finally {
    server.close();
  }
}

// 2. New portal: seed fails -> discovery finds the token on the developer tab,
//    authors a locator, validates and promotes it.
{
  const { server, url } = await serveDir(path.join(directory, "fixture", "new-portal"));
  try {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "solax-selftest-new-"));
    const engine = makeEngine(stateDir, url);

    const first = await engine.extract(credentials);
    assert.equal(first.tokenId, "NEWPORTALTOKEN0987654321");
    assert.equal(first.discovered, true);
    const archived = await readdir(path.join(stateDir, "history"));
    assert.equal(archived.length, 1, "superseded seed locator should be archived");
    const promoted = await readFile(path.join(stateDir, "current.mjs"), "utf8");
    assert.ok(promoted.includes("waitForEvent"), "promoted locator should follow the new tab");
    console.log("✓ nový portál: seed selhal → průzkum našel klíč v nové záložce → nový lokátor napsán a povýšen");

    const second = await engine.extract(credentials);
    assert.equal(second.tokenId, "NEWPORTALTOKEN0987654321");
    assert.equal(second.discovered, false, "second run should use the promoted locator");
    console.log("✓ nový portál: druhý běh použil povýšený lokátor bez dalšího průzkumu (jen 1 login navíc)");
  } finally {
    server.close();
  }
}

console.log("Selftest OK");
