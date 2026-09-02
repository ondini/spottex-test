import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { ExtractionError, createEngine } from "./engine.mjs";

const CREDENTIALS = { email: "user@example.com", password: "secret" };

let stateDir;
let defaultScriptPath;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(os.tmpdir(), "solax-engine-test-"));
  defaultScriptPath = path.join(stateDir, "default.mjs");
  await writeFile(defaultScriptPath, "export default async () => \"DEFAULT-SCRIPT-BODY\";\n");
});

describe("createEngine", () => {
  it("seeds current.mjs from the default script and returns its token", async () => {
    const engine = createEngine({
      stateDir,
      defaultScriptPath,
      runScript: async (scriptPath) => {
        expect(path.basename(scriptPath)).toBe("current.mjs");
        return { tokenId: "TOKEN-1234567890" };
      },
    });
    const result = await engine.extract(CREDENTIALS);
    expect(result.tokenId).toBe("TOKEN-1234567890");
    expect(result.repaired).toBe(false);
    expect(result.scriptVersion).toMatch(/^[0-9a-f]{8}$/);
    const seeded = await readFile(path.join(stateDir, "current.mjs"), "utf8");
    expect(seeded).toContain("DEFAULT-SCRIPT-BODY");
  });

  it("repairs, validates and promotes a candidate when the current script fails", async () => {
    const repairedBody = `export default async () => "REPAIRED";\n// ${"x".repeat(60)}\n`;
    let repairCalls = 0;
    const engine = createEngine({
      stateDir,
      defaultScriptPath,
      maxRepairAttempts: 2,
      runScript: async (scriptPath) => {
        const content = await readFile(scriptPath, "utf8");
        if (content.includes("REPAIRED")) return { tokenId: "TOKEN-AFTER-REPAIR" };
        throw new ExtractionError("selector timeout", { htmlPath: "/tmp/none" });
      },
      invokeRepair: async ({ currentScript, error }) => {
        repairCalls += 1;
        expect(currentScript).toContain("DEFAULT-SCRIPT-BODY");
        expect(error).toContain("selector timeout");
        return { script: repairedBody };
      },
    });
    const result = await engine.extract(CREDENTIALS);
    expect(result).toMatchObject({ tokenId: "TOKEN-AFTER-REPAIR", repaired: true });
    expect(repairCalls).toBe(1);
    const current = await readFile(path.join(stateDir, "current.mjs"), "utf8");
    expect(current).toContain("REPAIRED");
    const archived = await readdir(path.join(stateDir, "history"));
    expect(archived).toHaveLength(1);
  });

  it("gives up after maxRepairAttempts and rethrows the last error", async () => {
    let repairCalls = 0;
    const engine = createEngine({
      stateDir,
      defaultScriptPath,
      maxRepairAttempts: 2,
      runScript: async () => {
        throw new ExtractionError("still broken");
      },
      invokeRepair: async () => {
        repairCalls += 1;
        return { script: `export default async () => { throw new Error("no"); };\n// pad ${"y".repeat(40)}` };
      },
    });
    await expect(engine.extract(CREDENTIALS)).rejects.toThrow("still broken");
    expect(repairCalls).toBe(2);
    const current = await readFile(path.join(stateDir, "current.mjs"), "utf8");
    expect(current).toContain("DEFAULT-SCRIPT-BODY");
  });

  it("rejects repair output that is too short to be a script", async () => {
    const engine = createEngine({
      stateDir,
      defaultScriptPath,
      maxRepairAttempts: 1,
      runScript: async () => {
        throw new ExtractionError("broken");
      },
      invokeRepair: async () => ({ script: "short" }),
    });
    await expect(engine.extract(CREDENTIALS)).rejects.toThrow("REPAIR_SCRIPT_INVALID");
  });

  it("propagates the failure without repair when invokeRepair is absent", async () => {
    const engine = createEngine({
      stateDir,
      defaultScriptPath,
      runScript: async () => {
        throw new ExtractionError("no repair configured");
      },
    });
    await expect(engine.extract(CREDENTIALS)).rejects.toThrow("no repair configured");
  });
});
