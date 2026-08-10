import { readFile } from "node:fs/promises";

import { z } from "zod";

import { persistInvoiceAiDraft } from "../../src/lib/energy/invoice-ai";
import { prisma } from "../../src/lib/prisma";

const manifestSchema = z
  .object({
    documentId: z.string().min(1),
    requestId: z.string().min(1),
    mimeType: z.string().min(1),
    documentPath: z.string().min(1),
  })
  .strict();

async function run() {
  const manifestPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!manifestPath || !outputPath)
    throw new Error("Usage: import-draft.ts <manifest.json> <output.json>");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  await persistInvoiceAiDraft(
    manifest.documentId,
    manifest.requestId,
    JSON.parse(await readFile(outputPath, "utf8")),
  );
}

run().finally(() => prisma.$disconnect());
