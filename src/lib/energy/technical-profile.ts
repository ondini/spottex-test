import "server-only";

import { randomBytes } from "node:crypto";

import { ControlledApplianceStatus, ControlledApplianceType, EnergyProvider, EnergyValueSource, Prisma } from "@prisma/client";
import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { supersedeSiteAnalyses } from "@/lib/analysis/invalidation";

import { accessTokenExpiresAt, LegacySpottexClient } from "./legacy-client";
import { serializeCustomerInvoiceRequest } from "./invoice-view";
import { EnergyError } from "./types";

const nullableNumber = (minimum: number, maximum: number) =>
  z.number().finite().min(minimum).max(maximum).nullable().optional();

const nullableCode = z.string().trim().max(80).nullable().optional();

export const technicalProfilePatchSchema = z.object({
  ean: z.string().trim().max(32).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  distributorCode: nullableCode,
  distributionTariffCode: nullableCode,
  phases: z.number().int().min(1).max(3).nullable().optional(),
  mainFuseA: nullableNumber(1, 1000),
  maxGridInputKw: nullableNumber(0, 10_000),
  maxGridOutputKw: nullableNumber(0, 10_000),
  exportAllowed: z.boolean().nullable().optional(),
  pvCapacityKwp: nullableNumber(0, 10_000),
  batteryCapacityKwh: nullableNumber(0, 10_000),
  batteryMaxChargeKw: nullableNumber(0, 10_000),
  batteryMaxDischargeKw: nullableNumber(0, 10_000),
  batteryMinSocPct: nullableNumber(0, 100),
  batteryMaxSocPct: nullableNumber(0, 100),
  batteryRoundtripEfficiencyPct: nullableNumber(1, 100),
  buyPricingMode: z.enum(["FIX", "SPOT", "OTHER"]).nullable().optional(),
  sellPricingMode: z.enum(["FIX", "SPOT", "OTHER"]).nullable().optional(),
  currentSupplierName: z.string().trim().max(200).nullable().optional(),
  currentProductName: z.string().trim().max(200).nullable().optional(),
  monthlySupplierFeeCzk: nullableNumber(0, 100_000),
  fixedBuyPriceCzkKwh: nullableNumber(-1000, 1000),
  fixedSellPriceCzkKwh: nullableNumber(-1000, 1000),
  spotBuyFeeCzkKwh: nullableNumber(-1000, 1000),
  spotSellFeeCzkKwh: nullableNumber(-1000, 1000),
  fixedPriceValidUntil: z.string().datetime().nullable().optional(),
  hdoStatus: z.enum(["EXACT", "USER_CONFIRMED", "MODELED", "MISSING"]).nullable().optional(),
  pvArrays: z.array(z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    panelCount: z.number().int().min(1).max(100_000).nullable(),
    panelRatedWp: z.number().finite().positive().max(10_000).nullable(),
    nominalDcCapacityKwp: z.number().finite().positive().max(10_000).nullable(),
    active: z.boolean(),
  }).strict()).max(50).optional(),
  controlledAppliances: z.array(z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(120),
    type: z.nativeEnum(ControlledApplianceType),
    status: z.nativeEnum(ControlledApplianceStatus),
    ratedPowerKw: z.number().finite().positive().max(10_000).nullable(),
    controllable: z.boolean(),
    minRuntimeMinutes: z.number().int().min(1).max(24 * 60).nullable(),
    maxRuntimeMinutes: z.number().int().min(1).max(24 * 60).nullable(),
  }).strict().refine((value) => value.minRuntimeMinutes == null || value.maxRuntimeMinutes == null || value.minRuntimeMinutes <= value.maxRuntimeMinutes, {
    message: "Minimální doba běhu nesmí překročit maximální dobu běhu.",
  })).max(100).optional(),
  confirmForAnalysis: z.boolean().optional(),
  confirmForControl: z.boolean().optional(),
}).strict();

export type TechnicalProfilePatch = z.infer<typeof technicalProfilePatchSchema>;

