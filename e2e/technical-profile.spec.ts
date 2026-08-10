import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const suffix = randomUUID();
const email = `technical-profile-${suffix}@example.test`;
const foreignEmail = `technical-profile-foreign-${suffix}@example.test`;
const password = "Spottex-Technical-2026!";
let userId: number | null = null;
let siteId: number | null = null;
let foreignUserId: number | null = null;
let foreignSiteId: number | null = null;
let foreignPvArrayId: number | null = null;
let foreignApplianceId: number | null = null;
let legacySiteId: number | null = null;
let consentSessionId: string | null = null;

test.describe.serial("Spottex technical profile", () => {
  test.beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const [user, foreignUser] = await prisma.$transaction([
      prisma.user.create({ data: { email, passwordHash, name: "Majitel testovací FVE", status: "ACTIVE", emailVerifiedAt: new Date() } }),
      prisma.user.create({ data: { email: foreignEmail, passwordHash, name: "Cizí uživatel", status: "ACTIVE", emailVerifiedAt: new Date() } }),
    ]);
    userId = user.id;
    foreignUserId = foreignUser.id;
    const [site, foreignSite, legacySite] = await prisma.$transaction([
      prisma.energySite.create({ data: { userId: user.id, provider: "DEMO", externalSiteId: `technical-${suffix}`, name: "Testovací elektrárna", status: "ONLINE", metadata: { pvCapacityKwp: 9.9, batteryCapacityKwh: 11.6 } } }),
      prisma.energySite.create({ data: { userId: foreignUser.id, provider: "DEMO", externalSiteId: `technical-foreign-${suffix}`, name: "Cizí elektrárna", status: "ONLINE" } }),
      prisma.energySite.create({ data: { userId: user.id, provider: "LEGACY_SPOTTEX", externalSiteId: `technical-history-${suffix}`, name: "Historická FVE", status: "ONLINE" } }),
    ]);
    siteId = site.id;
    foreignSiteId = foreignSite.id;
    legacySiteId = legacySite.id;
    await prisma.inverter.create({ data: { energySiteId: legacySite.id, provider: "LEGACY_SPOTTEX", externalDeviceId: `history-inverter-${suffix}`, status: "ONLINE" } });
    const [foreignPvArray, foreignAppliance] = await prisma.$transaction([
      prisma.energyPvArray.create({ data: { energySiteId: foreignSite.id, name: "Cizí pole", nominalDcCapacityKwp: 5 } }),
      prisma.controlledAppliance.create({ data: { energySiteId: foreignSite.id, name: "Cizí bojler", type: "WATER_HEATER" } }),
    ]);
    foreignPvArrayId = foreignPvArray.id;
    foreignApplianceId = foreignAppliance.id;
  });

  test.afterAll(async () => {
    if (consentSessionId) await prisma.consentRecord.deleteMany({ where: { sessionId: consentSessionId } });
    if (legacySiteId) {
      const chunks = await prisma.energyHistoryImportChunk.findMany({ where: { historyImport: { energySiteId: legacySiteId } }, select: { id: true } });
      await prisma.scheduledJob.deleteMany({ where: { idempotencyKey: { in: chunks.map((chunk) => `energy-history:${chunk.id}`) } } });
      await prisma.energySite.deleteMany({ where: { id: legacySiteId } });
    }
    if (siteId) await prisma.energySite.deleteMany({ where: { id: siteId } });
    if (foreignSiteId) await prisma.energySite.deleteMany({ where: { id: foreignSiteId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (foreignUserId) await prisma.user.deleteMany({ where: { id: foreignUserId } });
    await prisma.$disconnect();
  });

  test("shows provenance, saves safety limits and securely accepts an invoice", async ({ page }) => {
    await page.goto("/prihlaseni?callbackUrl=/app/elektrarna");
    const consent = page.getByRole("button", { name: "Pouze nezbytné" });
    if (await consent.isVisible()) {
      await consent.click();
      consentSessionId = await page.evaluate(() => window.sessionStorage.getItem("spottex_analytics_session"));
    }
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname === "/app/elektrarna", { timeout: 20_000 });

    await expect(page.getByRole("heading", { level: 1, name: "Moje elektrárna" })).toBeVisible();
    await expect(page.getByText("Zdroj: modelový předpoklad").first()).toBeVisible();
    await page.getByLabel("Distributor").fill("CEZ_DISTRIBUCE");
    await page.getByLabel("Distribuční sazba").fill("D25d");
    await page.getByLabel("Počet fází").fill("3");
    await page.getByLabel("Hlavní jistič").fill("25");
    await page.getByLabel("Maximální odběr ze sítě").fill("17.25");
    await page.getByLabel("Maximální přetok").fill("9.9");
    await page.getByLabel("Přetoky do sítě").selectOption("true");
    await page.getByLabel("Maximální nabíjecí výkon").fill("6.9");
    await page.getByLabel("Maximální vybíjecí výkon").fill("6.9");
    await page.getByLabel("Minimální SoC").fill("15");
    await page.getByLabel("Maximální SoC").fill("100");
    await page.getByRole("button", { name: "Přidat pole" }).click();
    const pvSection = page.locator("section", { hasText: "Pole fotovoltaických panelů" });
    await pvSection.getByLabel("Název").fill("Jižní pole");
    await pvSection.getByLabel("Počet panelů").fill("22");
    await pvSection.getByLabel("Výkon panelu").fill("450");
    await pvSection.getByLabel("Nominální výkon pole").fill("9.9");
    await page.getByRole("button", { name: "Přidat spotřebič" }).click();
    const applianceSection = page.locator("section", { hasText: "Spotřebiče do budoucího řízení" });
    await applianceSection.getByLabel("Název").fill("Bojler");
    await applianceSection.getByLabel("Typ").selectOption("WATER_HEATER");
    await applianceSection.getByLabel("Příkon").fill("2.2");
    await applianceSection.getByLabel("Minimální běh").fill("30");
    await applianceSection.getByLabel("Maximální běh").fill("180");
    await applianceSection.getByLabel("Technicky by mohl být řiditelný").check();
    await page.getByRole("button", { name: "Uložit", exact: true }).click();
    await expect(page.getByText("Technické údaje byly uložené.")).toBeVisible();
    await expect(page.locator("article", { hasText: "Bezpečné řízení" }).getByText("Připraveno")).toBeVisible();

    await page.getByRole("button", { name: "Potvrdit pro řízení" }).click();
    await expect(page.getByText("Údaje pro řízení byly potvrzené.")).toBeVisible();
    await expect.poll(async () => ({
      pvArrays: await prisma.energyPvArray.count({ where: { energySiteId: siteId!, name: "Jižní pole", panelCount: 22 } }),
      appliances: await prisma.controlledAppliance.count({ where: { energySiteId: siteId!, name: "Bojler", type: "WATER_HEATER", controllable: true } }),
    })).toEqual({ pvArrays: 1, appliances: 1 });
    await page.getByRole("button", { name: "Připravit e-mail" }).click();
    const mailLink = page.getByRole("link", { name: "Odeslat e-mailem" });
    await expect(mailLink).toBeVisible();
    await expect(mailLink).toHaveAttribute("href", /mailto:contact%40spottex\.cz|mailto:contact@spottex\.cz/);
    const invoiceBytes = Buffer.from("%PDF-1.7\nplaywright invoice fixture\n%%EOF");
    await page.getByLabel("Nahrát fakturu").setInputFiles({ name: "faktura-test.pdf", mimeType: "application/pdf", buffer: invoiceBytes });
    await expect(page.getByText("Faktura byla zašifrovaně uložená a čeká na ruční kontrolu.")).toBeVisible();
    const invoiceDocument = await prisma.energyInvoiceDocument.findFirstOrThrow({ where: { invoiceRequest: { energySiteId: siteId! } } });
    expect(invoiceDocument.encryptedContent).not.toBeNull();
    const download = await page.request.get(`/api/app/energy/invoice-documents/${invoiceDocument.id}`);
    expect(download.status()).toBe(200);
    expect(Buffer.from(await download.body()).equals(invoiceBytes)).toBe(true);
    await page.getByLabel("Nahrát fakturu").setInputFiles({ name: "faktura-kopie.pdf", mimeType: "application/pdf", buffer: invoiceBytes });
    await expect(page.getByText("Tuto fakturu už u elektrárny evidujeme.")).toBeVisible();
    const response = await page.request.get(`/api/app/energy/sites/${foreignSiteId}/profile`);
    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "SITE_NOT_FOUND" });

    const forgedArrayResponse = await page.request.patch(`/api/app/energy/sites/${siteId}/profile`, {
      data: { pvArrays: [{ id: foreignPvArrayId, name: "Cizí pole", panelCount: null, panelRatedWp: null, nominalDcCapacityKwp: 5, active: true }] },
    });
    expect(forgedArrayResponse.status()).toBe(422);
    const forgedApplianceResponse = await page.request.patch(`/api/app/energy/sites/${siteId}/profile`, {
      data: { controlledAppliances: [{ id: foreignApplianceId, name: "Cizí bojler", type: "WATER_HEATER", status: "DECLARED", ratedPowerKw: null, controllable: false, minRuntimeMinutes: null, maxRuntimeMinutes: null }] },
    });
    expect(forgedApplianceResponse.status()).toBe(422);

    const importResponse = await page.request.post(`/api/app/energy/sites/${legacySiteId}/history-import`, { data: { days: 7 } });
    expect(importResponse.status()).toBe(202);
    await expect(importResponse.json()).resolves.toMatchObject({ historyImport: { status: "QUEUED", totalChunks: 14 } });
  });
});
