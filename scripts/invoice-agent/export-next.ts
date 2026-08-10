import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { decryptBuffer } from "../../src/lib/crypto";

const prisma = new PrismaClient();

async function run() {
  if (process.env.ENERGY_INVOICE_AI_ENABLED !== "true")
    throw new Error("ENERGY_INVOICE_AI_DISABLED");
  const workDir = process.argv[2];
  if (!workDir) throw new Error("Usage: export-next.ts <private-work-dir>");
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const staleBefore = new Date(Date.now() - 2 * 60 * 60_000);
  const candidate = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT pg_advisory_xact_lock(812733, 2)::text AS locked
    `;
    const document = await tx.energyInvoiceDocument.findFirst({
      where: {
        deletedAt: null,
        encryptedContent: { not: null },
        extractions: { none: { method: "AI_CODEX_DRAFT" } },
        invoiceRequest: {
          OR: [
            { status: "RECEIVED" },
            { status: "PROCESSING", updatedAt: { lt: staleBefore } },
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      include: {
        invoiceRequest: { select: { id: true, referenceCode: true } },
      },
    });
    if (!document) return null;
    await tx.energyInvoiceRequest.update({
      where: { id: document.invoiceRequestId },
      data: { status: "PROCESSING" },
    });
    await tx.auditLog.create({
      data: {
        action: "ENERGY_INVOICE_AI_CLAIMED",
        entityType: "EnergyInvoiceDocument",
        entityId: document.id,
        metadata: {
          referenceCode: document.invoiceRequest.referenceCode,
          parser: "codex-cli",
          sensitive: true,
        },
      },
    });
    return document;
  });
  if (!candidate) process.exitCode = 3;
  if (!candidate) return;
  const extension =
    candidate.mimeType === "application/pdf"
      ? "pdf"
      : candidate.mimeType === "image/png"
        ? "png"
        : "jpg";
  const documentPath = path.join(workDir, `invoice.${extension}`);
  await writeFile(
    documentPath,
    decryptBuffer(Buffer.from(candidate.encryptedContent!)),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    path.join(workDir, "manifest.json"),
    JSON.stringify({
      documentId: candidate.id,
      requestId: candidate.invoiceRequestId,
      mimeType: candidate.mimeType,
      documentPath,
    }),
    { mode: 0o600, flag: "wx" },
  );
}

run().finally(() => prisma.$disconnect());
