import { expect, test } from "@playwright/test";

test.describe("Spottex public smoke", () => {
  test("renders the landing page and consultation booking page", async ({ page }) => {
    const landing = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(landing?.ok()).toBe(true);
    await expect(page).toHaveTitle(/Spottex/i);
    await expect(page.getByRole("heading", { level: 1, name: /Začněte opravdu šetřit/i })).toBeVisible();

    await page.goto("/rizeni", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: /Spočítejte úsporu dřív/i })).toBeVisible();
    await expect(page.locator(".pricing-card")).toHaveCount(3);
    await expect(page.locator(".pricing-pct")).toHaveText(["30 dní", "15 %", "12,5 %"]);
    await expect(page.getByText("maximálně 99 Kč / měsíc", { exact: true })).toBeVisible();
    await expect(page.getByText("maximálně 999 Kč / rok", { exact: true })).toBeVisible();
    await expect(page.locator(".product-hero + .consultation-preview")).toBeVisible();

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("AlmaGate, s.r.o.", { exact: true })).toBeVisible();
    await expect(page.getByText("JUBELA, s.r.o.", { exact: true })).toBeVisible();
    await expect(page.getByText("Universal Technologies s.r.o.", { exact: true })).toBeVisible();
    await expect(page.getByText("Ing. Anna Zderadičková", { exact: true })).toBeVisible();
    await expect(page.getByText("Ing. Jiří Šrámek", { exact: true })).toBeVisible();
    await expect(page.getByText("AQUA SPP – energetická studie", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Michal Polic", { exact: true })).toHaveCount(0);
    await expect(page.locator(".consultation-preview")).toHaveCount(0);
    await expect(page.locator("footer").getByRole("link", { name: "Vytvořit účet", exact: true })).toHaveCount(0);
    await expect(page.locator("footer").getByRole("link", { name: "Reklamační řád", exact: true })).toHaveCount(0);
    const founderPadding = await page.locator(".public-content-section--founders").evaluate((element) =>
      Number.parseFloat(window.getComputedStyle(element).paddingBottom),
    );
    expect(founderPadding).toBeGreaterThanOrEqual(120);

    await page.goto("/aplikace", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/rizeni$/);
    await page.goto("/o-nas", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/ochrana-osobnich-udaju", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Zásady zpracování osobních údajů" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "SolaX Cloud a energetická data" })).toBeVisible();

    await page.goto("/obchodni-podminky", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Obchodní podmínky" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Práva z vad a reklamace" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reklamace", exact: true })).toHaveCount(0);

    await page.goto("/reklamacni-rad", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/obchodni-podminky#vady$/);

    const consultations = await page.goto("/konzultace", { waitUntil: "domcontentloaded" });
    expect(consultations?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: /Probereme potenciál vaší elektrárny/i })).toBeVisible();
  });

  test("renders Czech sign-in and registration forms", async ({ page }) => {
    await page.goto("/prihlaseni", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Přihlášení" })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Heslo", { exact: true })).toBeVisible();

    await page.goto("/registrace", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Vytvořit účet" })).toBeVisible();
    await expect(page.getByLabel("Jméno a příjmení")).toBeVisible();
    await expect(page.getByLabel("Heslo znovu")).toBeVisible();
  });

  test("redirects anonymous users from protected user and admin routes", async ({ page }) => {
    await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/prihlaseni\?callbackUrl=%2Fapp%2Fdashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Přihlášení" })).toBeVisible();

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/prihlaseni\?callbackUrl=%2Fadmin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Přihlášení" })).toBeVisible();
  });
});
