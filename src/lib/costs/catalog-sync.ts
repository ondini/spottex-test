import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import {
  findCatalogValue,
  latestCatalogActivity,
  normalizeCatalogKey,
} from "./catalog-contract";
import { configuredCostsBaseUrl } from "./client";

const specValueSchema = z.object({
  key: z.string(),
  valueNumber: z.union([z.string(), z.number()]).nullable().optional(),
  valueText: z.string().nullable().optional(),
  valueBoolean: z.boolean().nullable().optional(),
  valueJson: z.unknown().nullable().optional(),
  unit: z.string().nullable().optional(),
  analysisAllowed: z.boolean().optional(),
}).passthrough();

const productResponseSchema = z.object({
  snapshot: z.object({ asOf: z.string() }).passthrough(),
  pagination: z.object({ total: z.number() }).passthrough(),
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    brand: z.string().nullable().optional(),
    purchasability: z.string().optional(),
    metadata: z.unknown().optional(),
    versions: z.array(z.object({
      id: z.string(),
      sourceDocumentId: z.string().nullable(),
      validFrom: z.string(),
      validTo: z.string().nullable(),
      payload: z.unknown(),
      specValues: z.array(specValueSchema),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

const documentsResponseSchema = z.object({
  documents: z.array(z.object({
    id: z.string(),
    title: z.string(),
    sourceUrl: z.string().url(),
    finalUrl: z.string().url(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    fetchedAt: z.string(),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
    status: z.string(),
  }).passthrough()),
}).passthrough();

type Spec = z.infer<typeof specValueSchema>;
type CatalogPayload = z.infer<typeof productResponseSchema>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identityValue(metadata: unknown, keys: string[]) {
  const identity = object(metadata).identity;
  if (!Array.isArray(identity)) return null;
  const accepted = new Set(keys.map(normalizeCatalogKey));
  for (const row of identity) {
    const entry = object(row);
    if (
      typeof entry.key === "string" &&
      accepted.has(normalizeCatalogKey(entry.key)) &&
      typeof entry.value === "string"
    ) {
      return entry.value.trim();
    }
  }
  return null;
}

function spec(values: Spec[], keys: string[]) {
  return findCatalogValue(
    values.filter((value) => value.analysisAllowed !== false),
    keys,
  );
}

function textField(values: Spec[], keys: string[]) {
  return spec(values, keys)?.valueText?.trim() || null;
}

function numberField(values: Spec[], keys: string[]) {
  const raw = spec(values, keys)?.valueNumber;
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanField(values: Spec[], keys: string[]) {
  const value = spec(values, keys)?.valueBoolean;
  return typeof value === "boolean" ? value : null;
}

function stringArrayField(values: Spec[], keys: string[]) {
  const value = spec(values, keys)?.valueJson;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toUpperCase())
    : [];
}

function jsonField(values: Spec[], keys: string[]) {
  return spec(values, keys)?.valueJson ?? null;
}

function companyCode(name: string) {
  const known: Record<string, string> = {
    "E.ON": "EON",
    PRE: "PRE",
    "ČEZ": "CEZ_PRODEJ",
    "ČEZ Distribuce": "CEZ_DISTRIBUCE",
  };
  if (known[name]) return known[name];
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72);
  return `COSTS_${slug || "UNKNOWN"}`;
}

async function costsGet(baseUrl: URL, path: string) {
  const apiKey = process.env.COSTS_INTERNAL_API_KEY?.trim();
  if (!apiKey) throw new Error("COSTS_INTERNAL_API_KEY_MISSING");
  const response = await fetch(new URL(path, baseUrl), {
    headers: { authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`COSTS_HTTP_${response.status}`);
  return response.json();
}

async function loadDomain(baseUrl: URL, domain: "ENERGY_SUPPLY" | "ENERGY_DISTRIBUTION") {
  const url = new URL("api/v1/catalog/products", baseUrl);
  url.searchParams.set("domain", domain);
  url.searchParams.set("purchasability", "ALL");
  url.searchParams.set("limit", "500");
  return costsGet(baseUrl, `${url.pathname}${url.search}`).then((value) => productResponseSchema.parse(value));
}

async function archiveSourceDocument(
  baseUrl: URL,
  document: z.infer<typeof documentsResponseSchema>["documents"][number],
  snapshotAsOf: string,
  kind: string,
  now: Date,
) {
  const archivedUrl = new URL(`api/documents/${document.id}/download`, baseUrl).toString();
  return prisma.catalogSourceDocument.upsert({
    where: { sourceUrl_contentSha256: { sourceUrl: document.sourceUrl, contentSha256: document.contentSha256 } },
    update: {
      kind,
      status: "PUBLISHED",
      validFrom: document.validFrom ? new Date(document.validFrom) : null,
      validTo: document.validTo ? new Date(document.validTo) : null,
      reviewedAt: now,
      reviewedBy: "costs:verified-catalog",
      metadata: { costsDocumentId: document.id, archivedUrl, finalUrl: document.finalUrl, upstreamStatus: document.status, snapshotAsOf, verificationStatus: "VERIFIED" },
    },
    create: {
      kind,
      title: document.title,
      sourceUrl: document.sourceUrl,
      contentSha256: document.contentSha256,
      retrievedAt: new Date(document.fetchedAt),
      validFrom: document.validFrom ? new Date(document.validFrom) : null,
      validTo: document.validTo ? new Date(document.validTo) : null,
      status: "PUBLISHED",
      reviewedAt: now,
      reviewedBy: "costs:verified-catalog",
      metadata: { costsDocumentId: document.id, archivedUrl, finalUrl: document.finalUrl, upstreamStatus: document.status, snapshotAsOf, verificationStatus: "VERIFIED" },
    },
  });
}

function isVerified(version: CatalogPayload["items"][number]["versions"][number], documentStatus?: string) {
  return documentStatus === "PUBLISHED" && textField(version.specValues, ["verificationStatus"]) === "VERIFIED";
}

export type CostsCatalogSyncResult = {
  configured: boolean;
  status: "DISABLED" | "SKIPPED" | "SYNCED";
  snapshotAsOf: string | null;
  received: number;
  importedDrafts: number;
  skippedIncomplete: number;
};

export async function syncCostsEnergyCatalog(options?: { force?: boolean; now?: Date }): Promise<CostsCatalogSyncResult> {
  const baseUrl = configuredCostsBaseUrl();
  const apiKey = process.env.COSTS_INTERNAL_API_KEY?.trim();
  if (!baseUrl || !apiKey) return { configured: false, status: "DISABLED", snapshotAsOf: null, received: 0, importedDrafts: 0, skippedIncomplete: 0 };
  const now = options?.now ?? new Date();
  const intervalMinutes = Math.max(30, Number(process.env.COSTS_CATALOG_SYNC_INTERVAL_MINUTES ?? 360));
  const [lastImport, lastAttempt] = await Promise.all([
    prisma.catalogSourceDocument.findFirst({
      where: { kind: { in: ["COSTS_ENERGY_SUPPLY", "COSTS_ENERGY_DISTRIBUTION"] } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { action: "COSTS_VERIFIED_ENERGY_CATALOG_SYNCED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const lastActivityAt = latestCatalogActivity(
    lastImport?.updatedAt,
    lastAttempt?.createdAt,
  );
  if (
    !options?.force &&
    lastActivityAt &&
    now.getTime() - lastActivityAt.getTime() < intervalMinutes * 60_000
  ) {
    return { configured: true, status: "SKIPPED", snapshotAsOf: lastActivityAt.toISOString(), received: 0, importedDrafts: 0, skippedIncomplete: 0 };
  }

  const [supply, distribution] = await Promise.all([
    loadDomain(baseUrl, "ENERGY_SUPPLY"),
    loadDomain(baseUrl, "ENERGY_DISTRIBUTION"),
  ]);
  const allItems = [...supply.items, ...distribution.items];
  const documentIds = [...new Set(allItems.flatMap((item) => item.versions[0]?.sourceDocumentId ? [item.versions[0].sourceDocumentId] : []))];
  const documentsUrl = new URL("api/v1/documents", baseUrl);
  documentIds.forEach((id) => documentsUrl.searchParams.append("id", id));
  const documents = await costsGet(baseUrl, `${documentsUrl.pathname}${documentsUrl.search}`).then((value) => documentsResponseSchema.parse(value));
  const documentById = new Map(documents.documents.map((document) => [document.id, document] as const));
  let importedPublished = 0;
  let skippedIncomplete = 0;

  for (const item of supply.items) {
    const version = item.versions[0];
    const document = version?.sourceDocumentId ? documentById.get(version.sourceDocumentId) : null;
    if (!version || !document || !isVerified(version, document.status)) { skippedIncomplete += 1; continue; }
    const direction = textField(version.specValues, ["direction"]);
    const buyMode = textField(version.specValues, ["buyMode"]);
    const sellMode = textField(version.specValues, ["sellMode"]);
    const codes = stringArrayField(version.specValues, ["distributionCodes"]);
    const validFrom = new Date(version.validFrom);
    const vatIncluded = booleanField(version.specValues, ["vatIncluded"]);
    if (!direction || !["BUY", "SELL"].includes(direction) || !buyMode || !sellMode || !codes.length || !Number.isFinite(validFrom.getTime()) || vatIncluded !== true) {
      skippedIncomplete += 1; continue;
    }
    const supplierName = item.brand?.trim() || identityValue(item.metadata, ["supplier", "provider"]) || "Dodavatel neuvedený v Costs";
    const company = await prisma.energyCompany.upsert({
      where: { code: companyCode(supplierName) },
      update: { name: supplierName, roles: { set: ["SUPPLIER"] }, active: true, metadata: { source: "COSTS", verified: true } },
      create: { code: companyCode(supplierName), name: supplierName, roles: ["SUPPLIER"], metadata: { source: "COSTS", verified: true } },
    });
    const source = await archiveSourceDocument(baseUrl, document, supply.snapshot.asOf, "COSTS_ENERGY_SUPPLY", now);
    for (const distributionCode of codes) {
      const singleTariffBuy = numberField(version.specValues, ["singleTariffBuyCzkKwh"]);
      const fixedBuyVt = ["D01D", "D02D"].includes(distributionCode) && singleTariffBuy != null
        ? singleTariffBuy
        : numberField(version.specValues, ["fixedBuyVtCzkKwh"]);
      const fixedBuyNt = ["D01D", "D02D"].includes(distributionCode) && singleTariffBuy != null
        ? singleTariffBuy
        : numberField(version.specValues, ["fixedBuyNtCzkKwh"]);
      const product = await prisma.energyProduct.upsert({
        where: { supplierId_code: { supplierId: company.id, code: `COSTS_${item.id}_${distributionCode}` } },
        update: { name: `${item.name} · ${distributionCode}`, active: true, metadata: { direction, distributionCodes: [distributionCode], costsItemId: item.id, verificationStatus: "VERIFIED", referenceOnly: false } },
        create: { supplierId: company.id, code: `COSTS_${item.id}_${distributionCode}`, name: `${item.name} · ${distributionCode}`, customerSegment: "HOUSEHOLD", metadata: { direction, distributionCodes: [distributionCode], costsItemId: item.id, verificationStatus: "VERIFIED", referenceOnly: false } },
      });
      await prisma.energyProductVersion.upsert({
        where: { productId_validFrom: { productId: product.id, validFrom } },
        update: {
          sourceDocumentId: source.id, validTo: version.validTo ? new Date(version.validTo) : null, status: "PUBLISHED", currency: "CZK", vatIncluded: true,
          buyMode: buyMode as "FIX" | "SPOT" | "TIME_CURVE", sellMode: sellMode as "FIX" | "SPOT" | "TIME_CURVE",
          monthlyFeeCzk: numberField(version.specValues, ["monthlyFeeCzk"]) ?? 0,
          fixedBuyVtCzkKwh: direction === "BUY" ? fixedBuyVt : null,
          fixedBuyNtCzkKwh: direction === "BUY" ? fixedBuyNt : null,
          fixedSellVtCzkKwh: direction === "SELL" ? numberField(version.specValues, ["fixedSellVtCzkKwh"]) : null,
          fixedSellNtCzkKwh: direction === "SELL" ? numberField(version.specValues, ["fixedSellNtCzkKwh"]) : null,
          spotBuyFeeCzkKwh: direction === "BUY" ? numberField(version.specValues, ["spotBuyFeeCzkKwh"]) : null,
          spotSellFeeCzkKwh: direction === "SELL" ? numberField(version.specValues, ["spotSellFeeCzkKwh"]) : null,
          formula: { source: "COSTS", direction, distributionCode, costsItemId: item.id, costsVersionId: version.id, costsSnapshotAsOf: supply.snapshot.asOf, verificationStatus: "VERIFIED", fields: version.specValues } as Prisma.InputJsonValue,
        },
        create: {
          productId: product.id, sourceDocumentId: source.id, validFrom, validTo: version.validTo ? new Date(version.validTo) : null, status: "PUBLISHED", currency: "CZK", vatIncluded: true,
          buyMode: buyMode as "FIX" | "SPOT" | "TIME_CURVE", sellMode: sellMode as "FIX" | "SPOT" | "TIME_CURVE",
          monthlyFeeCzk: numberField(version.specValues, ["monthlyFeeCzk"]) ?? 0,
          fixedBuyVtCzkKwh: direction === "BUY" ? fixedBuyVt : null,
          fixedBuyNtCzkKwh: direction === "BUY" ? fixedBuyNt : null,
          fixedSellVtCzkKwh: direction === "SELL" ? numberField(version.specValues, ["fixedSellVtCzkKwh"]) : null,
          fixedSellNtCzkKwh: direction === "SELL" ? numberField(version.specValues, ["fixedSellNtCzkKwh"]) : null,
          spotBuyFeeCzkKwh: direction === "BUY" ? numberField(version.specValues, ["spotBuyFeeCzkKwh"]) : null,
          spotSellFeeCzkKwh: direction === "SELL" ? numberField(version.specValues, ["spotSellFeeCzkKwh"]) : null,
          formula: { source: "COSTS", direction, distributionCode, costsItemId: item.id, costsVersionId: version.id, costsSnapshotAsOf: supply.snapshot.asOf, verificationStatus: "VERIFIED", fields: version.specValues } as Prisma.InputJsonValue,
        },
      });
      importedPublished += 1;
    }
  }

  const tariffNames: Record<string, [string, string]> = {
    D01D: ["Malá spotřeba", "Jednotarifní sazba pro odběrná místa s velmi malou spotřebou."],
    D02D: ["Běžná spotřeba", "Běžná jednotarifní sazba pro domácnosti."],
    D25D: ["Ohřev vody · 8 hodin NT", "Vyžaduje splnění podmínek distributora pro akumulační ohřev vody."],
    D26D: ["Akumulační vytápění · 8 hodin NT", "Vyžaduje splnění podmínek distributora pro akumulační vytápění."],
    D27D: ["Elektromobilita · 8 hodin NT", "Vyžaduje splnění podmínek distributora pro elektromobilitu."],
  };
  for (const item of distribution.items) {
    const version = item.versions[0];
    const document = version?.sourceDocumentId ? documentById.get(version.sourceDocumentId) : null;
    const code = version ? textField(version.specValues, ["distributionCode"])?.toUpperCase() : null;
    const validFrom = version ? new Date(version.validFrom) : new Date(Number.NaN);
    const breakerFees = version ? jsonField(version.specValues, ["breakerFees"]) : null;
    if (!version || !document || !isVerified(version, document.status) || !code || !tariffNames[code] || !Number.isFinite(validFrom.getTime()) || !breakerFees) {
      skippedIncomplete += 1; continue;
    }
    const distributorName = item.brand?.trim() || identityValue(item.metadata, ["distributor"]) || "Distributor neuvedený v Costs";
    const company = await prisma.energyCompany.upsert({
      where: { code: companyCode(distributorName) },
      update: { name: distributorName, roles: { set: ["DISTRIBUTOR"] }, active: true, metadata: { source: "COSTS", verified: true } },
      create: { code: companyCode(distributorName), name: distributorName, roles: ["DISTRIBUTOR"], metadata: { source: "COSTS", verified: true } },
    });
    const source = await archiveSourceDocument(baseUrl, document, distribution.snapshot.asOf, "COSTS_ENERGY_DISTRIBUTION", now);
    const tariff = await prisma.distributionTariff.upsert({
      where: { distributorId_code_customerSegment: { distributorId: company.id, code: `${code.slice(0, -1)}d`, customerSegment: "HOUSEHOLD" } },
      update: { name: tariffNames[code][0], eligibilityNote: tariffNames[code][1], active: true },
      create: { distributorId: company.id, code: `${code.slice(0, -1)}d`, name: tariffNames[code][0], eligibilityNote: tariffNames[code][1], customerSegment: "HOUSEHOLD" },
    });
    await prisma.distributionTariffVersion.upsert({
      where: { distributionTariffId_validFrom: { distributionTariffId: tariff.id, validFrom } },
      update: {
        sourceDocumentId: source.id, validTo: version.validTo ? new Date(version.validTo) : null, status: "PUBLISHED", currency: "CZK", vatIncluded: true,
        distributionVtCzkKwh: numberField(version.specValues, ["distributionVtCzkKwh"])!,
        distributionNtCzkKwh: numberField(version.specValues, ["distributionNtCzkKwh"])!,
        systemServicesCzkKwh: numberField(version.specValues, ["systemServicesCzkKwh"]) ?? 0,
        electricityTaxCzkKwh: numberField(version.specValues, ["electricityTaxCzkKwh"]) ?? 0,
        pozeCzkKwh: numberField(version.specValues, ["pozeCzkKwh"]) ?? 0,
        monthlyMeterFeeCzk: numberField(version.specValues, ["monthlyMeterFeeCzk"]) ?? 0,
        breakerFees: breakerFees as Prisma.InputJsonValue,
        eligibility: { modeledHdo: ["D01D", "D02D"].includes(code) ? 0 : 8, source: "COSTS", verificationStatus: "VERIFIED" },
      },
      create: {
        distributionTariffId: tariff.id, sourceDocumentId: source.id, validFrom, validTo: version.validTo ? new Date(version.validTo) : null, status: "PUBLISHED", currency: "CZK", vatIncluded: true,
        distributionVtCzkKwh: numberField(version.specValues, ["distributionVtCzkKwh"])!,
        distributionNtCzkKwh: numberField(version.specValues, ["distributionNtCzkKwh"])!,
        systemServicesCzkKwh: numberField(version.specValues, ["systemServicesCzkKwh"]) ?? 0,
        electricityTaxCzkKwh: numberField(version.specValues, ["electricityTaxCzkKwh"]) ?? 0,
        pozeCzkKwh: numberField(version.specValues, ["pozeCzkKwh"]) ?? 0,
        monthlyMeterFeeCzk: numberField(version.specValues, ["monthlyMeterFeeCzk"]) ?? 0,
        breakerFees: breakerFees as Prisma.InputJsonValue,
        eligibility: { modeledHdo: ["D01D", "D02D"].includes(code) ? 0 : 8, source: "COSTS", verificationStatus: "VERIFIED" },
      },
    });
    importedPublished += 1;
  }

  if (importedPublished > 0) {
    const legacyProducts = await prisma.energyProduct.findMany({
      where: { metadata: { path: ["referenceOnly"], equals: true } },
      select: { id: true },
    });
    if (legacyProducts.length) {
      await prisma.energyProduct.updateMany({ where: { id: { in: legacyProducts.map((product) => product.id) } }, data: { active: false } });
      await prisma.energyProductVersion.updateMany({ where: { productId: { in: legacyProducts.map((product) => product.id) }, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
    }
  }
  const snapshotAsOf = [supply.snapshot.asOf, distribution.snapshot.asOf].sort().at(-1)!;
  await prisma.auditLog.create({
    data: { action: "COSTS_VERIFIED_ENERGY_CATALOG_SYNCED", entityType: "CostsCatalogSnapshot", entityId: snapshotAsOf, metadata: { received: supply.pagination.total + distribution.pagination.total, importedPublished, skippedIncomplete, verificationRequired: true } },
  });
  return { configured: true, status: "SYNCED", snapshotAsOf, received: supply.pagination.total + distribution.pagination.total, importedDrafts: importedPublished, skippedIncomplete };
}
