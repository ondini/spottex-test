import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const manifestSchema = z.object({
  documentId: z.string().min(1),
  requestId: z.string().min(1),
});

async function run() {
  const manifestPath = process.argv[2];
  if (!manifestPath) return;
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  await prisma.$transaction([
    prisma.energyInvoiceRequest.updateMany({
      where: { id: manifest.requestId, status: "PROCESSING" },
      data: {
        status: "NEEDS_INPUT",
        notes:
          "Automatické vytěžení se nepodařilo. Dokument čeká na ruční kontrolu.",
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "ENERGY_INVOICE_AI_DRAFT_FAILED",
        entityType: "EnergyInvoiceDocument",
        entityId: manifest.documentId,
        metadata: {
          requestId: manifest.requestId,
          requiresHumanReview: true,
        },
      },
    }),
  ]);
}

run().finally(() => prisma.$disconnect());
