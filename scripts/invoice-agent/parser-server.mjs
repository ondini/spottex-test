import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const socketPath = process.env.INVOICE_PARSER_SOCKET ?? "/run/invoice-parser/parser.sock";
const port = process.env.INVOICE_PARSER_PORT ? Number(process.env.INVOICE_PARSER_PORT) : null;
const bindAddress = process.env.INVOICE_PARSER_BIND ?? "127.0.0.1";
const token = process.env.INVOICE_PARSER_TOKEN ?? "";
const maxDocumentBytes = Number(process.env.INVOICE_MAX_DOCUMENT_BYTES ?? 10 * 1024 * 1024);
const timeoutMs = Number(process.env.INVOICE_CODEX_TIMEOUT_MS ?? 8 * 60_000);
let active = false;

// This endpoint drives a Codex agent, so an unauthenticated caller could burn
// API credit and feed it arbitrary documents. Until now the only protection was
// that nothing could route to it: a unix socket, or a port bound to loopback in
// a network namespace shared with the coordinator alone. The moment it listens
// anywhere else -- a WireGuard address, so the platform can reach it from
// another host without the Codex credential ever leaving this machine -- that
// assumption is gone and a token is the thing standing in for it.
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const isLoopbackOnly = port !== null && LOOPBACK.has(bindAddress);
const requiresToken = port !== null && !isLoopbackOnly;

if (requiresToken && token.length < 32) {
  console.error(
    `Refusing to listen on ${bindAddress}: INVOICE_PARSER_TOKEN must be set to at least 32 characters ` +
      "when the parser is reachable beyond loopback.",
  );
  process.exit(1);
}

function tokenAccepted(header) {
  if (!token) return true;
  const prefix = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(prefix)) return false;
  const presented = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CODEX_HOME: process.env.CODEX_HOME,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      },
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 1_000_000) child.kill("SIGKILL");
      else stdout.push(chunk);
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
      if (code === 0) resolve(Buffer.concat(stdout));
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
        // Never emit raw stderr: Codex CLI output can contain document text.
        reject(
          new Error(
            `PARSER_PROCESS_FAILED:${command}:${reason}:${code ?? signal}`,
          ),
        );
      }
    });
    if (options.input) child.stdin.end(options.input);
  });
}

async function parseInvoice(payload) {
  if (!payload || typeof payload !== "object") throw new Error("INVALID_REQUEST");
  if (!["application/pdf", "image/jpeg", "image/png"].includes(payload.mimeType)) {
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
  }
  if (typeof payload.contentBase64 !== "string") throw new Error("INVALID_DOCUMENT");
  const content = Buffer.from(payload.contentBase64, "base64");
  if (!content.length || content.length > maxDocumentBytes) throw new Error("INVALID_DOCUMENT_SIZE");
  const workDir = await mkdtemp(path.join(os.tmpdir(), "invoice-ai-"));
  try {
    const extension = payload.mimeType === "application/pdf" ? "pdf" : payload.mimeType === "image/png" ? "png" : "jpg";
    const documentPath = path.join(workDir, `invoice.${extension}`);
    const outputPath = path.join(workDir, "output.json");
    await writeFile(documentPath, content, { mode: 0o600, flag: "wx" });
    const prompt = await readFile(path.join(directory, "prompt.md"), "utf8");
    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--cd", workDir,
      "--output-schema", path.join(directory, "output.schema.json"),
      "--output-last-message", outputPath,
    ];
    let input = prompt;
    if (payload.mimeType === "application/pdf") {
      const textPath = path.join(workDir, "invoice.txt");
      await run("pdftotext", ["-layout", documentPath, textPath]);
      const text = (await readFile(textPath, "utf8")).slice(0, 200_000);
      input += `\n\n--- ZAČÁTEK TEXTU FAKTURY ---\n${text}\n--- KONEC TEXTU FAKTURY ---\n`;
    } else {
      args.push("--image", documentPath);
    }
    args.push("-");
    await run("codex", args, { cwd: workDir, input });
    const raw = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_AI_JSON");
    return parsed;
  } finally {
    content.fill(0);
    await rm(workDir, { recursive: true, force: true });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  if (request.method !== "POST" || request.url !== "/parse") {
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
    if (bytes > Math.ceil(maxDocumentBytes * 1.4) + 100_000) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", async () => {
    active = true;
    try {
      const result = await parseInvoice(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
    } catch (error) {
      console.error("Invoice parser failed", error instanceof Error ? error.message : "unknown");
      response.writeHead(422, { "content-type": "application/json", "cache-control": "no-store" });
      response.end('{"error":"invoice_parse_failed"}');
    } finally {
      active = false;
    }
  });
});

if (port) {
  server.listen(port, bindAddress, () =>
    console.log(`Invoice parser is ready on ${bindAddress}:${port}${token ? " (token required)" : ""}`),
  );
} else {
  await unlink(socketPath).catch(() => undefined);
  server.listen(socketPath, async () => {
    await chmod(socketPath, 0o660);
    console.log("Invoice parser is ready");
  });
}
