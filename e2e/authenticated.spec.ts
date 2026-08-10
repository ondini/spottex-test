import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadEnvConfig } from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);
const runId = `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
const password = "Spottex-E2E-2026!";
const fixtureEmails = {
  user: `${runId}-user@example.test`,
  trial: `${runId}-trial@example.test`,
  paying: `${runId}-paying@example.test`,
  admin: `${runId}-admin@example.test`,
  promo: `${runId}-promo@example.test`,
  verify: `${runId}-verify@example.test`,
  guest: `${runId}-guest@example.test`,
};
const accountVerifyToken = `account-${randomUUID()}-${randomUUID()}`;
const developmentEncryptionKey = readFileSync(resolve(process.cwd(), "Secrets/spottex.development.env"), "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("APP_ENCRYPTION_KEY="))
  ?.slice("APP_ENCRYPTION_KEY=".length);

type Fixtures = {
  userId: number;
  trialUserId: number;
  payingUserId: number;
  adminId: number;
  promoUserId: number;
  pendingUserId: number;
  productId: number;
  consultationSlotId: number;
  consultationStart: Date;
  payingOfferId: string;
};

type MailpitAddress = { Address?: string };
type MailpitSummary = {
  ID?: string;
  Subject?: string;
  To?: MailpitAddress[];
};
type MailpitDetail = MailpitSummary & {
  Text?: string;
  HTML?: string;
};

let fixtures: Fixtures | null = null;
const mailpitMessageIds = new Set<string>();
const analyticsSessionIds = new Set<string>();

function rateLimitKey(scope: string, identity: string | number = "*") {
  const raw = `${scope}:direct-client:${String(identity).toLowerCase()}`;
  return createHash("sha256")
    .update(`${process.env.AUTH_SECRET || "local"}:${raw}`)
    .digest("hex");
}

async function acceptEssentialConsentIfVisible(page: Page) {
  await page.waitForLoadState("networkidle");
  const button = page.getByRole("button", { name: "Pouze nezbytné" });
  if (!(await button.isVisible())) return;
  await button.click();
  await expect(button).toBeHidden();
  const sessionId = await page.evaluate(() => window.sessionStorage.getItem("spottex_analytics_session"));
  if (sessionId) analyticsSessionIds.add(sessionId);
}

async function login(page: Page, email: string, destination: string) {
  await page.goto(`/prihlaseni?callbackUrl=${encodeURIComponent(destination)}`);
  await acceptEssentialConsentIfVisible(page);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await page.waitForURL((url) => url.pathname === destination, { timeout: 20_000 });
  await acceptEssentialConsentIfVisible(page);
}

async function deliverOutboxMessage(idempotencyKey: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const message = await prisma.emailOutbox.findUnique({
      where: { idempotencyKey },
      select: { status: true },
    });
    if (message?.status === "SUCCEEDED") return;
    expect(message, `Expected queued e-mail ${idempotencyKey}`).not.toBeNull();

    await execFileAsync(
      resolve(process.cwd(), "node_modules/.bin/tsx"),
      ["--env-file=.env", "e2e/process-outbox.ts"],
      { cwd: process.cwd(), timeout: 20_000, env: { ...process.env, ...(developmentEncryptionKey ? { APP_ENCRYPTION_KEY: developmentEncryptionKey } : {}) } },
    );
  }

  const finalMessage = await prisma.emailOutbox.findUnique({
    where: { idempotencyKey },
    select: { status: true },
  });
  expect(finalMessage?.status).toBe("SUCCEEDED");
}

async function findMailpitMessage(email: string, subject: string) {
  let summary: MailpitSummary | undefined;
  await expect.poll(async () => {
    const response = await fetch("http://127.0.0.1:8026/api/v1/messages");
    if (!response.ok) return false;
    const payload = await response.json() as { messages?: MailpitSummary[] };
    summary = payload.messages?.find((message) =>
      message.Subject === subject
      && message.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
    );
    return Boolean(summary?.ID);
  }, {
    message: `Expected Mailpit message '${subject}' for the isolated test recipient`,
    timeout: 10_000,
    intervals: [100, 250, 500],
  }).toBe(true);

  const id = summary?.ID;
  if (!id) throw new Error("Mailpit returned a message without an ID");
  mailpitMessageIds.add(id);
  const response = await fetch(`http://127.0.0.1:8026/api/v1/message/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("Mailpit message detail could not be loaded");
  return await response.json() as MailpitDetail;
}

