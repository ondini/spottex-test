// Seed locator: given an already-authenticated SolaX portal page, navigate to
// wherever the account tokenID is shown and return it. This is the ONLY part
// the discovery agent rewrites when SolaX moves the token; login stays put.
//
// Contract (the discovery agent must keep it): default export
//   async ({ page, context, log }) => tokenId   // a trimmed string
// - `page` is already logged in; do not log in again.
// - use only the provided page/context; return the tokenID (>= 10 chars) or throw.
//
// This seed encodes the historically-correct location (header "API" element +
// a `tokenID:` label). When SolaX changes that — as it has — this throws, the
// engine runs discovery, and a freshly authored locator replaces this file.

export default async function locate({ page, log }) {
  log("opening API section (seed locator)");
  await page.locator("div.logo-api").click();
  const value = page.locator(
    'xpath=//span[@class="title" and normalize-space()="tokenID:"]/following-sibling::span[@class="value"]',
  );
  await value.waitFor({ state: "visible", timeout: 10_000 });
  const tokenId = ((await value.textContent()) ?? "").trim();
  if (tokenId.length < 10) {
    throw new Error(`tokenID element found but value looks empty (len=${tokenId.length})`);
  }
  return tokenId;
}
