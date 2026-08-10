#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const container = process.argv[2] || "spottex_backend-web-1";

function containerEnvironment() {
  return execFileSync(
    "docker",
    ["inspect", container, "--format", "{{range .Config.Env}}{{println .}}{{end}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
}

function environmentValue(source, key) {
  const prefix = `${key}=`;
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  return line?.slice(prefix.length) || "";
}

function assertFernetKey(value) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error("Legacy FERNET_KEY is not valid base64url");
  if (Buffer.from(value, "base64url").length !== 32) throw new Error("Legacy FERNET_KEY must decode to 32 bytes");
}

function upsertEnvironmentFile(relativePath, values) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) throw new Error(`Missing target environment file: ${relativePath}`);
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(path, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const legacyEnvironment = containerEnvironment();
const fernetKey = environmentValue(legacyEnvironment, "FERNET_KEY");
if (!fernetKey) throw new Error(`Container ${container} does not expose FERNET_KEY`);
assertFernetKey(fernetKey);

upsertEnvironmentFile(".env", {
  SPOTTEX_LEGACY_API_URL: "http://127.0.0.1:2086",
  SPOTTEX_LEGACY_FERNET_KEY: fernetKey,
  ALLOW_INSECURE_LEGACY_HTTP: "true",
});

upsertEnvironmentFile("Secrets/spottex.development.env", {
  SPOTTEX_LEGACY_API_URL: "http://host.docker.internal:2086",
  SPOTTEX_LEGACY_FERNET_KEY: fernetKey,
  ALLOW_INSECURE_LEGACY_HTTP: "true",
});

upsertEnvironmentFile("Secrets/spottex.production.env", {
  SPOTTEX_LEGACY_FERNET_KEY: fernetKey,
});

process.stdout.write(
  `Imported the existing legacy Fernet key from ${container} into local secrets and the production secret file.\n` +
  "The production legacy API URL remains intentionally unchanged until an internal HTTPS endpoint exists.\n",
);
