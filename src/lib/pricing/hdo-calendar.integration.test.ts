import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { importExactHdoCalendar } from "./hdo-calendar";

const run = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const marker = `hdo-${Date.now()}`;
let userId = 0;
let siteId = 0;

run("exact HDO calendar import", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email: `${marker}@example.test`, passwordHash: "test", status: "ACTIVE", role: "ADMIN", emailVerifiedAt: new Date() } });
    userId = user.id;
    const site = await prisma.energySite.create({ data: { userId, provider: "DEMO", externalSiteId: marker, name: "HDO fixture", status: "ONLINE", ean: "859182400000000001", timezone: "Europe/Prague" } });
    siteId = site.id;
    await prisma.energySiteTechnicalProfile.create({ data: { energySiteId: site.id, distributorCode: "CEZ_DISTRIBUCE" } });
    await prisma.energyPriceCurve.create({ data: { energySiteId: site.id, fingerprint: marker, purpose: "CURRENT_BASELINE", algorithmVersion: "TEST", validFrom: new Date("2026-01-01T00:00:00Z"), validTo: new Date("2026-01-02T00:00:00Z"), status: "READY", assumptions: { hdoMode: "MODEL:NIGHT_22_06" } } });
  });

  afterAll(async () => {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("rejects overlapping intervals", async () => {
    await expect(importExactHdoCalendar(userId, {
      energySiteId: siteId,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2026-01-02T00:00:00.000Z",
      sourceReference: "https://www.cezdistribuce.cz/hdo",
      intervals: [
        { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-01T06:00:00.000Z" },
        { startAt: "2026-01-01T05:00:00.000Z", endAt: "2026-01-01T07:00:00.000Z" },
      ],
    })).rejects.toThrow("HDO_INTERVALS_INVALID");
  });

  it("snapshots EAN/distributor/source and supersedes modeled curves", async () => {
    const calendar = await importExactHdoCalendar(userId, {
      energySiteId: siteId,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2026-01-02T00:00:00.000Z",
      sourceReference: "https://www.cezdistribuce.cz/hdo",
      intervals: [{ startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-01T06:00:00.000Z" }],
    });
    await expect(prisma.energyHdoCalendar.findUniqueOrThrow({ where: { id: calendar.id }, include: { intervals: true } })).resolves.toMatchObject({ exact: true, confidencePct: 100, eanSnapshot: "859182400000000001", distributorCode: "CEZ_DISTRIBUCE", intervals: [{ lowTariff: true }] });
    await expect(prisma.energyPriceCurve.findUniqueOrThrow({ where: { fingerprint: marker } })).resolves.toMatchObject({ status: "SUPERSEDED" });
    await expect(prisma.auditLog.count({ where: { action: "ENERGY_HDO_CALENDAR_IMPORTED", entityId: calendar.id } })).resolves.toBe(1);
  });
});
