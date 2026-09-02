#!/usr/bin/env node
// Stand-in for the codex CLI in selftest.mjs, for the discovery flow. It reads
// the exploration bundle (observations.json in the --cd workdir), finds the
// page whose token candidate is labelled (context mentions tokenID/API), and
// emits a locator that reproduces the navigation the crawl used to reach it —
// exactly what a real reasoning model would produce, but deterministic. It does
// NOT hardcode the token value; it derives the target from the crawl evidence.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const at = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const cd = at("--cd") || process.cwd();
const outputPath = at("--output-last-message");
if (!outputPath) {
  console.error("codex-stub: missing --output-last-message");
  process.exit(2);
}
try {
  readFileSync(0, "utf8"); // drain the prompt like the real CLI
} catch {
  /* stdin may be empty */
}

const bundle = JSON.parse(readFileSync(path.join(cd, "observations.json"), "utf8"));
const candidate =
  (bundle.tokenCandidates || []).find((c) => c.labelled) ||
  (bundle.tokenCandidates || [])[0];
if (!candidate) {
  console.error("codex-stub: no token candidate in observations");
  process.exit(3);
}

// The crawl reached the token page by following a header nav label into a new
// tab. Find which label led to the candidate's page so the locator clicks the
// same thing rather than a hardcoded selector.
const tokenPage = (bundle.pages || []).find((p) => p.index === candidate.pageIndex);
const via = (tokenPage && tokenPage.via) || "click:API";
const label = via.startsWith("click:") ? via.slice("click:".length) : "API";

const script = `// Authored by the discovery agent from crawl evidence.
export default async function locate({ page, context, log }) {
  log("following '${label}' to the developer page");
  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 10000 }),
    page.getByText(${JSON.stringify(label)}, { exact: true }).first().click(),
  ]);
  await popup.waitForLoadState("domcontentloaded", { timeout: 10000 });
  const el = popup.locator(".api-token .token");
  await el.waitFor({ state: "visible", timeout: 10000 });
  const tokenId = ((await el.textContent()) || "").trim();
  if (tokenId.length < 10) throw new Error("developer page token looks empty");
  return tokenId;
}
`;

writeFileSync(
  outputPath,
  JSON.stringify({ script, notes: `Token on '${candidate.pageTitle}' reached via '${label}'.` }),
);