const PROFILE_FIELDS = [
  "distributorCode",
  "distributionTariffCode",
  "phases",
  "mainFuseA",
  "maxGridInputKw",
  "maxGridOutputKw",
  "exportAllowed",
  "pvCapacityKwp",
  "batteryCapacityKwh",
  "batteryMaxChargeKw",
  "batteryMaxDischargeKw",
  "batteryMinSocPct",
  "batteryMaxSocPct",
  "batteryRoundtripEfficiencyPct",
  "buyPricingMode",
  "sellPricingMode",
  "currentSupplierName",
  "currentProductName",
  "monthlySupplierFeeCzk",
  "fixedBuyPriceCzkKwh",
  "fixedSellPriceCzkKwh",
  "spotBuyFeeCzkKwh",
  "spotSellFeeCzkKwh",
  "fixedPriceValidUntil",
  "hdoStatus",
] as const;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pricingMode(value: unknown): "FIX" | "SPOT" | "OTHER" | null {
  const normalized = normalizedText(value)?.toUpperCase();
  if (normalized === "FIX" || normalized === "SPOT") return normalized;
  return normalized ? "OTHER" : null;
}

export function mapLegacyTechnicalValues(rawValue: unknown) {
  const raw = object(rawValue);
  const mapped = {
    ean: normalizedText(raw.ean),
    address: normalizedText(raw.address),
    distributorCode: null,
    distributionTariffCode: normalizedText(raw.distribution_tariff)?.toUpperCase() ?? null,
    phases: finite(raw.phases),
    mainFuseA: finite(raw.main_fuse),
    maxGridInputKw: finite(raw.max_grid_input_kw),
    maxGridOutputKw:
      finite(raw.max_grid_output_kw) ??
      finite(raw.max_ac_kw),
    exportAllowed: typeof raw.export_allowed === "boolean" ? raw.export_allowed : null,
    pvCapacityKwp: finite(raw.peak),
    batteryCapacityKwh:
      finite(raw.battery_capacity_kwh) ??
      finite(raw.battery_capacity) ??
      finite(raw.capacity_kwh),
    batteryMaxChargeKw: finite(raw.bat_max_charge_kw),
    batteryMaxDischargeKw: finite(raw.bat_max_discharge_kw),
    batteryMinSocPct: finite(raw.battery_min_soc_pct),
    batteryMaxSocPct: finite(raw.battery_max_soc_pct),
    batteryRoundtripEfficiencyPct: finite(raw.battery_roundtrip_efficiency_pct),
    buyPricingMode: pricingMode(raw.retail_tariff_buy),
    sellPricingMode: pricingMode(raw.retail_tariff_sell),
    currentSupplierName: normalizedText(raw.supplier_name),
    currentProductName: normalizedText(raw.product_name),
    monthlySupplierFeeCzk: finite(raw.monthly_supplier_fee),
    fixedBuyPriceCzkKwh: finite(raw.fix_buy_price),
    fixedSellPriceCzkKwh: finite(raw.fix_sell_price),
    spotBuyFeeCzkKwh: finite(raw.spot_fee_buy),
    spotSellFeeCzkKwh: finite(raw.spot_fee_sell),
    fixedPriceValidUntil: normalizedText(raw.fix_end_date),
    hdoStatus: null,
  };
  return { mapped, snapshot: mapped };
}

async function ownedSite(userId: number, siteId: number) {
  const site = await prisma.energySite.findFirst({
    where: { id: siteId, userId },
    include: {
      inverters: { orderBy: { id: "asc" }, take: 1 },
      technicalProfile: true,
      fieldEvidence: { orderBy: [{ observedAt: "desc" }, { id: "desc" }] },
      invoiceRequests: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 3 } },
      },
      pvArrays: { orderBy: { id: "asc" } },
      controlledAppliances: { orderBy: { id: "asc" } },
      historyImports: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!site) throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  return site;
}

function metadataNumber(metadata: Prisma.JsonValue, field: string): number | null {
  return finite(object(metadata)[field]);
}

async function seedKnownValues(userId: number, siteId: number): Promise<void> {
  const site = await ownedSite(userId, siteId);
  if (site.technicalProfile) return;
  const values = {
    pvCapacityKwp: metadataNumber(site.metadata, "pvCapacityKwp"),
    batteryCapacityKwh: metadataNumber(site.metadata, "batteryCapacityKwh"),
  };
  await prisma.$transaction(async (tx) => {
    await tx.energySiteTechnicalProfile.create({
      data: { energySiteId: site.id, ...values },
    });
    for (const [field, value] of Object.entries(values)) {
      if (value == null) continue;
      await tx.energySiteFieldEvidence.create({
        data: {
          energySiteId: site.id,
          field,
          value,
          source: site.provider === EnergyProvider.DEMO ? EnergyValueSource.MODEL : EnergyValueSource.LEGACY_API,
          sourceReference: site.provider === EnergyProvider.DEMO ? "demo metadata" : "cached dashboard metadata",
        },
      });
    }
  });
}

