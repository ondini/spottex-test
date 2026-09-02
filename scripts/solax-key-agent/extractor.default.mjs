// Current known-good extraction flow for the SolaX Cloud user portal,
// verified against the live portal on 2026-09-02. This file only seeds the
// state directory: after the first successful LLM repair the promoted script
// in SOLAX_KEY_AGENT_STATE_DIR/current.mjs takes over.
//
// Contract (repair agents must keep it): default export async function
// ({ page, credentials, portalUrl, log }) that returns the account tokenID
// as a non-empty string. Only the provided playwright page may be used; no
// other network access, no logging of credentials.

export default async function extract({ page, credentials, portalUrl, log }) {
  log("opening portal");
  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });

  log("filling login form");
  await page
    .locator('input[placeholder="Please enter your user name/email/mobile number"]')
    .fill(credentials.email);
  await page.locator('input[placeholder="Enter Password"]').fill(credentials.password);
  await page.locator("#agreeMent .arco-checkbox-icon-hover").click();
  await page.locator(".submit-button").click();

  log("waiting for signed-in portal");
  await page.waitForFunction(
    () => document.title === "Solax Cloud System",
    undefined,
    { timeout: 30_000 },
  );

  log("opening API page");
  await page.locator("div.logo-api").click();
  const value = page.locator(
    'xpath=//span[@class="title" and normalize-space()="tokenID:"]/following-sibling::span[@class="value"]',
  );
  await value.waitFor({ state: "visible", timeout: 10_000 });
  const tokenId = (await value.textContent())?.trim() ?? "";
  if (tokenId.length < 10) {
    throw new Error(`tokenID element found but value looks empty (len=${tokenId.length})`);
  }
  log("tokenID read");
  return tokenId;
}
