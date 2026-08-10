import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const common = {
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
};
const product = z
  .object({
    ...common,
    buyMode: z.enum(["FIX", "SPOT", "TIME_CURVE"]),
    sellMode: z.enum(["FIX", "SPOT", "TIME_CURVE"]),
    monthlyFeeCzk: z.number().finite().nonnegative(),
    fixedBuyVtCzkKwh: z.number().finite().nullable(),
    fixedBuyNtCzkKwh: z.number().finite().nullable(),
    fixedSellVtCzkKwh: z.number().finite().nullable(),
    fixedSellNtCzkKwh: z.number().finite().nullable(),
    spotBuyFeeCzkKwh: z.number().finite().nullable(),
    spotSellFeeCzkKwh: z.number().finite().nullable(),
    formula: z.record(z.string(), z.unknown()),
  })
  .strict();
const distribution = z
  .object({
    ...common,
    eligibilityNote: z.string().trim().max(2_000).nullable(),
    distributionVtCzkKwh: z.number().finite().nonnegative(),
    distributionNtCzkKwh: z.number().finite().nonnegative(),
    systemServicesCzkKwh: z.number().finite().nonnegative(),
    electricityTaxCzkKwh: z.number().finite().nonnegative(),
    pozeCzkKwh: z.number().finite().nonnegative(),
    monthlyMeterFeeCzk: z.number().finite().nonnegative(),
    breakerFees: z.record(z.string(), z.unknown()),
  })
  .strict();
const funding = z
  .object({
    ...common,
    providerName: z.string().trim().min(1).max(200),
    officialUrl: z.string().url(),
    territoryCodes: z.array(z.string().trim().min(1).max(50)).min(1),
    customerSegments: z.array(z.string().trim().min(1).max(100)).min(1),
    supportedTechnologies: z.array(z.string().trim().min(1).max(100)).min(1),
    minimumAmountCzk: z.number().finite().nonnegative().nullable(),
    maximumAmountCzk: z.number().finite().nonnegative().nullable(),
    subsidyRatePct: z.number().finite().min(0).max(100).nullable(),
    interestRatePct: z.number().finite().min(0).max(100).nullable(),
    aprPct: z.number().finite().min(0).max(200).nullable(),
    feesCzk: z.number().finite().nonnegative().nullable(),
    conditions: z.record(z.string(), z.unknown()),
    calculationFormula: z.record(z.string(), z.unknown()),
  })
  .strict();
const candidate = z
  .object({
    kind: z.enum([
      "SOURCE",
      "PRODUCT",
      "DISTRIBUTION",
      "FUNDING_GRANT",
      "FUNDING_LOAN",
    ]),
    companyCode: z.string().trim().min(1).max(100),
    companyName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    sourceUrl: z.string().url(),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime().nullable(),
    dataJson: z.string().min(2).max(100_000),
  })
  .strict();