function legacySyncIsFresh(snapshot: Prisma.JsonValue): boolean {
  const syncedAt = normalizedText(object(snapshot).syncedAt);
  if (!syncedAt) return false;
  const timestamp = new Date(syncedAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 24 * 60 * 60 * 1000;
}

async function refreshLegacyValues(userId: number, siteId: number): Promise<string | null> {
  const site = await ownedSite(userId, siteId);
  if (site.provider !== EnergyProvider.LEGACY_SPOTTEX || !LegacySpottexClient.isConfigured()) return null;
  if (
    site.technicalProfile &&
    site.technicalProfile.pvCapacityKwp != null &&
    site.technicalProfile.batteryCapacityKwh != null &&
    legacySyncIsFresh(site.technicalProfile.legacySnapshot)
  )
    return null;
  const inverter = site.inverters[0];
  if (!inverter) return "Elektrárna zatím nemá připojený střídač.";
  const connection = await prisma.energyConnection.findUnique({
    where: { userId_provider: { userId, provider: EnergyProvider.LEGACY_SPOTTEX } },
  });
  if (!connection?.encryptedAccessToken || !connection.encryptedRefreshToken) {
    return "Technické údaje ze SolaXu nelze obnovit bez platného připojení.";
  }

  try {
    const before = {
      accessToken: decryptSecret(connection.encryptedAccessToken),
      refreshToken: decryptSecret(connection.encryptedRefreshToken),
    };
    const client = new LegacySpottexClient({ tokens: before });
    const raw = await client.fetchTechnicalInfo(inverter.externalDeviceId);
    const { mapped, snapshot } = mapLegacyTechnicalValues(raw);
    const now = new Date();
    const profile = site.technicalProfile;
    const profileUpdate: Record<string, unknown> = {
      legacySnapshot: { ...snapshot, syncedAt: now.toISOString() },
    };
    const imported: Array<[string, unknown]> = [];
    for (const field of PROFILE_FIELDS) {
      const value = mapped[field];
      if (value == null || profile?.[field] != null) continue;
      profileUpdate[field] = field === "fixedPriceValidUntil" ? new Date(String(value)) : value;
      imported.push([field, value]);
    }

    await prisma.$transaction(async (tx) => {
      await tx.energySiteTechnicalProfile.upsert({
        where: { energySiteId: site.id },
        update: profileUpdate,
        create: {
          energySiteId: site.id,
          ...profileUpdate,
        },
      });
      const siteUpdate: Prisma.EnergySiteUpdateInput = {};
      if (!site.ean && mapped.ean) siteUpdate.ean = mapped.ean;
      if (!site.address && mapped.address) siteUpdate.address = mapped.address;
      if (Object.keys(siteUpdate).length) {
        await tx.energySite.update({ where: { id: site.id }, data: siteUpdate });
      }
      for (const [field, value] of imported) {
        await tx.energySiteFieldEvidence.create({
          data: {
            energySiteId: site.id,
            field,
            value: value as Prisma.InputJsonValue,
            source: EnergyValueSource.LEGACY_API,
            sourceReference: "inverter_user_info",
            observedAt: now,
          },
        });
      }
      for (const [field, value] of [["ean", mapped.ean], ["address", mapped.address]] as const) {
        if (value == null || (field === "ean" ? site.ean : site.address)) continue;
        await tx.energySiteFieldEvidence.create({
          data: {
            energySiteId: site.id,
            field,
            value,
            source: EnergyValueSource.LEGACY_API,
            sourceReference: "inverter_user_info",
            observedAt: now,
          },
        });
      }
      const after = client.getTokens();
      if (after && (after.accessToken !== before.accessToken || after.refreshToken !== before.refreshToken)) {
        await tx.energyConnection.update({
          where: { id: connection.id },
          data: {
            encryptedAccessToken: encryptSecret(after.accessToken),
            encryptedRefreshToken: encryptSecret(after.refreshToken),
            tokenExpiresAt: accessTokenExpiresAt(after.accessToken),
          },
        });
      }
    });
    return null;
  } catch {
    return "Technické údaje ze SolaXu se nyní nepodařilo obnovit. Uložené údaje můžete zkontrolovat ručně.";
  }
}

export async function prepareAnalysisDefaults(
  userId: number,
  siteId: number,
  options: { refreshRemote?: boolean } = {},
): Promise<string | null> {
  await seedKnownValues(userId, siteId);
  const warning = options.refreshRemote
    ? await refreshLegacyValues(userId, siteId)
    : null;
  const site = await ownedSite(userId, siteId);
  const profile = site.technicalProfile;
  const pvCapacityKwp =
    profile?.pvCapacityKwp ??
    metadataNumber(site.metadata, "pvCapacityKwp") ??
    metadataNumber(site.inverters[0]?.metadata ?? {}, "ratedPowerKw");
  const batteryCapacityKwh =
    profile?.batteryCapacityKwh ??
    metadataNumber(site.metadata, "batteryCapacityKwh") ??
    0;
  const defaults = {
    phases: profile?.phases ?? 3,
    mainFuseA: profile?.mainFuseA ?? 25,
    maxGridInputKw:
      profile?.maxGridInputKw ??
      Math.round(((Math.sqrt(3) * 400 * 25 * 0.95) / 1_000) * 1_000) /
        1_000,
    pvCapacityKwp,
    maxGridOutputKw:
      profile?.maxGridOutputKw ?? (pvCapacityKwp != null ? pvCapacityKwp : null),
    batteryCapacityKwh,
    batteryMaxChargeKw:
      profile?.batteryMaxChargeKw ?? batteryCapacityKwh * 0.5,
    batteryMaxDischargeKw:
      profile?.batteryMaxDischargeKw ?? batteryCapacityKwh * 0.5,
    batteryMinSocPct: profile?.batteryMinSocPct ?? 10,
    batteryMaxSocPct: profile?.batteryMaxSocPct ?? 100,
    batteryRoundtripEfficiencyPct:
      profile?.batteryRoundtripEfficiencyPct ?? 95,
    hdoStatus: profile?.hdoStatus ?? "MODELED",
  } as const;
  const missingDefaults = Object.entries(defaults).filter(
    ([field, value]) =>
      value != null &&
      (profile?.[field as keyof typeof profile] === null ||
        profile?.[field as keyof typeof profile] === undefined),
  );
  if (!missingDefaults.length) return warning;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.energySiteTechnicalProfile.upsert({
      where: { energySiteId: site.id },
      update: Object.fromEntries(missingDefaults),
      create: {
        energySiteId: site.id,
        ...Object.fromEntries(missingDefaults),
      },
    });
    for (const [field, value] of missingDefaults) {
      await tx.energySiteFieldEvidence.create({
        data: {
          energySiteId: site.id,
          field,
          value: value as Prisma.InputJsonValue,
          source: EnergyValueSource.MODEL,
          sourceReference:
            field === "pvCapacityKwp" || field === "batteryCapacityKwh"
              ? "SolaX metadata or connected inverter fallback"
              : "Spottex conservative analysis default v1",
          observedAt: now,
        },
      });
    }
  });
  return warning;
}

