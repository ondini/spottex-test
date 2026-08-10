import { createHash, randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const email = `registration-${randomUUID()}@example.test`;
const password = "Spottex-Registration-2026!";
let userId: number | null = null;
let consentSessionId: string | null = null;

function rateLimitKey(scope: string, identity: string | number = "*") {
  const raw = `${scope}:direct-client:${String(identity).toLowerCase()}`;
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET || "local"}:${raw}`)
    .digest("hex");
}

test.describe.serial("registration and consent persistence", () => {
  test.afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    userId = user?.id ?? userId;
    if (userId) await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
    await prisma.user.deleteMany({ where: { email } });
    if (consentSessionId) await prisma.consentRecord.deleteMany({ where: { sessionId: consentSessionId } });
    await prisma.rateLimitBucket.deleteMany({
      where: {
        key: {
          in: [
            rateLimitKey("auth-register-address"),
            rateLimitKey("auth-register-account", email),
          ],
        },
      },
    });
    await prisma.$disconnect();
  });

  test("stores the cookie choice and registers through the unobstructed form", async ({ page }) => {
    await page.goto("/registrace");
    const consent = page.getByTestId("consent-banner");
    await expect(consent).toBeVisible();
    const dialogBox = await page.getByRole("dialog", { name: "Pomozte nám vyladit Spottex pro vás" }).boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.width).toBeLessThanOrEqual(570);
    expect(Math.abs((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2 - 640)).toBeLessThan(3);
    await page.getByRole("button", { name: "Pouze nezbytné" }).click();
    await expect(consent).toBeHidden();
    consentSessionId = await page.evaluate(() => window.sessionStorage.getItem("spottex_analytics_session"));

    await page.reload();
    await expect(page.getByTestId("consent-banner")).toBeHidden();
    const consentCookie = (await page.context().cookies()).find((cookie) => cookie.name === "spottex_consent");
    expect(consentCookie?.value).toBeTruthy();

    await page.goto("/");
    await expect(page.getByTestId("consent-banner")).toBeHidden();
    await page.getByRole("button", { name: "Nastavení cookies" }).click();
    await expect(page.getByRole("dialog", { name: "Pomozte nám vyladit Spottex pro vás" })).toBeVisible();
    await page.getByRole("button", { name: "Zavřít nastavení soukromí" }).click();
    await expect(page.getByTestId("consent-banner")).toBeHidden();

    await page.goto("/registrace");
    await page.getByLabel("Jméno a příjmení").fill("Test registrace");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByLabel("Heslo znovu").fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Zaregistrovat se" }).click();
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Přehled" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("spottex_has_account"))).toBe("1");

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true, emailVerifiedAt: true } });
    userId = user?.id ?? null;
    expect(user).toMatchObject({ status: "ACTIVE" });
    expect(user?.emailVerifiedAt).toBeTruthy();
  });
});
