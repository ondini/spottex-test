import "server-only";

import { createHash } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";

import { decryptBuffer, encryptBuffer } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export const ENERGY_INVOICE_MAX_BYTES = 10 * 1024 * 1024;
export const ENERGY_INVOICE_MAX_DOCUMENTS = 3;
const ACCEPTED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png"]);

type UploadInput = {
  originalFileName: string;
  declaredMimeType: string;
  bytes: Buffer;
};

function retentionDays() {
  const parsed = Number(process.env.ENERGY_INVOICE_RETENTION_DAYS);
  return Number.isInteger(parsed) && parsed >= 30 && parsed <= 730 ? parsed : 180;
}

function cleanFileName(value: string) {
  const leaf = value.replace(/\\/g, "/").split("/").pop()?.trim() || "faktura";
  return leaf.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 160) || "faktura";
}

function detectedMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

function validateUpload(input: UploadInput) {
  if (!input.bytes.length) throw new Error("EMPTY_DOCUMENT");
  if (input.bytes.length > ENERGY_INVOICE_MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  const fileName = cleanFileName(input.originalFileName);
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeType = detectedMimeType(input.bytes);
  if (!mimeType || !ACCEPTED_EXTENSIONS.has(extension)) throw new Error("UNSUPPORTED_DOCUMENT");
  const declared = input.declaredMimeType.toLowerCase().split(";")[0].trim();
  const declaredMatches = declared === mimeType || (mimeType === "image/jpeg" && declared === "image/jpg");
  if (declared && declared !== "application/octet-stream" && !declaredMatches) throw new Error("DOCUMENT_TYPE_MISMATCH");
  if (mimeType === "application/pdf" && extension !== "pdf") throw new Error("DOCUMENT_TYPE_MISMATCH");
  if (mimeType === "image/png" && extension !== "png") throw new Error("DOCUMENT_TYPE_MISMATCH");
  if (mimeType === "image/jpeg" && !["jpg", "jpeg"].includes(extension)) throw new Error("DOCUMENT_TYPE_MISMATCH");
  return { fileName, mimeType };
}

export async function uploadEnergyInvoiceDocument(userId: number, siteId: number, input: UploadInput) {
  const validated = validateUpload(input);
  const contentSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const encryptedContent = Uint8Array.from(encryptBuffer(input.bytes));
  return prisma.$transaction(async (tx) => {
    const request = await tx.energyInvoiceRequest.findFirst({
      where: {
        energySite: { id: siteId, userId },
        status: { in: ["REQUESTED", "RECEIVED", "PROCESSING", "NEEDS_INPUT"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, energySiteId: true, referenceCode: true },
    });
    if (!request) throw new Error("INVOICE_REQUEST_NOT_FOUND");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`energy-invoice-upload:${request.id}`}))`;
    const duplicate = await tx.energyInvoiceDocument.findUnique({
      where: { invoiceRequestId_contentSha256: { invoiceRequestId: request.id, contentSha256 } },
      select: { id: true, deletedAt: true },
    });
    if (duplicate && !duplicate.deletedAt) throw new Error("DUPLICATE_DOCUMENT");
    const activeDocuments = await tx.energyInvoiceDocument.count({
      where: { invoiceRequestId: request.id, deletedAt: null },
    });
    if (activeDocuments >= ENERGY_INVOICE_MAX_DOCUMENTS) {
      throw new Error("DOCUMENT_LIMIT_REACHED");
    }
    const now = new Date();
    const retainedUntil = new Date(now.getTime() + retentionDays() * 86_400_000);
    const document = duplicate
      ? await tx.energyInvoiceDocument.update({
          where: { id: duplicate.id },
          data: {
            storageProvider: "DATABASE_ENCRYPTED",
            storageKey: `db:${duplicate.id}`,
            originalFileName: validated.fileName,
            mimeType: validated.mimeType,
            sizeBytes: input.bytes.length,
            encryptedContent,
            encryptionVersion: "AES_256_GCM_V1",
            retainedUntil,
            deletedAt: null,
          },
        })
      : await tx.energyInvoiceDocument.create({
          data: {
            invoiceRequestId: request.id,
            storageProvider: "DATABASE_ENCRYPTED",
            storageKey: `db:${contentSha256.slice(0, 24)}`,
            originalFileName: validated.fileName,
            mimeType: validated.mimeType,
            sizeBytes: input.bytes.length,
            contentSha256,
            encryptedContent,
            encryptionVersion: "AES_256_GCM_V1",
            retainedUntil,
          },
        });
    await tx.energyInvoiceRequest.update({
      where: { id: request.id },
      data: { status: "RECEIVED", receivedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "ENERGY_INVOICE_DOCUMENT_UPLOADED",
        entityType: "EnergyInvoiceDocument",
        entityId: document.id,
        metadata: {
          energySiteId: request.energySiteId,
          referenceCode: request.referenceCode,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          retainedUntil: document.retainedUntil.toISOString(),
          sensitive: true,
        },
      },
    });
    return document;
  }, { maxWait: 5_000, timeout: 15_000 });
}

export async function readEnergyInvoiceDocument(actorUserId: number, role: UserRole, documentId: string) {
  const document = await prisma.energyInvoiceDocument.findFirst({
    where: {
      id: documentId,
      deletedAt: null,
      ...(role === "ADMIN" ? {} : { invoiceRequest: { energySite: { userId: actorUserId } } }),
    },
    select: {
      id: true,
      encryptedContent: true,
      encryptionVersion: true,
      originalFileName: true,
      mimeType: true,
      invoiceRequest: { select: { energySiteId: true, referenceCode: true } },
    },
  });
  if (!document?.encryptedContent || document.encryptionVersion !== "AES_256_GCM_V1") throw new Error("DOCUMENT_NOT_FOUND");
  const bytes = decryptBuffer(Buffer.from(document.encryptedContent));
  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: "ENERGY_INVOICE_DOCUMENT_ACCESSED",
      entityType: "EnergyInvoiceDocument",
      entityId: document.id,
      metadata: { energySiteId: document.invoiceRequest.energySiteId, referenceCode: document.invoiceRequest.referenceCode, role },
    },
  });
  return { bytes, fileName: document.originalFileName, mimeType: document.mimeType };
}

export async function purgeExpiredEnergyInvoiceDocuments(tx: Prisma.TransactionClient, now = new Date()) {
  const expired = await tx.energyInvoiceDocument.findMany({
    where: { retainedUntil: { lte: now }, deletedAt: null },
    select: { id: true },
    take: 500,
  });
  if (!expired.length) return 0;
  const ids = expired.map((item) => item.id);
  await tx.energyInvoiceDocument.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { encryptedContent: null, deletedAt: now, extractedData: Prisma.JsonNull },
  });
  await tx.auditLog.create({
    data: { action: "ENERGY_INVOICE_DOCUMENTS_PURGED", entityType: "System", metadata: { count: ids.length, ids } },
  });
  return ids.length;
}

export function documentUploadError(error: unknown) {
  const code = error instanceof Error ? error.message : "DOCUMENT_UPLOAD_FAILED";
  const statuses: Record<string, number> = {
    EMPTY_DOCUMENT: 400,
    DOCUMENT_TOO_LARGE: 413,
    UNSUPPORTED_DOCUMENT: 415,
    DOCUMENT_TYPE_MISMATCH: 415,
    DUPLICATE_DOCUMENT: 409,
    DOCUMENT_LIMIT_REACHED: 409,
    INVOICE_REQUEST_NOT_FOUND: 404,
  };
  return { code, status: statuses[code] ?? 500 };
}