function valueRecord(site: Awaited<ReturnType<typeof ownedSite>>) {
  const profile = site.technicalProfile;
  return {
    ean: site.ean,
    address: site.address,
    distributorCode: profile?.distributorCode ?? null,
    distributionTariffCode: profile?.distributionTariffCode ?? null,
    phases: profile?.phases ?? null,
    mainFuseA: profile?.mainFuseA ?? null,
    maxGridInputKw: profile?.maxGridInputKw ?? null,
    maxGridOutputKw: profile?.maxGridOutputKw ?? null,
    exportAllowed: profile?.exportAllowed ?? null,
    pvCapacityKwp: profile?.pvCapacityKwp ?? null,
    batteryCapacityKwh: profile?.batteryCapacityKwh ?? null,
    batteryMaxChargeKw: profile?.batteryMaxChargeKw ?? null,
    batteryMaxDischargeKw: profile?.batteryMaxDischargeKw ?? null,
    batteryMinSocPct: profile?.batteryMinSocPct ?? null,
    batteryMaxSocPct: profile?.batteryMaxSocPct ?? null,
    batteryRoundtripEfficiencyPct: profile?.batteryRoundtripEfficiencyPct ?? null,
    buyPricingMode: profile?.buyPricingMode ?? null,
    sellPricingMode: profile?.sellPricingMode ?? null,
    currentSupplierName: profile?.currentSupplierName ?? null,
    currentProductName: profile?.currentProductName ?? null,
    monthlySupplierFeeCzk: profile?.monthlySupplierFeeCzk ?? null,
    fixedBuyPriceCzkKwh: profile?.fixedBuyPriceCzkKwh ?? null,
    fixedSellPriceCzkKwh: profile?.fixedSellPriceCzkKwh ?? null,
    spotBuyFeeCzkKwh: profile?.spotBuyFeeCzkKwh ?? null,
    spotSellFeeCzkKwh: profile?.spotSellFeeCzkKwh ?? null,
    fixedPriceValidUntil: profile?.fixedPriceValidUntil?.toISOString() ?? null,
    hdoStatus: profile?.hdoStatus ?? "MISSING",
  };
}