const output = z.object({ candidates: z.array(candidate).max(20) }).strict();
const allowedHosts = new Set(
  (
    process.env.CATALOG_AGENT_ALLOWED_HOSTS ??
    "cez.cz,www.cez.cz,cezdistribuce.cz,www.cezdistribuce.cz,eru.gov.cz,www.eru.gov.cz,ote-cr.cz,www.ote-cr.cz,eon.cz,www.eon.cz,pre.cz,www.pre.cz,novazelenausporam.cz,www.novazelenausporam.cz,sfzp.cz,www.sfzp.cz,csas.cz,www.csas.cz,csob.cz,www.csob.cz,kb.cz,www.kb.cz"
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

async function officialDocument(sourceUrl: string) {
  const url = new URL(sourceUrl);
  if (
    url.protocol !== "https:" ||
    !allowedHosts.has(url.hostname.toLowerCase())
  )
    throw new Error(`CATALOG_SOURCE_HOST_NOT_ALLOWED:${url.hostname}`);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "user-agent": "SpottexCatalogAudit/1.0 contact@spottex.cz" },
  });
  if (!response.ok) throw new Error(`CATALOG_SOURCE_HTTP_${response.status}`);
  const finalUrl = new URL(response.url);
  if (
    finalUrl.protocol !== "https:" ||
    !allowedHosts.has(finalUrl.hostname.toLowerCase())
  )
    throw new Error(`CATALOG_REDIRECT_HOST_NOT_ALLOWED:${finalUrl.hostname}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 15 * 1024 * 1024)
    throw new Error("CATALOG_SOURCE_SIZE_INVALID");
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const isPdf =
    contentType === "application/pdf" &&
    bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const isXlsx =
    contentType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
    bytes.subarray(0, 2).toString("ascii") === "PK";
  const isXls =
    contentType === "application/vnd.ms-excel" &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const isCsv =
    (contentType === "text/csv" || contentType === "application/csv") &&
    !bytes.subarray(0, 256).toString("utf8").trimStart().startsWith("<");
  const isOpaqueKnownFile =
    contentType === "application/octet-stream" &&
    (bytes.subarray(0, 5).toString("ascii") === "%PDF-" ||
      bytes.subarray(0, 2).toString("ascii") === "PK" ||
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])));
  if (!isPdf && !isXlsx && !isXls && !isCsv && !isOpaqueKnownFile)
    throw new Error(
      `CATALOG_SOURCE_NOT_DIRECT_DOCUMENT:${contentType || "unknown"}`,
    );
  return { bytes, finalUrl: finalUrl.toString(), contentType };
}

async function run() {
  const inputPath = process.argv[2];
  if (!inputPath)
    throw new Error(
      "Usage: tsx scripts/catalog-agent/import-candidates.ts <candidate.json>",
    );
  const parsed = output.parse(JSON.parse(await readFile(inputPath, "utf8")));
  const archiveRoot = path.resolve(
    process.env.CATALOG_ARCHIVE_DIR ?? "/var/lib/spottex/catalog-archive",
  );
  await mkdir(archiveRoot, { recursive: true, mode: 0o750 });
  for (const row of parsed.candidates) {
    const document = await officialDocument(row.sourceUrl);
    const sha256 = createHash("sha256").update(document.bytes).digest("hex");
    const archivePath = path.join(archiveRoot, sha256);
    await writeFile(archivePath, document.bytes, {
      flag: "wx",
      mode: 0o640,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await prisma.$transaction(async (tx) => {
      const isFunding =
        row.kind === "FUNDING_GRANT" || row.kind === "FUNDING_LOAN";
      const existingCompany = isFunding
        ? null
        : await tx.energyCompany.findUnique({
            where: { code: row.companyCode },
          });
      const role = row.kind === "DISTRIBUTION" ? "DISTRIBUTOR" : "SUPPLIER";
      const company = isFunding
        ? null
        : await tx.energyCompany.upsert({
            where: { code: row.companyCode },
            update: {
              name: row.companyName,
              roles: {
                set: [...new Set([...(existingCompany?.roles ?? []), role])],
              },
            },
            create: {
              code: row.companyCode,
              name: row.companyName,
              roles: [role],
            },
          });
      const source = await tx.catalogSourceDocument.upsert({
        where: {
          sourceUrl_contentSha256: {
            sourceUrl: row.sourceUrl,
            contentSha256: sha256,
          },
        },
        update: {},
        create: {
          companyId: company?.id,
          kind: row.kind,
          title: row.title,
          sourceUrl: row.sourceUrl,
          contentSha256: sha256,
          validFrom: new Date(row.validFrom),
          validTo: row.validTo ? new Date(row.validTo) : null,
          status: "DRAFT",
          metadata: {
            storageObject: archivePath,
            finalUrl: document.finalUrl,
            contentType: document.contentType,
            importedBy: "codex-catalog-agent-v1",
            authorityName: isFunding ? row.companyName : undefined,
          },
        },
      });
      if (row.kind === "PRODUCT") {
        if (!company) throw new Error("CATALOG_COMPANY_MISSING");
        const data = product.parse(JSON.parse(row.dataJson));
        const item = await tx.energyProduct.upsert({
          where: {
            supplierId_code: { supplierId: company.id, code: data.code },
          },
          update: { name: data.name },
          create: { supplierId: company.id, code: data.code, name: data.name },
        });
        const exists = await tx.energyProductVersion.findUnique({
          where: {
            productId_validFrom: {
              productId: item.id,
              validFrom: new Date(row.validFrom),
            },
          },
        });
        if (!exists)
          await tx.energyProductVersion.create({
            data: {
              productId: item.id,
              sourceDocumentId: source.id,
              validFrom: new Date(row.validFrom),
              validTo: row.validTo ? new Date(row.validTo) : null,
              status: "DRAFT",
              vatIncluded: true,
              buyMode: data.buyMode,
              sellMode: data.sellMode,
              monthlyFeeCzk: data.monthlyFeeCzk,
              fixedBuyVtCzkKwh: data.fixedBuyVtCzkKwh,
              fixedBuyNtCzkKwh: data.fixedBuyNtCzkKwh,
              fixedSellVtCzkKwh: data.fixedSellVtCzkKwh,
              fixedSellNtCzkKwh: data.fixedSellNtCzkKwh,
              spotBuyFeeCzkKwh: data.spotBuyFeeCzkKwh,
              spotSellFeeCzkKwh: data.spotSellFeeCzkKwh,
              formula: data.formula as Prisma.InputJsonValue,
            },
          });
      } else if (row.kind === "DISTRIBUTION") {
        if (!company) throw new Error("CATALOG_COMPANY_MISSING");
        const data = distribution.parse(JSON.parse(row.dataJson));
        const item = await tx.distributionTariff.upsert({
          where: {
            distributorId_code_customerSegment: {
              distributorId: company.id,
              code: data.code,
              customerSegment: "HOUSEHOLD",
            },
          },
          update: { name: data.name, eligibilityNote: data.eligibilityNote },
          create: {
            distributorId: company.id,
            code: data.code,
            name: data.name,
            eligibilityNote: data.eligibilityNote,
          },
        });
        const exists = await tx.distributionTariffVersion.findUnique({
          where: {
            distributionTariffId_validFrom: {
              distributionTariffId: item.id,
              validFrom: new Date(row.validFrom),
            },
          },
        });
        if (!exists)
          await tx.distributionTariffVersion.create({
            data: {
              distributionTariffId: item.id,
              sourceDocumentId: source.id,
              validFrom: new Date(row.validFrom),
              validTo: row.validTo ? new Date(row.validTo) : null,
              status: "DRAFT",
              vatIncluded: true,
              distributionVtCzkKwh: data.distributionVtCzkKwh,
              distributionNtCzkKwh: data.distributionNtCzkKwh,
              systemServicesCzkKwh: data.systemServicesCzkKwh,
              electricityTaxCzkKwh: data.electricityTaxCzkKwh,
              pozeCzkKwh: data.pozeCzkKwh,
              monthlyMeterFeeCzk: data.monthlyMeterFeeCzk,
              breakerFees: data.breakerFees as Prisma.InputJsonValue,
            },
          });
      } else if (isFunding) {
        const data = funding.parse(JSON.parse(row.dataJson));
        const kind = row.kind === "FUNDING_GRANT" ? "GRANT" : "LOAN";
        const item = await tx.fundingProgram.upsert({
          where: { code: data.code },
          update: {
            name: data.name,
            kind,
            providerName: data.providerName,
            officialUrl: data.officialUrl,
          },
          create: {
            code: data.code,
            name: data.name,
            kind,
            providerName: data.providerName,
            officialUrl: data.officialUrl,
          },
        });
        const exists = await tx.fundingProgramVersion.findUnique({
          where: {
            fundingProgramId_validFrom: {
              fundingProgramId: item.id,
              validFrom: new Date(row.validFrom),
            },
          },
        });
        if (!exists)
          await tx.fundingProgramVersion.create({
            data: {
              fundingProgramId: item.id,
              sourceDocumentId: source.id,
              validFrom: new Date(row.validFrom),
              validTo: row.validTo ? new Date(row.validTo) : null,
              status: "DRAFT",
              territoryCodes: data.territoryCodes,
              customerSegments: data.customerSegments,
              supportedTechnologies: data.supportedTechnologies,
              minimumAmountCzk: data.minimumAmountCzk,
              maximumAmountCzk: data.maximumAmountCzk,
              subsidyRatePct: data.subsidyRatePct,
              interestRatePct: data.interestRatePct,
              aprPct: data.aprPct,
              feesCzk: data.feesCzk,
              conditions: data.conditions as Prisma.InputJsonValue,
              calculationFormula:
                data.calculationFormula as Prisma.InputJsonValue,
            },
          });
      }
      await tx.auditLog.create({
        data: {
          action: "CATALOG_AGENT_DRAFT_IMPORTED",
          entityType: "CatalogSourceDocument",
          entityId: source.id,
          metadata: { kind: row.kind, sourceUrl: row.sourceUrl, sha256 },
        },
      });
    });
  }
}

run().finally(() => prisma.$disconnect());
