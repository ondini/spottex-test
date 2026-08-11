import http from "node:http";

import { PrismaClient } from "@prisma/client";

import { decryptBuffer } from "../../src/lib/crypto";
import { persistInvoiceAiDraft } from "../../src/lib/energy/invoice-ai";

const prisma = new PrismaClient();
const socketPath = process.env.INVOICE_PARSER_SOCKET ?? "/run/invoice-parser/parser.sock";
const parserUrl = process.env.INVOICE_PARSER_URL;
const parserToken = process.env.INVOICE_PARSER_TOKEN ?? "";

// The parser holds the Codex credential and stays on the machine that owns it,
// so a remote INVOICE_PARSER_URL means the request crosses a network and has to
// carry the token. Refuse to start rather than poll a remote parser unarmed and
// discover it only through a stream of 401s.
if (parserUrl) {
  const host = new URL(parserUrl).hostname;
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (!loopback && parserToken.length < 32) {
    throw new Error(
      "INVOICE_PARSER_TOKEN of at least 32 characters is required when INVOICE_PARSER_URL is not loopback",
    );
  }
}
const pollMs = Math.max(1_000, Number(process.env.INVOICE_AGENT_POLL_MS ?? 10_000));
const requestTimeoutMs = Math.max(
  30_000,
  Number(process.env.INVOICE_AGENT_TIMEOUT_MS ?? 10 * 60_000),
);

type ClaimedDocument = {
  id: string;
  invoiceRequestId: string;
  mimeType: string;
  encryptedContent: Buffer;
};

async function claimNext(): Promise<ClaimedDocument | null> {
  const staleBefore = new Date(Date.now() - 2 * 60 * 60_000);
  return prisma.$transaction(async (tx) => {
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
        invoiceRequest: { select: { referenceCode: true } },
      },
    });
    if (!document?.encryptedContent) return null;
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
          parser: "isolated-codex-cli",
          sensitive: true,
        },
      },
    });
    return {
      id: document.id,
      invoiceRequestId: document.invoiceRequestId,
      mimeType: document.mimeType,
      encryptedContent: Buffer.from(document.encryptedContent),
    };
  });
}

function parseWithIsolatedWorker(document: ClaimedDocument, content: Buffer): Promise<unknown> {
  const body = Buffer.from(JSON.stringify({
    mimeType: document.mimeType,
    contentBase64: content.toString("base64"),
  }));
  return new Promise((resolve, reject) => {
    const requestOptions: http.RequestOptions = parserUrl
      ? { ...new URL("/parse", parserUrl), method: "POST" }
      : { socketPath, path: "/parse", method: "POST" };
    const request = http.request({
      ...requestOptions,
      headers: {
        "content-type": "application/json",
        "content-length": String(body.length),
        ...(parserToken ? { authorization: `Bearer ${parserToken}` } : {}),
      },
      timeout: requestTimeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) {
          request.destroy(new Error("INVOICE_PARSER_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode !== 200) {
          reject(new Error(`INVOICE_PARSER_FAILED_${response.statusCode ?? 0}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("INVOICE_PARSER_INVALID_JSON"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("INVOICE_PARSER_TIMEOUT")));
    request.on("error", reject);
    request.end(body);
  });
}

async function markFailed(document: ClaimedDocument, error: unknown) {
  await prisma.$transaction([
    prisma.energyInvoiceRequest.updateMany({
      where: { id: document.invoiceRequestId, status: "PROCESSING" },
      data: {
        status: "NEEDS_INPUT",
        notes: "Automatické vytěžení se nepodařilo. Dokument čeká na ruční kontrolu.",
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "ENERGY_INVOICE_AI_DRAFT_FAILED",
        entityType: "EnergyInvoiceDocument",
        entityId: document.id,
        metadata: {
          requestId: document.invoiceRequestId,
          parser: "isolated-codex-cli",
          requiresHumanReview: true,
          error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        },
      },
    }),
  ]);
}

async function processOne() {
  const document = await claimNext();
  if (!document) return false;
  let plaintext: Buffer | null = null;
  try {
    plaintext = decryptBuffer(document.encryptedContent);
    const draft = await parseWithIsolatedWorker(document, plaintext);
    await persistInvoiceAiDraft(document.id, document.invoiceRequestId, draft);
  } catch (error) {
    console.error("Invoice AI processing failed", {
      documentId: document.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    await markFailed(document, error);
  } finally {
    plaintext?.fill(0);
    document.encryptedContent.fill(0);
  }
  return true;
}

async function main() {
  if (process.env.ENERGY_INVOICE_AI_ENABLED !== "true") {
    throw new Error("ENERGY_INVOICE_AI_DISABLED");
  }
  while (true) {
    const processed = await processOne();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
