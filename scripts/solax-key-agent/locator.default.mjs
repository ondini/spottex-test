// Seed locator: given an already-authenticated SolaX portal page, navigate to
// wherever the account tokenID is shown and return it. This is the ONLY part
// the discovery agent rewrites when SolaX moves the token; login stays put.
//
// Contract (the discovery agent must keep it): default export
//   async ({ page, context, log }) => tokenId   // a trimmed string
// - `page` is already logged in; do not log in again.
// - use only the provided page/context; return the tokenID (>= 10 chars) or throw.
//
// The tokenID lives behind the header "API" element and renders into a
// `tokenID:` label. That render is slow and flaky — the value can take well
// over ten seconds to appear — so this is deliberately patient and re-clicks
// before giving up. Only when the element genuinely is not there (SolaX moved
// it) does this throw, and the engine falls back to exploratory discovery.

export default async function locate({ page, log }) {
  log("opening API section");
  const apiButton = page.locator("div.logo-api");
  await apiButton.waitFor({ state: "visible", timeout: 20_000 });
  const value = page.locator(
    'xpath=//span[@class="title" and normalize-space()="tokenID:"]/following-sibling::span[@class="value"]',
  );
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await apiButton.click().catch(() => {});
    try {
      await value.waitFor({ state: "visible", timeout: 15_000 });
      const tokenId = ((await value.textContent()) ?? "").trim();
      if (tokenId.length >= 10) return tokenId;
      lastError = `tokenID element present but value too short (len=${tokenId.length})`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    log(`tokenID not ready yet (attempt ${attempt}/3)`);
  }
  throw new Error(`tokenID did not render after clicking the API section: ${lastError}`);
}
