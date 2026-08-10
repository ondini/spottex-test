import { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { readEnergyInvoiceDocument, uploadEnergyInvoiceDocument } from "./invoice-document";
import { reviewEnergyInvoice } from "./invoice-review";

const run = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const marker = `invoice-doc-${Date.now()}`;
let ownerId = 0;
let strangerId = 0;
let siteId = 0;
let requestId = "";

run("secure energy invoice documents", () => {
  beforeAll(async () => {
    const [owner, stranger] = await Promise.all([
      prisma.user.create({ data: { email: `${marker}-owner@example.test`, passwordHash: "test", role: "USER", status: "ACTIVE", emailVerifiedAt: new Date() } }),
      prisma.user.create({ data: { email: `${marker}-stranger@example.test`, passwordHash: "test", role: "USER", status: "ACTIVE", emailVerifiedAt: new Date() } }),
    ]);
    ownerId = owner.id;
    strangerId = stranger.id;
    const site = await prisma.energySite.create({
      data: { userId: owner.id, provider: "DEMO", externalSiteId: marker, name: "Test faktury", status: "ONLINE" },
    });
    siteId = site.id;
    const request = await prisma.energyInvoiceRequest.create({ data: { energySiteId: site.id, referenceCode: `FVE-${marker}` } });
    requestId = request.id;
  });

  afterAll(async () => {
    if (ownerId || strangerId) await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("rejects a file whose contents do not match an allowed invoice format", async () => {
    await expect(uploadEnergyInvoiceDocument(ownerId, siteId, {
      originalFileName: "faktura.pdf",
      declaredMimeType: "application/pdf",
      bytes: Buffer.from("MZ executable"),
    })).rejects.toThrow("UNSUPPORTED_DOCUMENT");
  });

  it("encrypts, scopes and audits an uploaded invoice", async () => {
    const original = Buffer.from("%PDF-1.7\nminimal integration fixture\n%%EOF");
    const document = await uploadEnergyInvoiceDocument(ownerId, siteId, {
      originalFileName: "faktura-2026.pdf",
      declaredMimeType: "application/pdf",
      bytes: original,
    });
    const stored = await prisma.energyInvoiceDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(stored.sensitive).toBe(true);
    expect(stored.encryptedContent).not.toBeNull();
    expect(Buffer.from(stored.encryptedContent!)).not.toContain(original);

    const read = await readEnergyInvoiceDocument(ownerId, UserRole.USER, document.id);
    expect(read.bytes.equals(original)).toBe(true);
    await expect(readEnergyInvoiceDocument(strangerId, UserRole.USER, document.id)).rejects.toThrow("DOCUMENT_NOT_FOUND");
    await expect(prisma.auditLog.count({ where: { entityId: document.id, action: "ENERGY_INVOICE_DOCUMENT_ACCESSED", actorUserId: ownerId } })).resolves.toBe(1);

    await expect(uploadEnergyInvoiceDocument(ownerId, siteId, {
      originalFileName: "kopie.pdf",
      declaredMimeType: "application/pdf",
      bytes: original,
    })).rejects.toThrow("DUPLICATE_DOCUMENT");
  });

  it("rejects a document assigned to a different invoice request and versions valid extraction", async () => {
    const otherSite = await prisma.energySite.create({
      data: { userId: ownerId, provider: "DEMO", externalSiteId: `${marker}-other`, name: "Jiné odběrné místo", status: "ONLINE" },
    });
    await prisma.energyInvoiceRequest.create({ data: { energySiteId: otherSite.id, referenceCode: `FVE-${marker}-OTHER` } });
    const otherDocument = await uploadEnergyInvoiceDocument(ownerId, otherSite.id, {
      originalFileName: "jina-faktura.pdf",
      declaredMimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7\nother invoice fixture\n%%EOF"),
    });
    await expect(reviewEnergyInvoice(ownerId, requestId, {
      status: "PROCESSING",
      documentId: otherDocument.id,
      extracted: {},
    })).rejects.toThrow("INVOICE_DOCUMENT_MISMATCH");

    const ownDocument = await prisma.energyInvoiceDocument.findFirstOrThrow({ where: { invoiceRequestId: requestId } });
    await reviewEnergyInvoice(ownerId, requestId, {
      status: "PROCESSING",
      documentId: ownDocument.id,
      billingPeriodFrom: "2026-01-01",
      billingPeriodTo: "2026-02-01",
      extracted: { distributionTariffCode: "D25d" },
    });
    const extraction = await prisma.energyInvoiceExtraction.findFirstOrThrow({ where: { invoiceRequestId: requestId }, orderBy: { version: "desc" } });
    expect(extraction).toMatchObject({ version: 1, method: "MANUAL", schemaVersion: "energy-invoice-v1", documentId: ownDocument.id });
  });
});