export function technicalReadiness(values: ReturnType<typeof valueRecord>) {
  const missing = (fields: readonly (keyof typeof values)[]) => fields.filter((field) => {
    const value = values[field];
    return value === null || value === "" || (typeof value === "number" && value <= 0);
  });
  const analysisMissing = missing(["pvCapacityKwp"]);
  const analysisAssumptions = missing([
    "distributorCode",
    "distributionTariffCode",
    "mainFuseA",
    "buyPricingMode",
    "sellPricingMode",
    "currentSupplierName",
    "currentProductName",
    "monthlySupplierFeeCzk",
  ]);
  const controlMissing = missing([
    "ean",
    "distributionTariffCode",
    "phases",
    "mainFuseA",
    "maxGridInputKw",
    "maxGridOutputKw",
    "batteryCapacityKwh",
    "batteryMaxChargeKw",
    "batteryMaxDischargeKw",
    "batteryMinSocPct",
    "batteryMaxSocPct",
    "buyPricingMode",
    "sellPricingMode",
  ]);
  if (values.exportAllowed === null) controlMissing.push("exportAllowed");
  if (values.buyPricingMode !== "FIX" && values.buyPricingMode !== "SPOT") {
    if (!controlMissing.includes("buyPricingMode")) controlMissing.push("buyPricingMode");
  }
  if (values.sellPricingMode !== "FIX" && values.sellPricingMode !== "SPOT") {
    if (!controlMissing.includes("sellPricingMode")) controlMissing.push("sellPricingMode");
  }
  if (values.buyPricingMode === "FIX" && values.fixedBuyPriceCzkKwh === null) {
    controlMissing.push("fixedBuyPriceCzkKwh");
  }
  if (values.buyPricingMode === "SPOT" && values.spotBuyFeeCzkKwh === null) {
    controlMissing.push("spotBuyFeeCzkKwh");
  }
  if (values.sellPricingMode === "FIX" && values.fixedSellPriceCzkKwh === null) {
    controlMissing.push("fixedSellPriceCzkKwh");
  }
  if (values.sellPricingMode === "SPOT" && values.spotSellFeeCzkKwh === null) {
    controlMissing.push("spotSellFeeCzkKwh");
  }
  if (
    (values.buyPricingMode === "FIX" || values.sellPricingMode === "FIX") &&
    values.fixedPriceValidUntil === null
  ) {
    controlMissing.push("fixedPriceValidUntil");
  }
  return {
    analysisReady: analysisMissing.length === 0,
    controlReady: controlMissing.length === 0,
    analysisMissing,
    analysisAssumptions,
    controlMissing,
  };
}

export async function getLocalControlReadiness(userId: number, siteId: number) {
  const site = await ownedSite(userId, siteId);
  const values = valueRecord(site);
  const readiness = technicalReadiness(values);
  return {
    values,
    readiness,
    confirmedAt: site.technicalProfile?.controlConfirmedAt?.toISOString() ?? null,
  };
}

