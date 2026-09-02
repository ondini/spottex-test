// The stable primitive. Logging in is the one step SolaX changes least often,
// and every session runs it exactly once — the discovery loop reuses the
// authenticated page rather than logging in again, which is what keeps the
// number of portal logins down (SolaX locks accounts that log in too often).
//
// If the login form itself ever changes, this is the single place to adjust;
// the volatile "where is the token" logic lives in the swappable locator, not
// here.

export default async function login({ page, credentials, portalUrl, log }) {
  log("opening portal");
  await page.goto(portalUrl, { waitUntil: "domcontentloaded" });
  log("filling credentials");
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
  log("authenticated");
}
