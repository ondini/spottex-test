import { timingSafeEqual } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createEngine } from "./engine.mjs";
import { invokeCodexRepair, runExtractorScript } from "./runner.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SOLAX_KEY_AGENT_PORT ?? 3011);
const bindAddress = process.env.SOLAX_KEY_AGENT_BIND ?? "127.0.0.1";
const token = process.env.SOLAX_KEY_AGENT_TOKEN ?? "";
const stateDir = process.env.SOLAX_KEY_AGENT_STATE_DIR ?? "/data/extractor";
const portalUrl =
  process.env.SOLAX_KEY_AGENT_PORTAL_URL ?? "https://global.solaxcloud.com/user-center/";
const extractionTimeoutMs = Number(process.env.SOLAX_KEY_AGENT_TIMEOUT_MS ?? 180_000);
const repairAttempts = Number(process.env.SOLAX_KEY_AGENT_REPAIR_ATTEMPTS ?? 2);
const codexTimeoutMs = Number(process.env.SOLAX_KEY_AGENT_CODEX_TIMEOUT_MS ?? 480_000);
let active = false;

// Same reasoning as the invoice parser: this endpoint accepts portal
// credentials and can burn Codex credit, so the moment it listens anywhere
// beyond loopback a strong token is mandatory.
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const requiresToken = !LOOPBACK.has(bindAddress);
if (requiresToken && token.length < 32) {
  console.error(
    `Refusing to listen on ${bindAddress}: SOLAX_KEY_AGENT_TOKEN must be set to at least 32 characters ` +
      "when the agent is reachable beyond loopback.",
  );
  process.exit(1);
}

function tokenAccepted(header) {
  if (!token) return true;
  const prefix = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(prefix)) return false;
  const presented = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

const engine = createEngine({
  stateDir,
  defaultScriptPath: path.join(directory, "extractor.default.mjs"),
  portalUrl,
  maxRepairAttempts: repairAttempts,
  log: (line) => console.log(`[engine] ${line}`),
  // Artifacts live in tmpfs: the repair step copies what it needs into its
  // own workdir, so leftover directories vanish with the container.
  runScript: async (scriptPath, credentials) => {
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "solax-key-artifacts-"));
    return runExtractorScript({
      scriptPath,
      credentials,
      portalUrl,
      artifactsDir,
      timeoutMs: extractionTimeoutMs,
    });
  },
  invokeRepair: ({ currentScript, artifacts, error }) =>
    invokeCodexRepair({
      currentScript,
      artifacts,
      error,
      promptPath: path.join(directory, "repair-prompt.md"),
      schemaPath: path.join(directory, "repair-output.schema.json"),
      timeoutMs: codexTimeoutMs,
    }),
});

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  if (request.method !== "POST" || request.url !== "/extract") {
    response.writeHead(404).end();
    return;
  }
  if (!tokenAccepted(request.headers.authorization)) {
    response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
    response.end('{"error":"unauthorized"}');
    return;
  }
  if (active) {
    response.writeHead(429, { "content-type": "application/json" });
    response.end('{"error":"busy"}');
    return;
  }
  const chunks = [];
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 64_000) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", async () => {
    active = true;
    try {
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        payload = null;
      }
      const email = payload?.email;
      const password = payload?.password;
      if (typeof email !== "string" || !email || typeof password !== "string" || !password) {
        response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
        response.end('{"error":"invalid_request"}');
        return;
      }
      const result = await engine.extract({ email, password });
      console.log(
        `extraction ok (account len=${email.length}, token len=${result.tokenId.length}, ` +
          `script=${result.scriptVersion}, repaired=${result.repaired})`,
      );
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
    } catch (error) {
      // Never echo internals: messages could quote portal DOM or codex output.
      console.error(
        "extraction failed",
        error instanceof Error ? error.message.slice(0, 300) : "unknown",
      );
      response.writeHead(422, { "content-type": "application/json", "cache-control": "no-store" });
      response.end('{"error":"solax_key_extract_failed"}');
    } finally {
      active = false;
    }
  });
});

server.listen(port, bindAddress, () =>
  console.log(
    `SolaX key agent is ready on ${bindAddress}:${port}${token ? " (token required)" : ""}`,
  ),
);