function serializeSite(site: Awaited<ReturnType<typeof ownedSite>>, warning: string | null) {
  const values = valueRecord(site);
  const evidence: Record<string, { source: EnergyValueSource; observedAt: string; confirmedAt: string | null }> = {};
  for (const item of site.fieldEvidence) {
    if (evidence[item.field]) continue;
    evidence[item.field] = {
      source: item.source,
      observedAt: item.observedAt.toISOString(),
      confirmedAt: item.confirmedAt?.toISOString() ?? null,
    };
  }
  return {
    site: {
      id: site.id,
      name: site.name,
      provider: site.provider,
      status: site.status,
    },
    values,
    evidence,
    readiness: technicalReadiness(values),
    confirmations: {
      analysisAt: site.technicalProfile?.analysisConfirmedAt?.toISOString() ?? null,
      controlAt: site.technicalProfile?.controlConfirmedAt?.toISOString() ?? null,
    },
    invoiceRequest: serializeCustomerInvoiceRequest(site.invoiceRequests[0] ?? null),
    pvArrays: site.pvArrays.map((array) => ({
      id: array.id,
      name: array.name,
      panelCount: array.panelCount,
      panelRatedWp: array.panelRatedWp,
      nominalDcCapacityKwp: array.nominalDcCapacityKwp,
      active: array.active,
      source: array.source,
      observedAt: array.observedAt.toISOString(),
      confirmedAt: array.confirmedAt?.toISOString() ?? null,
    })),
    controlledAppliances: site.controlledAppliances.map((appliance) => ({
      id: appliance.id,
      name: appliance.name,
      type: appliance.type,
      status: appliance.status,
      ratedPowerKw: appliance.ratedPowerKw,
      controllable: appliance.controllable,
      minRuntimeMinutes: appliance.minRuntimeMinutes,
      maxRuntimeMinutes: appliance.maxRuntimeMinutes,
      source: appliance.source,
    })),
    historyImport: site.historyImports[0] ? {
      id: site.historyImports[0].id,
      status: site.historyImports[0].status,
      requestedFrom: site.historyImports[0].requestedFrom.toISOString(),
      requestedTo: site.historyImports[0].requestedTo.toISOString(),
      totalChunks: site.historyImports[0].totalChunks,
      succeededChunks: site.historyImports[0].succeededChunks,
      failedChunks: site.historyImports[0].failedChunks,
      importedPoints: site.historyImports[0].importedPoints,
      lastError: site.historyImports[0].lastError,
    } : null,
    warning,
  };
}

export async function getTechnicalProfileWorkspace(userId: number, requestedSiteId?: number | null) {
  const sites = await prisma.energySite.findMany({
    where: { userId },
    select: { id: true, name: true, status: true },
    orderBy: { id: "asc" },
  });
  if (!sites.length) throw new EnergyError("NO_SITES", "K účtu zatím není připojena žádná elektrárna.", 404);
  const selectedSiteId = requestedSiteId ?? sites[0].id;
  if (!sites.some((site) => site.id === selectedSiteId)) {
    throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  }
  await seedKnownValues(userId, selectedSiteId);
  const warning = await refreshLegacyValues(userId, selectedSiteId);
  const site = await ownedSite(userId, selectedSiteId);
  const serialized = serializeSite(site, warning);
  await prisma.energySite.update({
    where: { id: site.id },
    data: { requiredInfo: !serialized.readiness.controlReady },
  });
  return { sites, selectedSiteId, profile: serialized };
}