function linkFromMail(message: MailpitDetail, path: string) {
  const body = [message.Text, message.HTML, JSON.stringify(message)].filter(Boolean).join("\n");
  const urls = body.match(/https?:\/\/[^\s"'<>\\]+/g) ?? [];
  const link = urls
    .map((value) => value.replaceAll("&amp;", "&").replace(/[),.;]+$/, ""))
    .find((value) => value.includes(path));
  if (!link) throw new Error(`Expected ${path} link in Mailpit message`);
  return new URL(link);
}

test.describe.serial("Spottex authenticated and booking journeys", () => {
  test.beforeAll(async () => {
    const product = await prisma.product.findUnique({ where: { code: "INVERTER_CONTROL" } });
    if (!product) throw new Error("Seeded INVERTER_CONTROL product is required for authenticated E2E tests");

    const passwordHash = await bcrypt.hash(password, 12);
    const [user, trialUser, payingUser, admin, promoUser, pendingUser] = await prisma.$transaction([
      prisma.user.create({
        data: {
          email: fixtureEmails.user,
          passwordHash,
          name: "E2E Majitel elektrárny",
          role: "USER",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          email: fixtureEmails.trial,
          passwordHash,
          name: "E2E Trial uživatel",
          role: "USER",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          email: fixtureEmails.paying,
          passwordHash,
          name: "E2E Platící uživatel",
          role: "USER",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          email: fixtureEmails.admin,
          passwordHash,
          name: "E2E Administrátor",
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          email: fixtureEmails.promo,
          passwordHash,
          name: "E2E PROMO uživatel",
          role: "USER",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          email: fixtureEmails.verify,
          passwordHash,
          name: "E2E Neověřený uživatel",
          role: "USER",
          status: "PENDING_VERIFICATION",
        },
      }),
    ]);

    const now = new Date();
    const site = await prisma.energySite.create({
      data: {
        userId: user.id,
        provider: "DEMO",
        externalSiteId: `${runId}-site`,
        name: `E2E elektrárna ${runId.slice(-8)}`,
        status: "ONLINE",
        optimizationOn: true,
        requiredInfo: false,
        lastSyncedAt: now,
        metadata: {
          demo: true,
          batteryCapacityKwh: 12.4,
          cachedSavings: { todayCzk: 91, weekCzk: 640, monthCzk: 2510, yearCzk: 18020 },
        },
      },
    });
    const payingSite = await prisma.energySite.create({
      data: {
        userId: payingUser.id,
        provider: "DEMO",
        externalSiteId: `${runId}-paying-site`,
        name: "E2E elektrárna s nabídkou",
        status: "ONLINE",
        metadata: { demo: true },
      },
    });
    const payingAnalysis = await prisma.energyAnalysisRun.create({
      data: {
        userId: payingUser.id,
        energySiteId: payingSite.id,
        status: "COMPLETED",
        kind: "BASE",
        engineVersion: "E2E",
        methodologyVersion: "E2E",
        inputFingerprint: `${runId}-paying-analysis`,
        completedAt: now,
      },
    });
    const payingOffer = await prisma.serviceOffer.create({
      data: {
        userId: payingUser.id,
        energySiteId: payingSite.id,
        analysisRunId: payingAnalysis.id,
        status: "OFFERED",
        expectedControlSavingsMinor: 400_000,
        listPriceMinor: 99_000,
        discountMinor: 0,
        finalPriceMinor: 99_000,
        methodologyVersion: "E2E",
        inputFingerprint: `${runId}-paying-offer`,
        validUntil: new Date(now.getTime() + 30 * 86_400_000),
      },
    });
    const inverter = await prisma.inverter.create({
      data: {
        energySiteId: site.id,
        provider: "DEMO",
        externalDeviceId: `${runId}-inverter`,
        name: "E2E virtuální střídač",
        status: "ONLINE",
        lastSeenAt: now,
      },
    });
    await prisma.$transaction([
      prisma.energyMeasurement.create({
        data: {
          inverterId: inverter.id,
          measuredAt: now,
          productionKw: 4.2,
          consumptionKw: 1.3,
          gridKw: -1.8,
          batteryKw: 1.1,
          batterySocPct: 72,
          buyPriceCzk: 2.91,
          sellPriceCzk: 2.14,
          raw: { source: "E2E" },
        },
      }),
      prisma.subscription.create({
        data: {
          userId: user.id,
          productId: product.id,
          status: "ACTIVE",
          source: "PROMO",
          startsAt: now,
          endsAt: new Date(now.getTime() + 30 * 86_400_000),
          activatedByAdminId: admin.id,
          activationReason: "Izolovaná E2E fixture",
        },
      }),
      prisma.subscription.create({
        data: {
          userId: payingUser.id,
          productId: product.id,
          status: "EXPIRED",
          source: "MANUAL",
          startsAt: new Date(now.getTime() - 400 * 86_400_000),
          endsAt: new Date(now.getTime() - 35 * 86_400_000),
        },
      }),
    ]);

    const consultationStart = new Date(now.getTime() + 7 * 86_400_000);
    consultationStart.setUTCMinutes(0, 0, 0);
    const slot = await prisma.consultationSlot.create({
      data: {
        hostUserId: admin.id,
        startUtc: consultationStart,
        endUtc: new Date(consultationStart.getTime() + 30 * 60_000),
        status: "OPEN",
        metadata: { e2eRunId: runId },
      },
    });
    await prisma.emailVerification.create({
      data: {
        userId: pendingUser.id,
        tokenHash: createHash("sha256").update(accountVerifyToken).digest("hex"),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      },
    });

    fixtures = {
      userId: user.id,
      trialUserId: trialUser.id,
      payingUserId: payingUser.id,
      adminId: admin.id,
      promoUserId: promoUser.id,
      pendingUserId: pendingUser.id,
      productId: product.id,
      consultationSlotId: slot.id,
      consultationStart,
      payingOfferId: payingOffer.id,
    };
  });

  test.afterAll(async () => {
    const ids = fixtures
      ? [fixtures.userId, fixtures.trialUserId, fixtures.payingUserId, fixtures.adminId, fixtures.promoUserId, fixtures.pendingUserId]
      : [];

    await prisma.$transaction(async (tx) => {
      const consultationBookings = await tx.consultationBooking.findMany({
        where: { guestEmail: fixtureEmails.guest },
        select: { id: true },
      });
      if (consultationBookings.length) {
        await tx.scheduledJob.deleteMany({
          where: {
            OR: consultationBookings.flatMap(({ id }) => [
              { idempotencyKey: { startsWith: `consultation-calendar:create:${id}:` } },
              { idempotencyKey: { startsWith: `consultation-calendar:delete:${id}:` } },
            ]),
          },
        });
      }
      await tx.consultationBooking.deleteMany({ where: { guestEmail: fixtureEmails.guest } });
      if (fixtures) {
        await tx.consultationSlot.deleteMany({ where: { id: fixtures.consultationSlotId } });
      }
      await tx.emailOutbox.deleteMany({
        where: {
          OR: [
            { toEmail: { in: Object.values(fixtureEmails) } },
            { idempotencyKey: { startsWith: `e2e:${runId}:` } },
          ],
        },
      });
      if (analyticsSessionIds.size) {
        await tx.consentRecord.deleteMany({ where: { sessionId: { in: [...analyticsSessionIds] } } });
        await tx.analyticsEvent.deleteMany({ where: { sessionId: { in: [...analyticsSessionIds] } } });
      }
      const rateLimitKeys = [
        rateLimitKey("auth-login-address"),
        rateLimitKey("analytics-consent-address"),
        rateLimitKey("consultation-availability"),
        rateLimitKey("consultation-book-address"),
        rateLimitKey("consultation-manage"),
        rateLimitKey("consultation-cancel"),
        ...Object.values(fixtureEmails).map((email) => rateLimitKey("auth-login-account", email)),
        rateLimitKey("consultation-book-email", fixtureEmails.guest),
        ...(fixtures ? [rateLimitKey("consultation-book-slot", fixtures.consultationSlotId)] : []),
        ...[...analyticsSessionIds].map((sessionId) => rateLimitKey("analytics-consent-session", sessionId)),
      ];
      await tx.rateLimitBucket.deleteMany({ where: { key: { in: rateLimitKeys } } });
      if (ids.length) {
        await tx.invoice.deleteMany({ where: { userId: { in: ids } } });
        await tx.subscription.deleteMany({
          where: { OR: [{ userId: { in: ids } }, { activatedByAdminId: { in: ids } }] },
        });
        await tx.payment.deleteMany({ where: { userId: { in: ids } } });
        await tx.cart.deleteMany({ where: { userId: { in: ids } } });
        await tx.analyticsEvent.deleteMany({ where: { userId: { in: ids } } });
        await tx.consentRecord.deleteMany({ where: { userId: { in: ids } } });
        await tx.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      } else {
        await tx.user.deleteMany({ where: { email: { in: Object.values(fixtureEmails) } } });
      }
    });

    const mailpit = await fetch("http://127.0.0.1:8026/api/v1/messages").then((response) =>
      response.ok ? response.json() as Promise<{ messages?: MailpitSummary[] }> : null,
    ).catch(() => null);
    for (const message of mailpit?.messages ?? []) {
      if (
        message.ID
        && message.To?.some((recipient) => Object.values(fixtureEmails).includes(recipient.Address || ""))
      ) mailpitMessageIds.add(message.ID);
    }
    if (mailpitMessageIds.size) {
      await fetch("http://127.0.0.1:8026/api/v1/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: [...mailpitMessageIds] }),
      }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  test("account verification requires an explicit same-origin POST", async ({ page }) => {
    if (!fixtures) throw new Error("E2E fixtures were not initialized");
    const endpoint = `/api/auth/verify-email?token=${encodeURIComponent(accountVerifyToken)}`;

    const blocked = await page.request.post("/api/auth/verify-email", {
      form: { token: accountVerifyToken },
      headers: { Origin: "https://scanner.invalid" },
      maxRedirects: 0,
    });
    expect(blocked.status()).toBe(403);

    await page.goto(endpoint);
    await expect(page).toHaveURL(/\/overit-email\?token=/);
    await expect(page.getByRole("heading", { name: "Potvrďte aktivaci účtu" })).toBeVisible();
    await acceptEssentialConsentIfVisible(page);

    const beforeConfirmation = await prisma.user.findUniqueOrThrow({
      where: { id: fixtures.pendingUserId },
      include: { emailVerifications: true },
    });
    expect(beforeConfirmation).toMatchObject({ status: "PENDING_VERIFICATION", emailVerifiedAt: null });
    expect(beforeConfirmation.emailVerifications[0]?.consumedAt).toBeNull();

    await page.getByRole("button", { name: "Ověřit e-mail a aktivovat účet" }).click();
    await page.waitForURL((url) => url.pathname === "/prihlaseni" && url.searchParams.get("overeno") === "1");
    await expect(page.getByRole("status")).toContainText("E-mail je ověřený");

    const afterConfirmation = await prisma.user.findUniqueOrThrow({
      where: { id: fixtures.pendingUserId },
      include: { emailVerifications: true },
    });
    expect(afterConfirmation.status).toBe("ACTIVE");
    expect(afterConfirmation.emailVerifiedAt).toBeInstanceOf(Date);
    expect(afterConfirmation.emailVerifications[0]?.consumedAt).toBeInstanceOf(Date);
  });

  test("user signs in and sees isolated plant data on the dashboard", async ({ page }) => {
    if (!fixtures) throw new Error("E2E fixtures were not initialized");
    await login(page, fixtureEmails.user, "/app/dashboard");

    await expect(page.getByRole("heading", { name: "Energetický přehled" })).toBeVisible();
    await expect(page.getByRole("heading", { name: `E2E elektrárna ${runId.slice(-8)}` })).toBeVisible();
    await expect(page.getByText("4,2 kW")).toBeVisible();
    await expect(page.getByText("1,3 kW")).toBeVisible();
    await expect(page.getByText("DEMO", { exact: true })).toBeVisible();

    const session = await page.request.get("/api/auth/session");
    expect(session.ok()).toBe(true);
    expect(await session.json()).toMatchObject({
      user: { id: String(fixtures.userId), role: "USER", email: fixtureEmails.user },
    });
  });

  test("new user completes the free trial order and sees it in the consolidated service page", async ({ page }) => {
    if (!fixtures) throw new Error("E2E fixtures were not initialized");
    await login(page, fixtureEmails.trial, "/app/sluzba/objednavka");

    await expect(page.getByRole("heading", { level: 2, name: "Objednávka služby", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Přidat" }).click();
    await expect(page.getByText("Chytré řízení střídače", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Aktivovat zkušební období" }).click();

    await page.waitForURL((url) => url.pathname === "/platba/navrat", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Bezplatné období je aktivní" })).toBeVisible();
    await page.getByRole("link", { name: "Zobrazit službu a doklady" }).click();
    await expect(page).toHaveURL(/\/app\/sluzba$/);
    await expect(page.getByText("Zkušební", { exact: true })).toBeVisible();
    await expect(page.getByText("Řízení je aktivní.")).toBeVisible();

    const payment = await prisma.payment.findFirst({
      where: { userId: fixtures.trialUserId },
      orderBy: { createdAt: "desc" },
    });
    const [subscription, paidCart] = await Promise.all([
      prisma.subscription.findFirst({ where: { userId: fixtures.trialUserId, productId: fixtures.productId } }),
      payment?.cartId ? prisma.cart.findUnique({ where: { id: payment.cartId } }) : null,
    ]);
    expect(payment).toMatchObject({ status: "PAID", provider: "MANUAL", amountMinor: 0 });
    expect(subscription).toMatchObject({ status: "TRIAL", source: "MANUAL" });
    expect(subscription?.endsAt?.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(subscription?.endsAt?.getTime()).toBeLessThan(Date.now() + 31 * 86_400_000);
    expect(paidCart?.status).toBe("PAID");
    await expect(prisma.emailOutbox.count({ where: { idempotencyKey: `payment:${payment?.id}:confirmation` } })).resolves.toBe(1);
  });

  test("paid annual order stores billing data, explicit recurring consent, invoice and confirmation", async ({ page }) => {
    if (!fixtures) throw new Error("E2E fixtures were not initialized");
    await login(page, fixtureEmails.paying, "/app/sluzba");
    await expect(page.getByText("Chytré řízení za 990 Kč ročně")).toBeVisible();
    await page.getByRole("button", { name: "Objednat za vypočtenou cenu" }).click();
    await page.waitForURL((url) => url.pathname === "/app/sluzba/objednavka");
    await page.getByLabel("Ulice a číslo").fill("Testovací 12");
    await page.getByLabel("Město").fill("Praha");
    await page.getByLabel("PSČ").fill("11000");
    await page.getByRole("checkbox", { name: /Povolit roční opakovanou platbu/ }).check();
    await page.getByRole("button", { name: "Pokračovat k platbě" }).click();
    await page.waitForURL((url) => url.pathname === "/platba/mock", { timeout: 20_000 });
    await page.getByRole("button", { name: "Simulovat úspěšnou platbu" }).click();
    await page.waitForURL((url) => url.pathname === "/platba/navrat", { timeout: 20_000 });
    await page.getByRole("link", { name: "Zobrazit službu a doklady" }).click();
    await expect(page.getByRole("heading", { name: "Roční automatické obnovení" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daňové doklady" })).toBeVisible();

    const payment = await prisma.payment.findFirstOrThrow({ where: { userId: fixtures.payingUserId, status: "PAID" }, orderBy: { createdAt: "desc" } });
    const [invoice, mandate, profile, confirmation] = await Promise.all([
      prisma.invoice.findFirst({ where: { paymentId: payment.id } }),
      prisma.recurringPaymentMandate.findFirst({ where: { userId: fixtures.payingUserId, status: "ACTIVE" } }),
      prisma.user.findUniqueOrThrow({ where: { id: fixtures.payingUserId } }),
      prisma.emailOutbox.findUnique({ where: { idempotencyKey: `payment:${payment.id}:confirmation` } }),
    ]);
    expect(payment.amountMinor).toBeGreaterThan(0);
    expect(invoice).not.toBeNull();
    expect(mandate).toMatchObject({ provider: "MOCK", status: "ACTIVE", noticeDays: 14 });
    await expect(prisma.serviceOffer.findUniqueOrThrow({ where: { id: fixtures.payingOfferId } })).resolves.toMatchObject({ status: "ACCEPTED" });
    expect(profile).toMatchObject({ street: "Testovací 12", city: "Praha", postalCode: "11000" });
    expect(confirmation).not.toBeNull();
  });

  test("consolidated service journey remains usable on mobile and preserves legacy links", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, fixtureEmails.trial, "/app/sluzba");
    await expect(page.getByRole("heading", { level: 1, name: "Služba a vyúčtování" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stav služby" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roční automatické obnovení" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto("/app/platby");
    await expect(page).toHaveURL(/\/app\/sluzba#platby$/);
    await expect(page.getByRole("heading", { name: "Platby", exact: true })).toBeVisible();
    await page.goto("/app/kosik");
    await expect(page).toHaveURL(/\/app\/sluzba\/objednavka$/);
    await expect(page.getByRole("heading", { name: "Objednávka služby", exact: true })).toBeVisible();
  });

  test("admin signs in and activates a configurable PROMO subscription", async ({ page }) => {
    if (!fixtures) throw new Error("E2E fixtures were not initialized");
    await login(page, fixtureEmails.admin, "/admin");
    await expect(page.getByRole("heading", { name: "Přehled administrace" })).toBeVisible();

    await page.goto(`/admin/uzivatele?q=${encodeURIComponent(fixtureEmails.promo)}`);
    const row = page.getByRole("row").filter({ hasText: fixtureEmails.promo });
    await expect(row).toBeVisible();
    await row.getByLabel("Počet dnů PROMO").fill("45");
    await row.getByLabel("Důvod PROMO").fill("E2E ověření administrátorské aktivace");
    await row.getByRole("button", { name: "Aktivovat PROMO na 45 dní" }).click();
    await expect(row.getByText("PROMO aktivováno", { exact: true })).toBeVisible();

    const subscription = await prisma.subscription.findFirst({
      where: { userId: fixtures.promoUserId, productId: fixtures.productId },
      orderBy: { createdAt: "desc" },
    });
    expect(subscription).toMatchObject({
      status: "TRIAL",
      source: "PROMO",
      activatedByAdminId: fixtures.adminId,
      activationReason: "E2E ověření administrátorské aktivace",
    });
    expect(subscription?.endsAt?.getTime()).toBeGreaterThan(Date.now() + 44 * 86_400_000);
  });

  test("guest books, verifies by delivered e-mail, manages and cancels a consultation", async ({ page }) => {
    test.setTimeout(60_000);
    if (!fixtures) throw new Error("E2E fixtures were not initialized");
    await page.goto(`/konzultace?slot=${fixtures.consultationSlotId}`);
    await acceptEssentialConsentIfVisible(page);
    await expect(page.getByText("Zvolený termín se zobrazí zde.")).toBeHidden({ timeout: 15_000 });
    await page.getByLabel("Jméno a příjmení").fill("E2E Zájemce");
    await page.getByLabel("E-mail").fill(fixtureEmails.guest);
    await page.getByLabel("Telefon").fill("+420 777 123 456");
    await page.getByLabel("Co chcete probrat?").fill("End-to-end ověření rezervačního procesu.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Nezávazně rezervovat termín" }).click();
    await expect(page.getByRole("heading", { name: "Zkontrolujte svůj e-mail" })).toBeVisible({ timeout: 15_000 });

    const booking = await prisma.consultationBooking.findFirstOrThrow({
      where: { guestEmail: fixtureEmails.guest, slotId: fixtures.consultationSlotId },
    });
    expect(booking.status).toBe("PENDING");
    await deliverOutboxMessage(`consultation:${booking.id}:verify`);

    const verificationMail = await findMailpitMessage(
      fixtureEmails.guest,
      "Potvrďte rezervaci konzultace Spottex",
    );
    const verificationLink = linkFromMail(verificationMail, "/api/consultations/verify");

    const verifyToken = verificationLink.searchParams.get("token");
    if (!verifyToken) throw new Error("Consultation verification link is missing its token");
    const blocked = await page.request.post("/api/consultations/verify", {
      form: { token: verifyToken },
      headers: { Origin: "https://scanner.invalid" },
      maxRedirects: 0,
    });
    expect(blocked.status()).toBe(403);

    await page.goto(`${verificationLink.pathname}${verificationLink.search}`);
    await expect(page).toHaveURL(/\/konzultace\/potvrzeno\?token=/);
    await expect(page.getByRole("heading", { name: "Potvrďte rezervaci konzultace" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const [pendingBooking, heldSlot, calendarJobBefore] = await Promise.all([
      prisma.consultationBooking.findUniqueOrThrow({ where: { id: booking.id } }),
      prisma.consultationSlot.findUniqueOrThrow({ where: { id: fixtures.consultationSlotId } }),
      prisma.scheduledJob.findFirst({
        where: { idempotencyKey: { startsWith: `consultation-calendar:create:${booking.id}:` } },
      }),
    ]);
    expect(pendingBooking).toMatchObject({ status: "PENDING", emailVerifiedAt: null, calendarRevision: 0 });
    expect(heldSlot.status).toBe("HELD");
    expect(calendarJobBefore).toBeNull();

    await page.getByRole("button", { name: "Potvrdit rezervaci" }).click();
    await page.waitForURL((url) => url.pathname === "/konzultace/potvrzeno" && url.searchParams.get("booking") === String(booking.id));
    await expect(page.getByRole("heading", { name: "Rezervace je potvrzená" })).toBeVisible();

    const [confirmedBooking, bookedSlot, calendarJobAfter] = await Promise.all([
      prisma.consultationBooking.findUniqueOrThrow({ where: { id: booking.id } }),
      prisma.consultationSlot.findUniqueOrThrow({ where: { id: fixtures.consultationSlotId } }),
      prisma.scheduledJob.findFirst({
        where: { idempotencyKey: { startsWith: `consultation-calendar:create:${booking.id}:` } },
      }),
    ]);
    expect(confirmedBooking.status).toBe("CONFIRMED");
    expect(confirmedBooking.emailVerifiedAt).toBeInstanceOf(Date);
    expect(confirmedBooking.calendarRevision).toBe(1);
    expect(bookedSlot.status).toBe("BOOKED");
    expect(calendarJobAfter).not.toBeNull();

    await deliverOutboxMessage(`consultation:${booking.id}:confirmed:${fixtures.consultationStart.toISOString()}`);
    const confirmationMail = await findMailpitMessage(
      fixtureEmails.guest,
      "Konzultace Spottex je potvrzená",
    );
    const manageLink = linkFromMail(confirmationMail, "/konzultace/spravovat");
    await page.goto(`${manageLink.pathname}${manageLink.search}`);
    await expect(page.getByRole("heading", { name: "Správa konzultace" })).toBeVisible();
    await expect(page.getByText("Stav: potvrzená")).toBeVisible();
    await expect(page).toHaveURL(/\/konzultace\/spravovat$/);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Zrušit konzultaci" }).click();
    await expect(page.getByText("Rezervace byla zrušena a termín je opět volný.")).toBeVisible();
    await expect(page.getByText("Stav: zrušená")).toBeVisible();

    const [canceledBooking, reopenedSlot] = await Promise.all([
      prisma.consultationBooking.findUniqueOrThrow({ where: { id: booking.id } }),
      prisma.consultationSlot.findUniqueOrThrow({ where: { id: fixtures.consultationSlotId } }),
    ]);
    expect(canceledBooking.status).toBe("CANCELED");
    expect(canceledBooking.manageTokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(reopenedSlot).toMatchObject({ status: "OPEN", holdExpiresAt: null, googleEventId: null, meetUrl: null });
  });
});
