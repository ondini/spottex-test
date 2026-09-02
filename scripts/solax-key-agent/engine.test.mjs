import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { createEngine } from "./engine.mjs";

const CREDENTIALS = { email: "user@example.com", password: "secret" };
const GOOD_LOCATOR = `export default async () => "TOKEN-1234567890";\n// ${"x".repeat(60)}\n`;

let stateDir;
let defaultLocatorPath;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(os.tmpdir(), "solax-engine-test-"));
  defaultLocatorPath = path.join(stateDir, "default.mjs");
  await writeFile(defaultLocatorPath, "export default async () => \"SEED-LOCATOR-BODY\";\n");
});

describe("createEngine", () => {
  it("seeds current.mjs from the default locator and returns its token", async () => {
    const engine = createEngine({
      stateDir,
      defaultLocatorPath,
      runLocator: async (locatorPath) => {
        expect(path.basename(locatorPath)).toBe("current.mjs");
        return { tokenId: "TOKEN-1234567890" };
      },
    });
    const result = await engine.extract(CREDENTIALS);
    expect(result).toMatchObject({ tokenId: "TOKEN-1234567890", discovered: false });
    expect(result.scriptVersion).toMatch(/^[0-9a-f]{8}$/);
    expect(await readFile(path.join(stateDir, "current.mjs"), "utf8")).toContain("SEED-LOCATOR-BODY");
  });

  it("runs discovery and promotes the new locator when the current one fails", async () => {
    let discoverCalls = 0;
    const engine = createEngine({
      stateDir,
      defaultLocatorPath,
      runLocator: async () => {
        throw new Error("logo-api not found");
      },
      discover: async (credentials, failedLocatorPath) => {
        discoverCalls += 1;
        expect(credentials).toEqual(CREDENTIALS);
        expect(path.basename(failedLocatorPath)).toBe("current.mjs");
        return { script: GOOD_LOCATOR, tokenId: "TOKEN-AFTER-DISCOVERY" };
      },
    });
    const result = await engine.extract(CREDENTIALS);
    expect(result).toMatchObject({ tokenId: "TOKEN-AFTER-DISCOVERY", discovered: true });
    expect(discoverCalls).toBe(1);
    const current = await readFile(path.join(stateDir, "current.mjs"), "utf8");
    expect(current).toContain("TOKEN-1234567890");
    // The superseded seed locator is archived, not lost.
    const archived = await readdir(path.join(stateDir, "history"));
    expect(archived).toHaveLength(1);
  });

  it("rejects a discovery result whose script is too short to be real", async () => {
    const engine = createEngine({
      stateDir,
      defaultLocatorPath,
      runLocator: async () => {
        throw new Error("broken");
      },
      discover: async () => ({ script: "nope", tokenId: "TOKEN-1234567890" }),
    });
    await expect(engine.extract(CREDENTIALS)).rejects.toThrow("DISCOVERY_RETURNED_INVALID_RESULT");
  });

  it("propagates the locator failure when no discover function is configured", async () => {
    const engine = createEngine({
      stateDir,
      defaultLocatorPath,
      runLocator: async () => {
        throw new Error("no discovery configured");
      },
    });
    await expect(engine.extract(CREDENTIALS)).rejects.toThrow("no discovery configured");
  });

  it("uses the promoted locator on the next run without discovering again", async () => {
    await writeFile(path.join(stateDir, "current.mjs"), GOOD_LOCATOR);
    let discoverCalls = 0;
    const engine = createEngine({
      stateDir,
      defaultLocatorPath,
      runLocator: async () => ({ tokenId: "TOKEN-PROMOTED" }),
      discover: async () => {
        discoverCalls += 1;
        return { script: GOOD_LOCATOR, tokenId: "x" };
      },
    });
    const result = await engine.extract(CREDENTIALS);
    expect(result).toMatchObject({ tokenId: "TOKEN-PROMOTED", discovered: false });
    expect(discoverCalls).toBe(0);
  });
});