export async function updateTechnicalProfile(userId: number, siteId: number, input: TechnicalProfilePatch) {
  const site = await ownedSite(userId, siteId);
  const now = new Date();
  const profileData: Record<string, unknown> = {};
  const changed: Array<[string, unknown]> = [];
  const currentValues = valueRecord(site);
  for (const field of PROFILE_FIELDS) {
    if (!(field in input)) continue;
    const raw = input[field];
    const value = field === "fixedPriceValidUntil" && raw ? new Date(String(raw)) : raw;
    const comparable = value instanceof Date ? value.toISOString() : value ?? null;
    if (currentValues[field] === comparable) continue;
    profileData[field] = value;
    changed.push([field, raw]);
  }
  const siteData: Prisma.EnergySiteUpdateInput = {};
  if ("ean" in input && (input.ean || null) !== currentValues.ean) {
    siteData.ean = input.ean || null;
    changed.push(["ean", input.ean]);
  }
  if ("address" in input && (input.address || null) !== currentValues.address) {
    siteData.address = input.address || null;
    changed.push(["address", input.address]);
  }

  const existingPvArrayIds = new Set(site.pvArrays.map((item) => item.id));
  const existingApplianceIds = new Set(site.controlledAppliances.map((item) => item.id));
  const submittedPvArrayIds = (input.pvArrays ?? []).flatMap((item) => item.id ? [item.id] : []);
  const submittedApplianceIds = (input.controlledAppliances ?? []).flatMap((item) => item.id ? [item.id] : []);
  if (new Set(submittedPvArrayIds).size !== submittedPvArrayIds.length || submittedPvArrayIds.some((id) => !existingPvArrayIds.has(id))) {
    throw new EnergyError("INVALID_REQUEST", "Některé pole panelů nepatří k této elektrárně.", 422);
  }
  if (new Set(submittedApplianceIds).size !== submittedApplianceIds.length || submittedApplianceIds.some((id) => !existingApplianceIds.has(id))) {
    throw new EnergyError("INVALID_REQUEST", "Některý spotřebič nepatří k této elektrárně.", 422);
  }
  const pvArraySnapshot = (items: typeof site.pvArrays | NonNullable<TechnicalProfilePatch["pvArrays"]>) => items.map((item) => ({
    id: "id" in item ? item.id : undefined,
    name: item.name,
    panelCount: item.panelCount,
    panelRatedWp: item.panelRatedWp,
    nominalDcCapacityKwp: item.nominalDcCapacityKwp,
    active: item.active,
  }));
  const applianceSnapshot = (items: typeof site.controlledAppliances | NonNullable<TechnicalProfilePatch["controlledAppliances"]>) => items.map((item) => ({
    id: "id" in item ? item.id : undefined,
    name: item.name,
    type: item.type,
    status: item.status,
    ratedPowerKw: item.ratedPowerKw,
    controllable: item.controllable,
    minRuntimeMinutes: item.minRuntimeMinutes,
    maxRuntimeMinutes: item.maxRuntimeMinutes,
  }));
  const pvArraysChanged = input.pvArrays !== undefined
    && JSON.stringify(pvArraySnapshot(site.pvArrays)) !== JSON.stringify(pvArraySnapshot(input.pvArrays));
  const appliancesChanged = input.controlledAppliances !== undefined
    && JSON.stringify(applianceSnapshot(site.controlledAppliances)) !== JSON.stringify(applianceSnapshot(input.controlledAppliances));
  const configurationChanged = changed.length > 0 || pvArraysChanged || appliancesChanged;

  await prisma.$transaction(async (tx) => {
    await tx.energySiteTechnicalProfile.upsert({
      where: { energySiteId: site.id },
      update: { ...profileData, ...(configurationChanged ? { analysisConfirmedAt: null, controlConfirmedAt: null } : {}) },
      create: { energySiteId: site.id, ...profileData },
    });
    if (Object.keys(siteData).length) await tx.energySite.update({ where: { id: site.id }, data: siteData });
    for (const [field, value] of changed) {
      if (value === undefined) continue;
      await tx.energySiteFieldEvidence.create({
        data: {
          energySiteId: site.id,
          field,
          value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue,
          source: EnergyValueSource.USER,
          observedAt: now,
          confirmedAt: now,
          confirmedByUserId: userId,
        },
      });
    }
    if (pvArraysChanged && input.pvArrays) {
      await tx.energyPvArray.deleteMany({ where: { energySiteId: site.id, id: { notIn: submittedPvArrayIds } } });
      for (const item of input.pvArrays) {
        const data = {
          name: item.name,
          panelCount: item.panelCount,
          panelRatedWp: item.panelRatedWp,
          nominalDcCapacityKwp: item.nominalDcCapacityKwp,
          active: item.active,
          source: EnergyValueSource.USER,
          sourceReference: "customer technical profile",
          observedAt: now,
          confirmedAt: now,
          confirmedByUserId: userId,
        };
        if (item.id) await tx.energyPvArray.update({ where: { id: item.id }, data });
        else await tx.energyPvArray.create({ data: { energySiteId: site.id, ...data } });
      }
    }
    if (appliancesChanged && input.controlledAppliances) {
      await tx.controlledAppliance.deleteMany({ where: { energySiteId: site.id, id: { notIn: submittedApplianceIds } } });
      for (const item of input.controlledAppliances) {
        const data = {
          name: item.name,
          type: item.type,
          status: item.status,
          ratedPowerKw: item.ratedPowerKw,
          controllable: item.controllable,
          minRuntimeMinutes: item.minRuntimeMinutes,
          maxRuntimeMinutes: item.maxRuntimeMinutes,
          source: EnergyValueSource.USER,
          sourceReference: "customer technical profile",
        };
        if (item.id) await tx.controlledAppliance.update({ where: { id: item.id }, data });
        else await tx.controlledAppliance.create({ data: { energySiteId: site.id, ...data } });
      }
    }
    if (configurationChanged) {
      await tx.energyPriceCurve.updateMany({
        where: { energySiteId: site.id, status: { in: ["DRAFT", "READY"] } },
        data: { status: "SUPERSEDED" },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "ENERGY_TECHNICAL_PROFILE_UPDATED",
          entityType: "EnergySite",
          entityId: String(site.id),
          metadata: {
            changedFields: changed.map(([field]) => field),
            pvArraysChanged,
            appliancesChanged,
          },
        },
      });
      await supersedeSiteAnalyses(tx, {
        energySiteId: site.id,
        actorUserId: userId,
        reason: "Technické nebo cenové vstupy se změnily. Spusťte novou analýzu nad aktuálními údaji.",
      });
    }
  });

  let refreshed = await ownedSite(userId, siteId);
  let values = valueRecord(refreshed);
  let readiness = technicalReadiness(values);
  if (input.confirmForAnalysis && !readiness.analysisReady) {
    throw new EnergyError("REQUIRED_INFO_MISSING", "Pro potvrzení analýzy doplňte výkon FVE.", 422);
  }
  if (input.confirmForControl && !readiness.controlReady) {
    throw new EnergyError("REQUIRED_INFO_MISSING", "Pro potvrzení řízení doplňte všechny bezpečnostní limity.", 422);
  }
  await prisma.$transaction([
    prisma.energySiteTechnicalProfile.update({
      where: { energySiteId: site.id },
      data: {
        ...(input.confirmForAnalysis ? { analysisConfirmedAt: now } : {}),
        ...(input.confirmForControl ? { controlConfirmedAt: now } : {}),
      },
    }),
    prisma.energySite.update({ where: { id: site.id }, data: { requiredInfo: !readiness.controlReady } }),
  ]);
  refreshed = await ownedSite(userId, siteId);
  values = valueRecord(refreshed);
  readiness = technicalReadiness(values);
  if (input.confirmForAnalysis && readiness.analysisReady) {
    try {
      const { enqueueAnalysis } = await import("@/lib/analysis/service");
      const run = await enqueueAnalysis(userId, { siteId, kind: "BASE", hardwareVariants: [] });
      await prisma.auditLog.create({ data: { actorUserId: userId, action: "ENERGY_REANALYSIS_QUEUED_AFTER_CONFIRMATION", entityType: "EnergyAnalysisRun", entityId: run.id, metadata: { energySiteId: siteId, configurationChanged } } });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : "ANALYSIS_REQUEUE_FAILED";
      await prisma.auditLog.create({ data: { actorUserId: userId, action: "ENERGY_REANALYSIS_DEFERRED", entityType: "EnergySite", entityId: String(siteId), metadata: { reason, configurationChanged } } });
    }
  }
  return serializeSite(refreshed, null);
}

export async function createInvoiceRequest(userId: number, siteId: number) {
  const site = await ownedSite(userId, siteId);
  const existing = site.invoiceRequests.find((request) =>
    ["REQUESTED", "RECEIVED", "PROCESSING", "NEEDS_INPUT"].includes(request.status),
  );
  if (existing) return existing;
  const referenceCode = `FVE-${site.id}-${randomBytes(4).toString("hex").toUpperCase()}`;
  return prisma.energyInvoiceRequest.create({
    data: { energySiteId: site.id, referenceCode },
  });
}
