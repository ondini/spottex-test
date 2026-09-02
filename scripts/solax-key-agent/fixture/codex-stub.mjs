#!/usr/bin/env node
// Stand-in for the codex CLI used by selftest.mjs: honors just enough of the
// invocation contract (--output-last-message, reads stdin) to hand back a
// known-good replacement extractor for the fixture portal.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex === -1 || !args[outputIndex + 1]) {
  console.error("codex-stub: missing --output-last-message");
  process.exit(2);
}
try {
  readFileSync(0, "utf8"); // drain the prompt from stdin like the real CLI
} catch {
  // stdin may be empty in edge cases; the stub does not need the prompt.
}

const repairedScript = `// Repaired by codex-stub for the fixture portal.
export default async function extract({ page, credentials, portalUrl }) {
  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
  await page
    .locator('input[placeholder="Please enter your user name/email/mobile number"]')
    .fill(credentials.email);
  await page.locator('input[placeholder="Enter Password"]').fill(credentials.password);
  await page.locator("#agreeMent .arco-checkbox-icon-hover").click();
  await page.locator(".submit-button").click();
  await page.waitForFunction(() => document.title === "Solax Cloud System");
  await page.locator("div.logo-api").click();
  const value = page.locator("#apiPanel .value");
  await value.waitFor({ state: "visible", timeout: 10000 });
  const tokenId = ((await value.textContent()) ?? "").trim();
  if (tokenId.length < 10) throw new Error("empty tokenID");
  return tokenId;
}
`;

writeFileSync(
  args[outputIndex + 1],
  JSON.stringify({ script: repairedScript, notes: "stub" }),
);
