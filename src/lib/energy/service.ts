import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";

import {
  CommandStatus,
  ConnectionStatus,
  EnergyIntervalKind,
  EnergyProvider,
  EnergySiteStatus,
  EnergyValueSource,
  InverterStatus,
  Prisma,
} from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { hasInverterControlEntitlement } from "@/lib/commerce/entitlement";

import { assertCommandOwnership, selectOwnedSite } from "./authorization";
import { accessTokenExpiresAt, LegacySpottexClient } from "./legacy-client";
import { mapLegacyDashboard } from "./mapping";
import { aggregateDashboardSnapshots } from "./dashboard-aggregate";
import {
  getEnergyDataQuality,
  invalidateEnergyDataQualityCache,
} from "./data-quality";
import type {
  EnergyDashboardSnapshot,
  EnergyScheduleItem,
  EnergySeriesPoint,
  EnergySiteSummary,
  InverterCommandResult,
  InverterCommandType,
  LegacyPlant,
  LegacyPlantCandidate,
  LegacyTokenSet,
} from "./types";
import { EnergyError } from "./types";
import { upsertMeasuredIntervalsBulk } from "./interval-write";
import { getLocalControlReadiness, mapLegacyTechnicalValues } from "./technical-profile";

type SiteWithInverters = Prisma.EnergySiteGetPayload<{ include: { inverters: true } }>;

const EMPTY_CURRENT = {
  productionKw: null,
  consumptionKw: null,
  gridKw: null,
  batteryKw: null,
  batterySocPct: null,
  batteryCapacityKwh: null,
  pvCapacityKwp: null,
  buyPriceCzk: null,
  sellPriceCzk: null,
} as const;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOr(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function plantCapacityKwp(
  metadata: unknown,
  liveInverterCapacityKwp: number | null,
): number | null {
  const siteMetadata = record(metadata);
  const deviceCoverage = record(siteMetadata.deviceCoverage);
  return (
    numberOr(deviceCoverage.expectedCapacityKwp, 0) ||
    numberOr(siteMetadata.pvCapacityKwp, 0) ||
    liveInverterCapacityKwp
  );
}

function siteSummary(site: SiteWithInverters): EnergySiteSummary {
  return {
    id: site.id,
    name: site.name,
    provider: site.provider,
    status: site.status,
    optimizationOn: site.optimizationOn,
    requiredInfo: site.requiredInfo,
    lastSyncedAt: site.lastSyncedAt?.toISOString() ?? null,
  };
}

function safeVendorWarning(error: unknown): string {
  if (error instanceof EnergyError && error.code === "CONNECTION_NOT_FOUND") {
    return "Připojení k původnímu účtu vyžaduje obnovení. Zobrazujeme poslední uložená data.";
  }
  return "Živá data jsou dočasně nedostupná. Zobrazujeme poslední bezpečně uložený stav.";
}

function tokensFromConnection(connection: {
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
}): LegacyTokenSet {
  if (!connection.encryptedAccessToken || !connection.encryptedRefreshToken) {
    throw new EnergyError("CONNECTION_NOT_FOUND", "Připojení energetického účtu není dokončené.", 409);
  }
  try {
    return {
      accessToken: decryptSecret(connection.encryptedAccessToken),
      refreshToken: decryptSecret(connection.encryptedRefreshToken),
    };
  } catch {
    throw new EnergyError("CONNECTION_NOT_FOUND", "Připojení energetického účtu vyžaduje obnovení.", 409);
  }
}

async function saveRefreshedTokens(
  connectionId: number,
  before: LegacyTokenSet,
  client: LegacySpottexClient,
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const after = client.getTokens();
  if (!after || (after.accessToken === before.accessToken && after.refreshToken === before.refreshToken)) return;
  await db.energyConnection.update({
    where: { id: connectionId },
    data: {
      encryptedAccessToken: encryptSecret(after.accessToken),
      encryptedRefreshToken: encryptSecret(after.refreshToken),
      tokenExpiresAt: accessTokenExpiresAt(after.accessToken),
      status: ConnectionStatus.CONNECTED,
      lastError: null,
    },
  });
}

export async function getEnergyDashboard(
  userId: number,
  requestedSiteId?: number | null,
): Promise<EnergyDashboardSnapshot> {
  const sites = await prisma.energySite.findMany({
    where: { userId },
    include: { inverters: { orderBy: [{ status: "asc" }, { id: "asc" }] } },
    orderBy: { id: "asc" },
  });
  const selected = selectOwnedSite(sites, userId, requestedSiteId);
  const summaries = sites.map(siteSummary);
  const inverter = selected.inverters[0];
  if (!inverter) {
    throw new EnergyError("INVERTER_NOT_FOUND", "K elektrárně zatím není připojen střídač.", 404);
  }

  if (selected.provider === EnergyProvider.LEGACY_SPOTTEX && LegacySpottexClient.isConfigured()) {
    const connection = await prisma.energyConnection.findUnique({
      where: { userId_provider: { userId, provider: EnergyProvider.LEGACY_SPOTTEX } },
    });
    if (connection) {
      try {
        const originalTokens = tokensFromConnection(connection);
        const client = new LegacySpottexClient({ tokens: originalTokens });
        const now = new Date();
        const payload = await client.fetchDashboard(inverter.externalDeviceId);
        const inverterSnapshots = [
          {
            inverterId: inverter.id,
            snapshot: mapLegacyDashboard({
              payload,
              now,
              sites: summaries,
              selectedSiteId: selected.id,
              timezone: selected.timezone,
            }),
          },
        ];
        for (const additional of selected.inverters.slice(1)) {
          const additionalPayload = await client.fetchAdditionalTelemetry(
            additional.externalDeviceId,
          );
          inverterSnapshots.push({
            inverterId: additional.id,
            snapshot: mapLegacyDashboard({
              payload: additionalPayload,
              now,
              sites: summaries,
              selectedSiteId: selected.id,
              timezone: selected.timezone,
            }),
          });
        }
        const snapshot = aggregateDashboardSnapshots(
          inverterSnapshots.map((item) => item.snapshot),
        );
        // A transient cache-write failure must not replace successfully loaded
        // live telemetry with an older single-inverter fallback snapshot.
        try {
          for (const item of inverterSnapshots) {
            await persistLiveSnapshot(selected, item.inverterId, item.snapshot);
          }
          await persistSiteSnapshot(selected, snapshot);
        } catch (persistenceError) {
          console.error("ENERGY_LIVE_SNAPSHOT_PERSIST_FAILED", persistenceError);
        }
        await saveRefreshedTokens(connection.id, originalTokens, client);
        await prisma.energyConnection.update({
          where: { id: connection.id },
          data: { status: ConnectionStatus.CONNECTED, lastError: null },
        });
        return attachHistoryStatus(snapshot, userId, selected.id);
      } catch (error) {
        const warning = safeVendorWarning(error);
        let fallbackSummaries = summaries;
        if (error instanceof EnergyError && error.code === "CONNECTION_NOT_FOUND") {
          await prisma.energyConnection.update({
            where: { id: connection.id },
            data: { status: ConnectionStatus.ACTION_REQUIRED, lastError: warning },
          });
        } else {
          // The account connection can still be healthy while one plant or
          // inverter endpoint is down. Keep that failure local to the selected
          // plant so another plant is not presented as disconnected.
          await prisma.$transaction([
            prisma.energySite.update({ where: { id: selected.id }, data: { status: EnergySiteStatus.ERROR } }),
            prisma.inverter.update({ where: { id: inverter.id }, data: { status: InverterStatus.ERROR } }),
          ]);
          fallbackSummaries = summaries.map((summary) => summary.id === selected.id ? { ...summary, status: EnergySiteStatus.ERROR } : summary);
        }
        return attachHistoryStatus(
          await buildCachedSnapshot(selected, fallbackSummaries, warning),
          userId,
          selected.id,
        );
      }
    }
  }

  const warning =
    selected.provider === EnergyProvider.LEGACY_SPOTTEX
      ? "Živé napojení není nakonfigurováno. Zobrazujeme poslední uložená data."
      : null;
  return attachHistoryStatus(
    await buildCachedSnapshot(selected, summaries, warning),
    userId,
    selected.id,
  );
}

async function attachHistoryStatus(
  snapshot: EnergyDashboardSnapshot,
  userId: number,
  siteId: number,
): Promise<EnergyDashboardSnapshot> {
  const [quality, latestHistoryImport] = await Promise.all([
    getEnergyDataQuality(userId, siteId),
    prisma.energyHistoryImport.findFirst({
      where: { energySiteId: siteId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const importBatch = latestHistoryImport
    ? await prisma.energyHistoryImport.findMany({
        where: {
          energySiteId: siteId,
          requestedFrom: latestHistoryImport.requestedFrom,
          requestedTo: latestHistoryImport.requestedTo,
        },
      })
    : [];
  const totalChunks = importBatch.reduce((sum, item) => sum + item.totalChunks, 0);
  const succeededChunks = importBatch.reduce((sum, item) => sum + item.succeededChunks, 0);
  const failedChunks = importBatch.reduce((sum, item) => sum + item.failedChunks, 0);
  const importedPoints = importBatch.reduce((sum, item) => sum + item.importedPoints, 0);
  const processedChunks = succeededChunks + failedChunks;
  const importStatus = importBatch.some((item) => ["QUEUED", "RUNNING"].includes(item.status))
    ? "RUNNING"
    : importBatch.length && importBatch.every((item) => item.status === "COMPLETED")
      ? "COMPLETED"
      : importBatch.some((item) => item.status === "FAILED" || item.status === "PARTIAL")
        ? succeededChunks > 0 ? "PARTIAL" : "FAILED"
        : latestHistoryImport?.status ?? "NOT_STARTED";
  const progressPercent = totalChunks
    ? Math.min(100, Math.round((processedChunks / totalChunks) * 100))
    : 0;
  return {
    ...snapshot,
    history: {
      importStatus,
      progressPercent,
      importedPoints,
      totalChunks,
      succeededChunks,
      failedChunks,
      dataFrom: quality.from,
      dataTo: quality.to,
      coverageDays: quality.coverageDays,
      spanDays: quality.spanDays,
      coveragePercent: quality.coveragePercent,
      confidence: quality.confidence,
      readyForEstimate: quality.readyForEstimate,
      minimumDays: quality.minimumDays,
      message: quality.message,
    },
  };
}

export type EnergySyncResult = {
  attempted: number;
  synced: number;
  cached: number;
  errors: number;
};

/**
 * Refreshes stale read-only telemetry for connected plants.
 *
 * This deliberately calls only the dashboard read contract. It never enters
 * the inverter-command path, so connecting an account or running this job
 * cannot enable optimisation or send a control instruction.
 */
export async function syncConnectedEnergySites(options: {
  limit?: number;
  staleAfterMs?: number;
} = {}): Promise<EnergySyncResult> {
  if (!LegacySpottexClient.isConfigured()) {
    return { attempted: 0, synced: 0, cached: 0, errors: 0 };
  }

  const limit = Math.min(10, Math.max(1, options.limit ?? 3));
  const configuredMinutes = Number(process.env.ENERGY_SYNC_INTERVAL_MINUTES ?? 5);
  const defaultStaleAfterMs =
    Math.min(60, Math.max(1, Number.isFinite(configuredMinutes) ? configuredMinutes : 5)) * 60_000;
  const staleBefore = new Date(Date.now() - (options.staleAfterMs ?? defaultStaleAfterMs));
  const sites = await prisma.energySite.findMany({
    where: {
      provider: EnergyProvider.LEGACY_SPOTTEX,
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: staleBefore } }],
      inverters: { some: {} },
      user: {
        energyConnections: {
          some: {
            provider: EnergyProvider.LEGACY_SPOTTEX,
            status: { in: [ConnectionStatus.CONNECTED, ConnectionStatus.ERROR] },
          },
        },
      },
    },
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: limit,
    select: { id: true, userId: true },
  });

  const result: EnergySyncResult = { attempted: 0, synced: 0, cached: 0, errors: 0 };
  for (const site of sites) {
    result.attempted += 1;
    try {
      const snapshot = await getEnergyDashboard(site.userId, site.id);
      if (snapshot.source === "LIVE") result.synced += 1;
      else result.cached += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}

async function buildCachedSnapshot(
  site: SiteWithInverters,
  sites: EnergySiteSummary[],
  warning: string | null,
): Promise<EnergyDashboardSnapshot> {
  const inverter = site.inverters[0];
  if (!inverter) throw new EnergyError("INVERTER_NOT_FOUND", "Střídač nebyl nalezen.", 404);
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 30 * 60 * 60 * 1000);
  const [measurement, intervals, schedules] = await Promise.all([
    prisma.energyMeasurement.findFirst({
      where: { inverterId: inverter.id },
      orderBy: { measuredAt: "desc" },
    }),
    prisma.energyInterval.findMany({
      where: { inverterId: inverter.id, startAt: { gte: windowStart, lte: now } },
      orderBy: { startAt: "asc" },
    }),
    prisma.inverterSchedule.findMany({
      where: { inverterId: inverter.id, endAt: { gte: windowStart }, startAt: { lte: windowEnd } },
      orderBy: { startAt: "asc" },
    }),
  ]);

  const metadata = record(site.metadata);
  const cachedSavings = record(metadata.cachedSavings);
  const cachedSavingsAvailable = ["todayCzk", "weekCzk", "monthCzk", "yearCzk"].some((key) => key in cachedSavings);
  const points = new Map<string, EnergySeriesPoint>();
  for (const interval of intervals) {
    const at = interval.startAt.toISOString();
    const point = points.get(at) ?? {
      at,
      endAt: interval.endAt.toISOString(),
      predicted: interval.predicted,
      productionKwh: 0,
      consumptionKwh: 0,
      batteryKwh: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
    };
    if (interval.kind === EnergyIntervalKind.PRODUCTION) point.productionKwh = interval.kwh;
    if (interval.kind === EnergyIntervalKind.CONSUMPTION) point.consumptionKwh = interval.kwh;
    if (interval.kind === EnergyIntervalKind.BATTERY) point.batteryKwh = interval.kwh;
    if (interval.kind === EnergyIntervalKind.GRID_IMPORT) point.gridImportKwh = interval.kwh;
    if (interval.kind === EnergyIntervalKind.GRID_EXPORT) point.gridExportKwh = interval.kwh;
    points.set(at, point);
  }

  const isDemo = site.provider === EnergyProvider.DEMO;
  const latestAge = measurement ? now.getTime() - measurement.measuredAt.getTime() : Number.POSITIVE_INFINITY;
  return {
    generatedAt: now.toISOString(),
    dataAsOf: measurement?.measuredAt.toISOString() ?? null,
    dataTimestampKind: "CACHED",
    source: isDemo ? "DEMO" : "CACHE",
    stale: !isDemo && latestAge > 15 * 60 * 1000,
    warning,
    issues: [
      ...(warning ? [{ section: "telemetry" as const, message: warning }] : []),
      ...(!cachedSavingsAvailable ? [{ section: "savings" as const, message: "Ověřený výpočet úspor zatím není dostupný." }] : []),
    ],
    sites,
    selectedSiteId: site.id,
    inverterCount: site.inverters.length,
    current: measurement
      ? {
          productionKw: measurement.productionKw,
          consumptionKw: measurement.consumptionKw,
          gridKw: measurement.gridKw,
          batteryKw: measurement.batteryKw,
          batterySocPct: measurement.batterySocPct,
          batteryCapacityKwh: numberOr(metadata.batteryCapacityKwh, 0) || null,
          pvCapacityKwp: numberOr(metadata.pvCapacityKwp, 0) || null,
          buyPriceCzk: measurement.buyPriceCzk,
          sellPriceCzk: measurement.sellPriceCzk,
        }
      : { ...EMPTY_CURRENT },
    dailySeries: [...points.values()],
    savings: {
      todayCzk: numberOr(cachedSavings.todayCzk),
      weekCzk: numberOr(cachedSavings.weekCzk),
      monthCzk: numberOr(cachedSavings.monthCzk),
      yearCzk: numberOr(cachedSavings.yearCzk),
    },
    schedule: schedules.map((item) => ({
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      mode: item.mode,
      sellKw: item.sellKw,
      buyKw: item.buyKw,
      batteryKw: item.batteryKw,
      targetSocPct: item.targetSoc,
      costCzk: item.costCzk,
    })),
    history: {
      importStatus: "NOT_STARTED",
      progressPercent: 0,
      importedPoints: 0,
      totalChunks: 0,
      succeededChunks: 0,
      failedChunks: 0,
      dataFrom: null,
      dataTo: null,
      coverageDays: 0,
      spanDays: 0,
      coveragePercent: 0,
      confidence: "NONE",
      readyForEstimate: false,
      minimumDays: 7,
      message: "Zjišťujeme rozsah naměřené historie.",
    },
  };
}

async function persistLiveSnapshot(
  site: SiteWithInverters,
  inverterId: number,
  snapshot: EnergyDashboardSnapshot,
): Promise<void> {
  const receivedAt = new Date();
  const parsedForecastGeneratedAt = new Date(snapshot.generatedAt);
  const forecastGeneratedAt = new Date(
    Math.floor(
      (Number.isNaN(parsedForecastGeneratedAt.getTime())
        ? receivedAt.getTime()
        : parsedForecastGeneratedAt.getTime()) /
        3_600_000,
    ) * 3_600_000,
  );
  const sourceMeasuredAt = snapshot.dataTimestampKind === "MEASURED" && snapshot.dataAsOf
    ? new Date(snapshot.dataAsOf)
    : null;
  const measuredAt = sourceMeasuredAt && !Number.isNaN(sourceMeasuredAt.getTime())
    ? sourceMeasuredAt
    : new Date(Math.floor(receivedAt.getTime() / 300_000) * 300_000);
  await prisma.$transaction(async (tx) => {
    const hasTelemetry = [
      snapshot.current.productionKw,
      snapshot.current.consumptionKw,
      snapshot.current.gridKw,
      snapshot.current.batteryKw,
      snapshot.current.batterySocPct,
    ].some((value) => value != null);

    if (hasTelemetry) await tx.energyMeasurement.upsert({
      where: { inverterId_measuredAt: { inverterId, measuredAt } },
      update: {
        productionKw: snapshot.current.productionKw,
        consumptionKw: snapshot.current.consumptionKw,
        gridKw: snapshot.current.gridKw,
        batteryKw: snapshot.current.batteryKw,
        batterySocPct: snapshot.current.batterySocPct,
        buyPriceCzk: snapshot.current.buyPriceCzk,
        sellPriceCzk: snapshot.current.sellPriceCzk,
      },
      create: {
        inverterId,
        measuredAt,
        productionKw: snapshot.current.productionKw,
        consumptionKw: snapshot.current.consumptionKw,
        gridKw: snapshot.current.gridKw,
        batteryKw: snapshot.current.batteryKw,
        batterySocPct: snapshot.current.batterySocPct,
        buyPriceCzk: snapshot.current.buyPriceCzk,
        sellPriceCzk: snapshot.current.sellPriceCzk,
        raw: { source: "LEGACY_SPOTTEX", timestampKind: snapshot.dataTimestampKind, receivedAt: receivedAt.toISOString() },
      },
    });

    const intervalInputs = snapshot.dailySeries.flatMap((point) => {
      const values: Array<[EnergyIntervalKind, number]> = [
        [EnergyIntervalKind.PRODUCTION, point.productionKwh],
        [EnergyIntervalKind.CONSUMPTION, point.consumptionKwh],
        [EnergyIntervalKind.BATTERY, point.batteryKwh],
        [EnergyIntervalKind.GRID_IMPORT, point.gridImportKwh],
        [EnergyIntervalKind.GRID_EXPORT, point.gridExportKwh],
      ];
      return values.map(([kind, kwh]) => ({
          inverterId,
          kind,
          startAt: new Date(point.at),
          endAt: new Date(point.endAt),
          kwh,
          predicted: point.predicted,
          correctionReason: "LIVE_SNAPSHOT_REFRESH",
          sourceReference: snapshot.dataAsOf,
          forecastGeneratedAt,
          forecastModelVersion:
            process.env.SPOTTEX_FORECAST_MODEL_VERSION ||
            "LEGACY_UNVERSIONED",
          forecastSource: "LEGACY_SPOTTEX",
        }));
    });
    await upsertMeasuredIntervalsBulk(tx, intervalInputs);

    for (const item of snapshot.schedule) {
      const startAt = new Date(item.startAt);
      await tx.inverterSchedule.upsert({
        where: { inverterId_startAt_mode: { inverterId, startAt, mode: item.mode } },
        update: scheduleWrite(item),
        create: { inverterId, startAt, mode: item.mode, ...scheduleWrite(item) },
      });
    }

    await tx.inverter.update({
      where: { id: inverterId },
      data: {
        status: hasTelemetry ? InverterStatus.ONLINE : inverterStatusWithoutTelemetry(snapshot),
        ...(hasTelemetry ? { lastSeenAt: measuredAt } : {}),
      },
    });
  });
  invalidateEnergyDataQualityCache(site.id);
}

async function persistSiteSnapshot(
  site: SiteWithInverters,
  snapshot: EnergyDashboardSnapshot,
): Promise<void> {
  const receivedAt = new Date();
  const existingMetadata = record(site.metadata);
  // The legacy live endpoint reports capacity for the currently queried
  // inverter. On multi-inverter plants that value is not the capacity of the
  // whole site and must not overwrite the plant-level value discovered during
  // onboarding.
  const knownPlantCapacityKwp = plantCapacityKwp(
    existingMetadata,
    snapshot.current.pvCapacityKwp,
  );
  const selectedSummary = snapshot.sites.find((item) => item.id === site.id);
  const hasTelemetry = [
    snapshot.current.productionKw,
    snapshot.current.consumptionKw,
    snapshot.current.gridKw,
    snapshot.current.batteryKw,
    snapshot.current.batterySocPct,
  ].some((value) => value != null);
  await prisma.energySite.update({
    where: { id: site.id },
    data: {
      status: EnergySiteStatus.ONLINE,
      optimizationOn: selectedSummary?.optimizationOn ?? site.optimizationOn,
      ...(hasTelemetry ? { lastSyncedAt: receivedAt } : {}),
      metadata: {
        ...existingMetadata,
        batteryCapacityKwh:
          snapshot.current.batteryCapacityKwh ??
          (numberOr(existingMetadata.batteryCapacityKwh, 0) || null),
        pvCapacityKwp:
          knownPlantCapacityKwp,
        cachedSavings: snapshot.savings,
      } as Prisma.InputJsonValue,
    },
  });
}

function inverterStatusWithoutTelemetry(snapshot: EnergyDashboardSnapshot): InverterStatus {
  return snapshot.issues.some((issue) => issue.section === "telemetry")
    ? InverterStatus.ERROR
    : InverterStatus.UNKNOWN;
}

function scheduleWrite(item: EnergyScheduleItem) {
  return {
    endAt: new Date(item.endAt),
    sellKw: item.sellKw,
    buyKw: item.buyKw,
    batteryKw: item.batteryKw,
    targetSoc: item.targetSocPct,
    costCzk: item.costCzk,
    source: "LEGACY_SPOTTEX",
  };
}

export async function discoverLegacyEnergyPlants(
  credentials: { email: string; password: string },
): Promise<{ discoveryId: string; expiresInSeconds: number; plants: LegacyPlantCandidate[] }> {
  const client = new LegacySpottexClient();
  const discovery = await client.discoverPlants(credentials.email, credentials.password);
  const { plants } = discovery;
  if (plants.length === 0) {
    throw new EnergyError(
      "INVALID_REQUEST",
      "V účtu SolaX Cloud nebyla nalezena žádná podporovaná elektrárna.",
      422,
    );
  }
  return discovery;
}

export function selectLegacyRegistrationRows(
  plants: LegacyPlant[],
  selectedSiteIds: string[],
): LegacyPlant[] {
  const selected = new Set(selectedSiteIds);
  const rows = plants.filter((plant) => selected.has(plant.siteId));
  const returnedSites = new Set(rows.map((plant) => plant.siteId));
  const missingSite = selectedSiteIds.some((siteId) => !returnedSites.has(siteId));
  if (missingSite) {
    throw new EnergyError(
      "LEGACY_UNAVAILABLE",
      "Energetická služba nevrátila všechny vybrané elektrárny.",
      502,
    );
  }
  return rows;
}

export async function connectLegacyEnergyAccount(
  userId: number,
  selection: { plantIds: string[]; discoveryId: string },
): Promise<{ sites: EnergySiteSummary[]; connectedSiteIds: number[] }> {
  const client = new LegacySpottexClient();
  const registration = await client.registerPlants(
    selection.plantIds,
    selection.discoveryId,
  );
  const selectedSiteIds = new Set(registration.selectedSiteIds);
  const login = {
    ...registration,
    plants: selectLegacyRegistrationRows(
      registration.plants,
      registration.selectedSiteIds,
    ),
  };

  const siteIds = [...new Set(login.plants.map((plant) => plant.siteId))];
  const deviceIds = [...new Set(login.plants.map((plant) => plant.deviceId))];
  const siteCoverage = new Map(
    siteIds.map((siteId) => {
      const rows = login.plants.filter((plant) => plant.siteId === siteId);
      const first = rows[0];
      return [
        siteId,
        {
          status:
            rows.some(
              (plant) =>
                plant.deviceCoverageStatus === "POSSIBLY_INCOMPLETE",
            )
              ? "POSSIBLY_INCOMPLETE"
              : first?.deviceCoverageStatus ?? "UNKNOWN",
          connectedInverterCount: rows.length,
          availableRatedPowerKw:
            first?.availableInverterRatedPowerKw ?? null,
          expectedCapacityKwp: first?.pvCapacityKwp ?? null,
          percent: first?.deviceCoveragePercent ?? null,
        },
      ] as const;
    }),
  );
  const [foreignSites, foreignInverters] = await Promise.all([
    prisma.energySite.findMany({
      where: {
        provider: EnergyProvider.LEGACY_SPOTTEX,
        externalSiteId: { in: siteIds },
        userId: { not: userId },
      },
      select: { id: true },
    }),
    prisma.inverter.findMany({
      where: {
        provider: EnergyProvider.LEGACY_SPOTTEX,
        externalDeviceId: { in: deviceIds },
        energySite: { userId: { not: userId } },
      },
      select: { id: true },
    }),
  ]);
  if (foreignSites.length || foreignInverters.length) {
    throw new EnergyError(
      "CONFLICT",
      "Některá elektrárna už je bezpečně přiřazena k jinému Spottex účtu.",
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    const connection = await tx.energyConnection.upsert({
      where: { userId_provider: { userId, provider: EnergyProvider.LEGACY_SPOTTEX } },
      update: {
        externalAccountId: login.externalAccountId,
        encryptedAccessToken: encryptSecret(login.accessToken),
        encryptedRefreshToken: encryptSecret(login.refreshToken),
        tokenExpiresAt: accessTokenExpiresAt(login.accessToken),
        status: ConnectionStatus.CONNECTED,
        lastError: null,
        metadata: { plantCount: selectedSiteIds.size, connectedAt: new Date().toISOString() },
      },
      create: {
        userId,
        provider: EnergyProvider.LEGACY_SPOTTEX,
        externalAccountId: login.externalAccountId,
        encryptedAccessToken: encryptSecret(login.accessToken),
        encryptedRefreshToken: encryptSecret(login.refreshToken),
        tokenExpiresAt: accessTokenExpiresAt(login.accessToken),
        status: ConnectionStatus.CONNECTED,
        metadata: { plantCount: selectedSiteIds.size, connectedAt: new Date().toISOString() },
      },
    });

    for (const plant of login.plants) {
      const coverage = siteCoverage.get(plant.siteId);
      const deviceCoverageIncomplete =
        coverage?.status === "POSSIBLY_INCOMPLETE";
      const site = await tx.energySite.upsert({
        where: {
          provider_externalSiteId: {
            provider: EnergyProvider.LEGACY_SPOTTEX,
            externalSiteId: plant.siteId,
          },
        },
        update: {
          name: plant.name,
          status: EnergySiteStatus.ONLINE,
          optimizationOn: plant.optimizationOn,
          requiredInfo: plant.requiredInfo || deviceCoverageIncomplete,
          // A dashboard read performs and timestamps the first telemetry sync.
          // Connecting credentials by itself is intentionally not considered a sync.
          lastSyncedAt: null,
        },
        create: {
          userId,
          provider: EnergyProvider.LEGACY_SPOTTEX,
          externalSiteId: plant.siteId,
          name: plant.name,
          status: EnergySiteStatus.ONLINE,
          optimizationOn: plant.optimizationOn,
          requiredInfo: plant.requiredInfo || deviceCoverageIncomplete,
          lastSyncedAt: null,
          address: plant.location,
          metadata: {
            pvCapacityKwp: plant.pvCapacityKwp,
            batteryCapacityKwh: plant.batteryCapacityKwh,
            deviceCoverage: coverage,
          },
        },
      });
      const siteMetadata = record(site.metadata);
      await tx.energySite.update({
        where: { id: site.id },
        data: {
          ...(!site.address && plant.location
            ? { address: plant.location }
            : {}),
          metadata: {
            ...siteMetadata,
            pvCapacityKwp:
              plant.pvCapacityKwp ?? siteMetadata.pvCapacityKwp ?? null,
            batteryCapacityKwh:
              plant.batteryCapacityKwh ??
              siteMetadata.batteryCapacityKwh ??
              null,
            deviceCoverage: coverage,
          } as Prisma.InputJsonValue,
        },
      });
      const inverterMetadata = {
        ratedPowerKw: plant.inverterRatedPowerKw,
        serialSuffix: plant.inverterSerialSuffix,
      };
      await tx.inverter.upsert({
        where: {
          provider_externalDeviceId: {
            provider: EnergyProvider.LEGACY_SPOTTEX,
            externalDeviceId: plant.deviceId,
          },
        },
        update: {
          energySiteId: site.id,
          status: InverterStatus.ONLINE,
          lastSeenAt: new Date(),
          manufacturer: "SolaX",
          model: plant.inverterModel,
          metadata: inverterMetadata,
        },
        create: {
          energySiteId: site.id,
          provider: EnergyProvider.LEGACY_SPOTTEX,
          externalDeviceId: plant.deviceId,
          name: plant.name,
          manufacturer: "SolaX",
          model: plant.inverterModel,
          status: InverterStatus.ONLINE,
          lastSeenAt: new Date(),
          metadata: inverterMetadata,
        },
      });
      const currentProfile = await tx.energySiteTechnicalProfile.findUnique({
        where: { energySiteId: site.id },
      });
      const technicalValues = {
        pvCapacityKwp:
          currentProfile?.pvCapacityKwp ?? plant.pvCapacityKwp,
        batteryCapacityKwh:
          currentProfile?.batteryCapacityKwh ?? plant.batteryCapacityKwh,
      };
      await tx.energySiteTechnicalProfile.upsert({
        where: { energySiteId: site.id },
        update: technicalValues,
        create: { energySiteId: site.id, ...technicalValues },
      });
      for (const [field, value] of Object.entries(technicalValues)) {
        if (value == null || currentProfile?.[field as keyof typeof currentProfile] != null)
          continue;
        await tx.energySiteFieldEvidence.create({
          data: {
            energySiteId: site.id,
            field,
            value,
            source: EnergyValueSource.LEGACY_API,
            sourceReference: "SolaX plant metadata during registration",
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "ENERGY_CONNECTION_CONNECTED",
        entityType: "EnergyConnection",
        entityId: String(connection.id),
        metadata: { provider: EnergyProvider.LEGACY_SPOTTEX, plantCount: selectedSiteIds.size },
      },
    });
  });

  const sites = await prisma.energySite.findMany({
    where: { userId },
    include: { inverters: true },
    orderBy: { id: "asc" },
  });
  const connectedSiteIds = sites
    .filter((site) => selectedSiteIds.has(site.externalSiteId))
    .map((site) => site.id);
  await prisma.energyConnection.update({
    where: { userId_provider: { userId, provider: EnergyProvider.LEGACY_SPOTTEX } },
    data: {
      metadata: {
        plantCount: sites.filter((site) => site.provider === EnergyProvider.LEGACY_SPOTTEX).length,
        connectedAt: new Date().toISOString(),
      },
    },
  });
  return { sites: sites.map(siteSummary), connectedSiteIds };
}

const INVERTER_LOCK_NAMESPACE = 74_291;
const INVERTER_LOCK_WAIT_MS = 30_000;
const INVERTER_TRANSACTION_TIMEOUT_MS = 65_000;

async function lockInverter(tx: Prisma.TransactionClient, inverterId: number): Promise<void> {
  await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${INVERTER_LOCK_WAIT_MS}ms`}, true)`;
  // Do not select PostgreSQL's void return value directly: Prisma cannot
  // deserialize it. The volatile function still executes inside the subquery.
  await tx.$queryRaw`
    SELECT 1::int AS acquired
    FROM (
      SELECT pg_advisory_xact_lock(${INVERTER_LOCK_NAMESPACE}::int, ${inverterId}::int)
    ) AS inverter_lock
  `;
}

async function hasLockedInverterControlEntitlement(
  tx: Prisma.TransactionClient,
  userId: number,
  now = new Date(),
): Promise<boolean> {
  const subscription = await tx.subscription.findFirst({
    where: {
      userId,
      user: { status: "ACTIVE" },
      product: { code: "INVERTER_CONTROL", active: true },
      status: { in: ["ACTIVE", "TRIAL"] },
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: { id: true },
  });
  return subscription !== null;
}

async function failLockedCommand(
  tx: Prisma.TransactionClient,
  input: { userId: number; siteId: number; type: InverterCommandType },
  commandId: string,
  message: string,
  reasonCode: string,
) {
  const completedAt = new Date();
  const updated = await tx.inverterCommand.update({
    where: { id: commandId },
    data: {
      status: CommandStatus.FAILED,
      response: { accepted: false, reasonCode },
      error: message,
      completedAt,
    },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: input.userId,
      action: "INVERTER_COMMAND_FAILED",
      entityType: "InverterCommand",
      entityId: commandId,
      metadata: { siteId: input.siteId, command: input.type, reasonCode },
    },
  });
  return updated;
}

function isRecoverableStateIntent(command: { type: string; status: CommandStatus }): boolean {
  return (
    (command.type === "turnon" || command.type === "turnoff") &&
    (command.status === CommandStatus.PENDING || command.status === CommandStatus.SENT)
  );
}

function assertInternalSafetyIntent(command: { payload: Prisma.JsonValue }): void {
  if (record(command.payload).safetyOverride !== true) {
    throw new EnergyError(
      "CONFLICT",
      "Bezpečnostní idempotency klíč koliduje s uživatelským příkazem.",
      409,
    );
  }
}

async function markLockedCommandForSafetyReconciliation(
  tx: Prisma.TransactionClient,
  input: { userId: number; siteId: number; type: InverterCommandType },
  commandId: string,
  message: string,
  reasonCode: string,
) {
  const updated = await tx.inverterCommand.update({
    where: { id: commandId },
    data: {
      response: {
        outcomeKnown: false,
        requiresSafetyReconciliation: true,
        reasonCode,
      },
      error: message,
      completedAt: null,
    },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: input.userId,
      action: "INVERTER_COMMAND_REQUIRES_SAFETY_RECONCILIATION",
      entityType: "InverterCommand",
      entityId: commandId,
      metadata: { siteId: input.siteId, command: input.type, reasonCode },
    },
  });
  return updated;
}

async function recordExecutionFailure(
  input: { userId: number; siteId: number; type: InverterCommandType },
  commandId: string,
  error: unknown,
) {
  return prisma.$transaction(async (tx) => {
    const completedAt = new Date();
    const changed = await tx.inverterCommand.updateMany({
      where: { id: commandId, status: { in: [CommandStatus.PENDING, CommandStatus.SENT] } },
      data: {
        status: CommandStatus.FAILED,
        response: { accepted: false, reasonCode: "EXECUTION_INFRASTRUCTURE_FAILURE" },
        error: "Příkaz se nepodařilo bezpečně zahájit.",
        completedAt,
      },
    });
    if (changed.count > 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.userId,
          action: "INVERTER_COMMAND_FAILED",
          entityType: "InverterCommand",
          entityId: commandId,
          metadata: {
            siteId: input.siteId,
            command: input.type,
            reasonCode: "EXECUTION_INFRASTRUCTURE_FAILURE",
            error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          },
        },
      });
    }
    return tx.inverterCommand.findUniqueOrThrow({ where: { id: commandId } });
  });
}

async function recordUnknownCommandOutcome(
  input: { userId: number; siteId: number; type: InverterCommandType },
  commandId: string,
  error: unknown,
) {
  return prisma.$transaction(async (tx) => {
    await tx.inverterCommand.updateMany({
      where: { id: commandId, status: { in: [CommandStatus.PENDING, CommandStatus.SENT] } },
      data: {
        response: { outcomeKnown: false, requiresSafetyReconciliation: true },
        error: "Výsledek příkazu není potvrzen; čeká na bezpečné sjednocení stavu.",
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.userId,
        action: "INVERTER_COMMAND_OUTCOME_UNKNOWN",
        entityType: "InverterCommand",
        entityId: commandId,
        metadata: {
          siteId: input.siteId,
          command: input.type,
          // Once dispatch starts, a timeout can mean the device accepted the command
          // even though we did not receive or persist its acknowledgement.
          requiresSafetyReconciliation: true,
          error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        },
      },
    });
    return tx.inverterCommand.findUniqueOrThrow({ where: { id: commandId } });
  });
}

export async function issueInverterCommand(input: {
  userId: number;
  siteId: number;
  /** Internal callers may target a concrete device on a multi-inverter site. */
  inverterId?: number;
  type: InverterCommandType;
  idempotencyKey: string;
  safetyOverride?: boolean;
}, options: {
  /** @internal Deterministic coordination point for database race tests. */
  beforeIntentLock?: () => Promise<void>;
} = {}): Promise<InverterCommandResult> {
  const isSafetyTurnoff = input.safetyOverride === true && input.type === "turnoff";
  const sites = await prisma.energySite.findMany({
    where: { userId: input.userId },
    include: { inverters: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const site = selectOwnedSite(sites, input.userId, input.siteId);
  const inverter = input.inverterId
    ? site.inverters.find((candidate) => candidate.id === input.inverterId)
    : site.inverters[0];
  if (!inverter) throw new EnergyError("INVERTER_NOT_FOUND", "Střídač nebyl nalezen.", 404);

  // Settled retries never dispatch again. Unresolved state-setting commands are
  // safe to reconcile under the same distributed lock because turnon/turnoff
  // set a desired state instead of applying a cumulative operation.
  const existing = await prisma.inverterCommand.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  type CommandRecord = NonNullable<typeof existing>;
  let intent: { command: CommandRecord; repeated: boolean } | null = null;
  if (existing) {
    assertCommandOwnership(existing, {
      userId: input.userId,
      inverterId: inverter.id,
      type: input.type,
    });
    if (isSafetyTurnoff) assertInternalSafetyIntent(existing);
    if (!isRecoverableStateIntent(existing)) return commandResult(existing, true);
    intent = { command: existing, repeated: true };
  }

  if (!intent && !isSafetyTurnoff && !(await hasInverterControlEntitlement(input.userId))) {
    throw new EnergyError(
      "SUBSCRIPTION_REQUIRED",
      "Řízení střídače vyžaduje aktivní předplatné nebo PROMO přístup.",
      403,
    );
  }
  if (!intent && input.type === "turnon" && site.requiredInfo) {
    throw new EnergyError(
      "REQUIRED_INFO_MISSING",
      "Před zapnutím řízení doplňte požadované údaje elektrárny.",
      409,
    );
  }

  // Phase 1 commits the intent before any vendor call. If the process dies after
  // the device accepted a command, PENDING remains durable and can be reconciled.
  if (!intent) {
    await options.beforeIntentLock?.();
    try {
      intent = await prisma.$transaction(
        async (tx) => {
        await lockInverter(tx, inverter.id);
        const raced = await tx.inverterCommand.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (raced) {
          assertCommandOwnership(raced, {
            userId: input.userId,
            inverterId: inverter.id,
            type: input.type,
          });
          if (isSafetyTurnoff) assertInternalSafetyIntent(raced);
          return { command: raced, repeated: true };
        }

        // The public precheck can race with cancellation, account disable or
        // expiry. Recheck only after taking the same inverter lock used by the
        // durable OFF worker. If OFF already completed, no newer user intent is
        // persisted; if revocation commits after this read, its OFF must wait
        // for this transaction and will compensate the committed intent.
        if (!isSafetyTurnoff && !(await hasLockedInverterControlEntitlement(tx, input.userId))) {
          throw new EnergyError(
            "SUBSCRIPTION_REQUIRED",
            "Řízení střídače vyžaduje aktivní předplatné nebo PROMO přístup.",
            403,
          );
        }

        const recent = await tx.inverterCommand.findFirst({
          where: {
            inverterId: inverter.id,
            requestedAt: { gt: new Date(Date.now() - 10_000) },
          },
          orderBy: { requestedAt: "desc" },
          select: { id: true },
        });
        // A user must always be able to stop control immediately. Cooldown only
        // throttles state-enabling or synchronization commands.
        if (recent && !isSafetyTurnoff && input.type !== "turnoff") {
          throw new EnergyError(
            "COMMAND_COOLDOWN",
            "Před dalším příkazem vyčkejte alespoň 10 sekund.",
            429,
          );
        }

        const created = await tx.inverterCommand.create({
          data: {
            inverterId: inverter.id,
            requestedById: input.userId,
            idempotencyKey: input.idempotencyKey,
            type: input.type,
            payload: { siteId: site.id, safetyOverride: isSafetyTurnoff },
            status: CommandStatus.PENDING,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: input.userId,
            action: "INVERTER_COMMAND_REQUESTED",
            entityType: "InverterCommand",
            entityId: created.id,
            metadata: {
              siteId: site.id,
              command: input.type,
              safetyOverride: isSafetyTurnoff,
            },
          },
        });
        return { command: created, repeated: false };
        },
        { maxWait: 10_000, timeout: INVERTER_TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const raced = await prisma.inverterCommand.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (!raced) throw error;
      assertCommandOwnership(raced, {
        userId: input.userId,
        inverterId: inverter.id,
        type: input.type,
      });
      if (isSafetyTurnoff) assertInternalSafetyIntent(raced);
      intent = { command: raced, repeated: true };
    }
  }
  if (!intent) throw new Error("Příkazový intent se nepodařilo vytvořit.");
  if (intent.repeated && !isRecoverableStateIntent(intent.command)) {
    return commandResult(intent.command, true);
  }

  // Phase 2 deliberately keeps the transaction-scoped advisory lock while the
  // command is in flight. This serializes user commands with safety turnoff.
  let vendorDispatchStarted = false;
  let safetyDeactivationReason: string | null = null;
  try {
    const completed = await prisma.$transaction(
      async (tx) => {
        await lockInverter(tx, inverter.id);
        const persisted = await tx.inverterCommand.findUniqueOrThrow({
          where: { id: intent.command.id },
        });
        assertCommandOwnership(persisted, {
          userId: input.userId,
          inverterId: inverter.id,
          type: input.type,
        });
        if (
          persisted.status !== CommandStatus.PENDING &&
          persisted.status !== CommandStatus.SENT
        ) {
          return persisted;
        }

        const currentInverter = await tx.inverter.findFirst({
          where: {
            id: inverter.id,
            energySiteId: site.id,
            energySite: { userId: input.userId },
          },
          include: { energySite: true },
        });
        if (!currentInverter) {
          return failLockedCommand(
            tx,
            input,
            persisted.id,
            "Střídač už není k této elektrárně připojen.",
            "INVERTER_NOT_FOUND",
          );
        }
        const hasEntitlement =
          isSafetyTurnoff || (await hasLockedInverterControlEntitlement(tx, input.userId));
        if (!hasEntitlement && !(intent.repeated && input.type === "turnoff")) {
          if (intent.repeated && input.type === "turnon") {
            safetyDeactivationReason = "SUBSCRIPTION_REQUIRED";
            return markLockedCommandForSafetyReconciliation(
              tx,
              input,
              persisted.id,
              "Oprávnění skončilo před potvrzením zapnutí; je nutné bezpečnostní vypnutí.",
              safetyDeactivationReason,
            );
          }
          return failLockedCommand(
            tx,
            input,
            persisted.id,
            "Řízení střídače vyžaduje aktivní předplatné nebo PROMO přístup.",
            "SUBSCRIPTION_REQUIRED",
          );
        }
        if (input.type === "turnon" && currentInverter.energySite.requiredInfo) {
          if (intent.repeated) {
            safetyDeactivationReason = "REQUIRED_INFO_MISSING";
            return markLockedCommandForSafetyReconciliation(
              tx,
              input,
              persisted.id,
              "Zapnutí nebylo potvrzeno a elektrárna vyžaduje doplnění údajů; je nutné bezpečnostní vypnutí.",
              safetyDeactivationReason,
            );
          }
          return failLockedCommand(
            tx,
            input,
            persisted.id,
            "Před zapnutím řízení doplňte požadované údaje elektrárny.",
            "REQUIRED_INFO_MISSING",
          );
        }

        let stateVerified = input.type === "sync";
        let observedOptimizationOn: boolean | null = null;
        if (currentInverter.energySite.provider === EnergyProvider.DEMO) {
          await tx.inverterCommand.update({
            where: { id: persisted.id },
            data: { status: CommandStatus.SENT },
          });
          vendorDispatchStarted = true;
          await new Promise((resolve) => setTimeout(resolve, 120));
          observedOptimizationOn =
            input.type === "turnon" ? true : input.type === "turnoff" ? false : null;
          stateVerified = true;
        } else if (currentInverter.energySite.provider === EnergyProvider.LEGACY_SPOTTEX) {
          const connection = await tx.energyConnection.findUnique({
            where: {
              userId_provider: {
                userId: input.userId,
                provider: EnergyProvider.LEGACY_SPOTTEX,
              },
            },
          });
          if (!connection) {
            if (intent.repeated && input.type === "turnon") {
              safetyDeactivationReason = "CONNECTION_NOT_FOUND";
              return markLockedCommandForSafetyReconciliation(
                tx,
                input,
                persisted.id,
                "Předchozí zapnutí není potvrzeno a připojení nelze použít k bezpečnostnímu vypnutí.",
                safetyDeactivationReason,
              );
            }
            return failLockedCommand(
              tx,
              input,
              persisted.id,
              "Energetický účet není připojen.",
              "CONNECTION_NOT_FOUND",
            );
          }
          let originalTokens: LegacyTokenSet;
          let client: LegacySpottexClient;
          try {
            originalTokens = tokensFromConnection(connection);
            client = new LegacySpottexClient({ tokens: originalTokens });
          } catch (error) {
            if (intent.repeated && input.type === "turnon") {
              safetyDeactivationReason = "CONNECTION_NOT_FOUND";
              return markLockedCommandForSafetyReconciliation(
                tx,
                input,
                persisted.id,
                "Předchozí zapnutí není potvrzeno a připojení vyžaduje obnovu před bezpečnostním vypnutím.",
                safetyDeactivationReason,
              );
            }
            return failLockedCommand(
              tx,
              input,
              persisted.id,
              error instanceof EnergyError
                ? error.message
                : "Připojení energetického účtu vyžaduje obnovení.",
              "CONNECTION_NOT_FOUND",
            );
          }
          await tx.inverterCommand.update({
            where: { id: persisted.id },
            data: { status: CommandStatus.SENT },
          });
          vendorDispatchStarted = true;
          await client.issueCommand(input.type, currentInverter.externalDeviceId);
          if (input.type === "turnon" || input.type === "turnoff") {
            // A 2xx command response only confirms acceptance by the legacy API.
            // Verify the resulting provider state before changing our local bit.
            await new Promise((resolve) => setTimeout(resolve, 250));
            observedOptimizationOn = await client.fetchOptimizationRunning(
              currentInverter.externalDeviceId,
            );
            const expectedOptimizationOn = input.type === "turnon";
            if (observedOptimizationOn !== expectedOptimizationOn) {
              throw new EnergyError(
                "LEGACY_UNAVAILABLE",
                "Energetická služba zatím nepotvrdila požadovaný stav řízení.",
                502,
              );
            }
            stateVerified = true;
          }
          await saveRefreshedTokens(connection.id, originalTokens, client, tx);
        } else {
          if (intent.repeated && input.type === "turnon") {
            safetyDeactivationReason = "PROVIDER_UNAVAILABLE";
            return markLockedCommandForSafetyReconciliation(
              tx,
              input,
              persisted.id,
              "Předchozí zapnutí není potvrzeno a poskytovatel není dostupný pro bezpečnostní vypnutí.",
              safetyDeactivationReason,
            );
          }
          return failLockedCommand(
            tx,
            input,
            persisted.id,
            "Tento typ střídače zatím nelze ovládat.",
            "PROVIDER_UNAVAILABLE",
          );
        }

        const completedAt = new Date();
        const optimizationOn =
          input.type === "turnon" ? true : input.type === "turnoff" ? false : undefined;
        if (optimizationOn !== undefined && stateVerified) {
          await tx.energySite.update({
            where: { id: site.id },
            data: { optimizationOn },
          });
        }
        const updated = await tx.inverterCommand.update({
          where: { id: persisted.id },
          data: {
            status: CommandStatus.ACKNOWLEDGED,
            response: { accepted: true, stateVerified, observedOptimizationOn },
            error: null,
            completedAt,
          },
        });

        let compensatedTurnons = 0;
        let compensatedTurnoffs = 0;
        if (input.type === "turnoff") {
          const compensatedOn = await tx.inverterCommand.updateMany({
            where: {
              inverterId: inverter.id,
              id: { not: persisted.id },
              type: "turnon",
              status: { in: [CommandStatus.PENDING, CommandStatus.SENT] },
              requestedAt: { lte: persisted.requestedAt },
            },
            data: {
              status: CommandStatus.CANCELED,
              response: { accepted: false, compensatedBy: persisted.id },
              error: "Nahrazeno bezpečnostním vypnutím řízení.",
              completedAt,
            },
          });
          compensatedTurnons = compensatedOn.count;
          const compensatedOff = await tx.inverterCommand.updateMany({
            where: {
              inverterId: inverter.id,
              id: { not: persisted.id },
              type: "turnoff",
              status: { in: [CommandStatus.PENDING, CommandStatus.SENT] },
              requestedAt: { lte: persisted.requestedAt },
            },
            data: {
              status: CommandStatus.CANCELED,
              response: { accepted: false, compensatedBy: persisted.id },
              error: "Nahrazeno novějším potvrzeným vypnutím řízení.",
              completedAt,
            },
          });
          compensatedTurnoffs = compensatedOff.count;
        }

        await tx.auditLog.create({
          data: {
            actorUserId: input.userId,
            action: "INVERTER_COMMAND_ACKNOWLEDGED",
            entityType: "InverterCommand",
            entityId: persisted.id,
            metadata: {
              siteId: site.id,
              command: input.type,
              compensatedTurnons,
              compensatedTurnoffs,
              reconciledIntent: intent.repeated,
            },
          },
        });
        if (intent.repeated) {
          await tx.auditLog.create({
            data: {
              actorUserId: input.userId,
              action: "INVERTER_COMMAND_RECONCILED",
              entityType: "InverterCommand",
              entityId: persisted.id,
              metadata: { siteId: site.id, command: input.type },
            },
          });
        }
        if (compensatedTurnons > 0) {
          await tx.auditLog.create({
            data: {
              actorUserId: input.userId,
              action: "INVERTER_TURNON_INTENTS_COMPENSATED",
              entityType: "Inverter",
              entityId: String(inverter.id),
              metadata: {
                siteId: site.id,
                turnoffCommandId: persisted.id,
                compensatedTurnons,
              },
            },
          });
        }
        if (compensatedTurnoffs > 0) {
          await tx.auditLog.create({
            data: {
              actorUserId: input.userId,
              action: "INVERTER_TURNOFF_INTENTS_COMPENSATED",
              entityType: "Inverter",
              entityId: String(inverter.id),
              metadata: {
                siteId: site.id,
                turnoffCommandId: persisted.id,
                compensatedTurnoffs,
              },
            },
          });
        }
        return updated;
      },
      { maxWait: 10_000, timeout: INVERTER_TRANSACTION_TIMEOUT_MS },
    );
    const committedSafetyReason = safetyDeactivationReason as string | null;
    if (committedSafetyReason) {
      await deactivateInverterControl(
        input.userId,
        `unresolved-${committedSafetyReason.toLowerCase()}-${intent.command.id}`,
      );
      const reconciled = await prisma.inverterCommand.findUniqueOrThrow({
        where: { id: intent.command.id },
      });
      return commandResult(reconciled, intent.repeated);
    }
    return commandResult(completed, intent.repeated);
  } catch (error) {
    // Once the request may have reached the vendor, FAILED would be unsafe: an
    // accepted turnon could disappear from reconciliation. Keep the committed
    // intent unresolved and emit a distinct audit record for the safety worker.
    const failedTransactionSafetyReason = safetyDeactivationReason as string | null;
    if (failedTransactionSafetyReason) {
      await deactivateInverterControl(
        input.userId,
        `unresolved-${failedTransactionSafetyReason.toLowerCase()}-${intent.command.id}`,
      );
      const reconciled = await prisma.inverterCommand.findUniqueOrThrow({
        where: { id: intent.command.id },
      });
      return commandResult(reconciled, intent.repeated);
    }
    const persisted = vendorDispatchStarted
      ? await recordUnknownCommandOutcome(input, intent.command.id, error)
      : await recordExecutionFailure(input, intent.command.id, error);
    return commandResult(persisted, intent.repeated);
  }
}

function siteCommandKey(base: string, siteId: number, inverterId: number, type: InverterCommandType) {
  const digest = createHash("sha256")
    .update(`${base}:${siteId}:${inverterId}:${type}`)
    .digest("hex")
    .slice(0, 40);
  return `site:${siteId}:${type}:${digest}`;
}

function sameOptionalNumber(left: number | null, right: number | null) {
  return left === right || (left !== null && right !== null && Math.abs(left - right) < 0.000_001);
}

async function syncLegacyControlProfile(input: {
  userId: number;
  site: {
    id: number;
    externalSiteId: string;
    provider: EnergyProvider;
    inverters: Array<{ id: number; externalDeviceId: string }>;
  };
  values: Awaited<ReturnType<typeof getLocalControlReadiness>>["values"];
}) {
  if (input.site.provider !== EnergyProvider.LEGACY_SPOTTEX) return;
  const values = input.values;
  if (
    !values.ean || !values.distributionTariffCode ||
    (values.buyPricingMode !== "FIX" && values.buyPricingMode !== "SPOT") ||
    (values.sellPricingMode !== "FIX" && values.sellPricingMode !== "SPOT")
  ) {
    throw new EnergyError("REQUIRED_INFO_MISSING", "Cenový profil není kompletní.", 409);
  }
  const connection = await prisma.energyConnection.findUnique({
    where: { userId_provider: { userId: input.userId, provider: EnergyProvider.LEGACY_SPOTTEX } },
  });
  if (!connection) throw new EnergyError("CONNECTION_NOT_FOUND", "Energetický účet není připojen.", 409);
  const before = tokensFromConnection(connection);
  const client = new LegacySpottexClient({ tokens: before });
  for (const inverter of input.site.inverters) {
    const providerBefore = record(await client.fetchTechnicalInfo(inverter.externalDeviceId));
    await client.updateControlProfile({
      deviceId: inverter.externalDeviceId,
      supplyPointId: input.site.externalSiteId,
      ean: values.ean,
      distributionTariffCode: values.distributionTariffCode,
      buyPricingMode: values.buyPricingMode,
      sellPricingMode: values.sellPricingMode,
      fixedBuyPriceCzkKwh: values.fixedBuyPriceCzkKwh,
      fixedSellPriceCzkKwh: values.fixedSellPriceCzkKwh,
      spotBuyFeeCzkKwh: values.spotBuyFeeCzkKwh,
      spotSellFeeCzkKwh: values.spotSellFeeCzkKwh,
      fixedPriceValidUntil: values.fixedPriceValidUntil,
      isVatPayer: providerBefore.is_vat_payer === true,
      isCompany: providerBefore.is_company === true,
    });
    const { mapped } = mapLegacyTechnicalValues(
      await client.fetchTechnicalInfo(inverter.externalDeviceId),
    );
    const matches =
      mapped.ean === values.ean &&
      mapped.distributionTariffCode === values.distributionTariffCode.toUpperCase() &&
      mapped.buyPricingMode === values.buyPricingMode &&
      mapped.sellPricingMode === values.sellPricingMode &&
      (values.buyPricingMode !== "FIX" || sameOptionalNumber(mapped.fixedBuyPriceCzkKwh, values.fixedBuyPriceCzkKwh)) &&
      (values.sellPricingMode !== "FIX" || sameOptionalNumber(mapped.fixedSellPriceCzkKwh, values.fixedSellPriceCzkKwh)) &&
      (values.buyPricingMode !== "SPOT" || sameOptionalNumber(mapped.spotBuyFeeCzkKwh, values.spotBuyFeeCzkKwh)) &&
      (values.sellPricingMode !== "SPOT" || sameOptionalNumber(mapped.spotSellFeeCzkKwh, values.spotSellFeeCzkKwh)) &&
      ((values.buyPricingMode !== "FIX" && values.sellPricingMode !== "FIX") ||
        mapped.fixedPriceValidUntil?.slice(0, 10) === values.fixedPriceValidUntil?.slice(0, 10));
    if (!matches) {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Řídicí backend nepotvrdil uložený tarif a ceny. Řízení nebylo zapnuto.",
        502,
      );
    }
  }
  await saveRefreshedTokens(connection.id, before, client);
}

/**
 * Applies one explicit user intent to every controllable inverter at a site.
 * A partially acknowledged ON is immediately compensated with verified OFF.
 */
export async function issueSiteControlCommand(input: {
  userId: number;
  siteId: number;
  type: InverterCommandType;
  idempotencyKey: string;
}) {
  const site = await prisma.energySite.findFirst({
    where: { id: input.siteId, userId: input.userId },
    select: {
      id: true,
      provider: true,
      externalSiteId: true,
      inverters: {
        where: { provider: { in: [EnergyProvider.DEMO, EnergyProvider.LEGACY_SPOTTEX] } },
        select: { id: true, externalDeviceId: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!site) throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  if (!site.inverters.length) {
    throw new EnergyError("INVERTER_NOT_FOUND", "Elektrárna nemá ovladatelný střídač.", 409);
  }

  if (input.type === "turnon") {
    const { readiness, values } = await getLocalControlReadiness(input.userId, input.siteId);
    if (!readiness.controlReady) {
      throw new EnergyError(
        "REQUIRED_INFO_MISSING",
        "Před zapnutím řízení doplňte technické limity i skutečné nákupní a výkupní ceny.",
        409,
      );
    }
    await syncLegacyControlProfile({ userId: input.userId, site, values });
    await prisma.$transaction([
      prisma.energySiteTechnicalProfile.update({
        where: { energySiteId: input.siteId },
        data: { controlConfirmedAt: new Date() },
      }),
      prisma.energySite.update({
        where: { id: input.siteId },
        data: { requiredInfo: false },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: input.userId,
          action: "ENERGY_CONTROL_INPUTS_CONFIRMED",
          entityType: "EnergySite",
          entityId: String(input.siteId),
          metadata: { source: "explicit-control-activation" },
        },
      }),
    ]);
  }

  const results: InverterCommandResult[] = [];
  const acknowledgedOn: number[] = [];
  try {
    for (const inverter of site.inverters) {
      const result = await issueInverterCommand({
        userId: input.userId,
        siteId: input.siteId,
        inverterId: inverter.id,
        type: input.type,
        idempotencyKey: siteCommandKey(input.idempotencyKey, input.siteId, inverter.id, input.type),
      });
      results.push(result);
      if (input.type === "turnon" && result.status === CommandStatus.ACKNOWLEDGED) {
        acknowledgedOn.push(inverter.id);
      }
      if (result.status !== CommandStatus.ACKNOWLEDGED) {
        throw new EnergyError(
          "LEGACY_UNAVAILABLE",
          "Energetická služba nepotvrdila příkaz na všech střídačích.",
          502,
        );
      }
    }
  } catch (error) {
    if (input.type === "turnon") {
      for (const inverterId of acknowledgedOn) {
        await issueInverterCommand({
          userId: input.userId,
          siteId: input.siteId,
          inverterId,
          type: "turnoff",
          idempotencyKey: siteCommandKey(`${input.idempotencyKey}:rollback`, input.siteId, inverterId, "turnoff"),
          safetyOverride: true,
        }).catch(() => undefined);
      }
      await prisma.energySite.update({ where: { id: input.siteId }, data: { optimizationOn: false } });
    } else if (input.type === "turnoff") {
      // Do not claim a site is OFF when one of its devices did not acknowledge.
      await prisma.energySite.update({ where: { id: input.siteId }, data: { optimizationOn: true } });
    }
    throw error;
  }
  await prisma.energySite.update({
    where: { id: input.siteId },
    data: input.type === "turnon"
      ? { optimizationOn: true }
      : input.type === "turnoff"
        ? { optimizationOn: false }
        : {},
  });
  return { commands: results };
}

export async function reconcileEntitledInverterCommands(options?: {
  olderThanMs?: number;
  limit?: number;
}) {
  const olderThanMs = Math.max(10_000, options?.olderThanMs ?? 60_000);
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
  const commands = await prisma.inverterCommand.findMany({
    where: {
      type: { in: ["turnon", "turnoff"] },
      status: { in: [CommandStatus.PENDING, CommandStatus.SENT] },
      requestedAt: { lte: new Date(Date.now() - olderThanMs) },
    },
    include: {
      inverter: {
        select: { energySite: { select: { id: true, userId: true } } },
      },
    },
    orderBy: { requestedAt: "asc" },
    take: limit,
  });

  let attempted = 0;
  let settled = 0;
  let unresolved = 0;
  let skippedUnentitled = 0;
  let errors = 0;
  for (const command of commands) {
    const { userId, id: siteId } = command.inverter.energySite;
    // Never turn a formerly authorized unresolved turnon into FAILED here. The
    // deactivation job owns that path and must converge it through a real off.
    if (!(await hasInverterControlEntitlement(userId))) {
      skippedUnentitled += 1;
      continue;
    }
    attempted += 1;
    try {
      const result = await issueInverterCommand({
        userId,
        siteId,
        inverterId: command.inverterId,
        type: command.type as "turnon" | "turnoff",
        idempotencyKey: command.idempotencyKey,
      });
      if (result.status === CommandStatus.PENDING || result.status === CommandStatus.SENT) {
        unresolved += 1;
      } else {
        settled += 1;
      }
    } catch (error) {
      errors += 1;
      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "INVERTER_COMMAND_RECONCILIATION_FAILED",
          entityType: "InverterCommand",
          entityId: command.id,
          metadata: {
            siteId,
            error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          },
        },
      });
    }
  }
  return {
    scanned: commands.length,
    attempted,
    settled,
    unresolved,
    skippedUnentitled,
    errors,
  };
}

function safetyIdempotencyKey(input: {
  userId: number;
  siteId: number;
  inverterId: number;
  bucket: number;
  reason: string;
  nonce: string;
}): string {
  const secret = process.env.AUTH_SECRET ?? process.env.APP_ENCRYPTION_KEY;
  if (!secret) throw new Error("Chybí serverový klíč pro bezpečnostní příkazy.");
  const digest = createHmac("sha256", secret)
    .update(`${input.userId}:${input.siteId}:${input.inverterId}:${input.bucket}:${input.reason}:${input.nonce}`)
    .digest("hex")
    .slice(0, 40);
  return `internal-safety:${input.siteId}:${input.inverterId}:${input.bucket}:${digest}`;
}

async function readSafetyConvergence(siteId: number, inverterId: number) {
  const [site, unresolvedTurnons, unresolvedTurnoffs] = await Promise.all([
    prisma.energySite.findUnique({
      where: { id: siteId },
      select: { optimizationOn: true },
    }),
    prisma.inverterCommand.count({
      where: {
        inverterId,
        type: "turnon",
        status: { in: [CommandStatus.PENDING, CommandStatus.SENT] },
      },
    }),
    prisma.inverterCommand.count({
      where: {
        inverterId,
        type: "turnoff",
        status: { in: [CommandStatus.PENDING, CommandStatus.SENT] },
      },
    }),
  ]);
  return { site, unresolvedTurnons, unresolvedTurnoffs };
}

export async function deactivateInverterControl(
  userId: number,
  reason: string,
  options: { onProgress?: () => Promise<void> } = {},
) {
  const sites = await prisma.energySite.findMany({
    where: {
      userId,
      // Local optimizationOn is only a cache. A prior crash, a manual vendor
      // change or stale telemetry can leave the physical inverter running while
      // this bit is false. Every controllable connected site therefore receives
      // a verified OFF command whenever entitlement is revoked.
      provider: { in: [EnergyProvider.DEMO, EnergyProvider.LEGACY_SPOTTEX] },
      inverters: {
        some: { provider: { in: [EnergyProvider.DEMO, EnergyProvider.LEGACY_SPOTTEX] } },
      },
    },
    select: {
      id: true,
      inverters: {
        where: { provider: { in: [EnergyProvider.DEMO, EnergyProvider.LEGACY_SPOTTEX] } },
        select: { id: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  const targets = sites.flatMap((site) =>
    site.inverters.map((inverter) => ({ siteId: site.id, inverterId: inverter.id })),
  );
  const bucket = Math.floor(Date.now() / 300_000);
  const results: InverterCommandResult[] = [];
  let failed = 0;
  for (const target of targets) {
    await options.onProgress?.();
    let lastResult: InverterCommandResult | null = null;
    let lastError: unknown = null;
    let convergence = await readSafetyConvergence(target.siteId, target.inverterId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await issueInverterCommand({
          userId,
          siteId: target.siteId,
          inverterId: target.inverterId,
          type: "turnoff",
          idempotencyKey: safetyIdempotencyKey({
            userId,
            siteId: target.siteId,
            inverterId: target.inverterId,
            bucket,
            reason,
            nonce: attempt === 0 ? "stable" : randomUUID(),
          }),
          safetyOverride: true,
        });
        lastResult = result;
        convergence = await readSafetyConvergence(target.siteId, target.inverterId);
        if (
          result.status === CommandStatus.ACKNOWLEDGED &&
          convergence.site?.optimizationOn === false &&
          convergence.unresolvedTurnons === 0 &&
          convergence.unresolvedTurnoffs === 0
        ) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastResult) results.push(lastResult);
    const converged =
      lastResult?.status === CommandStatus.ACKNOWLEDGED &&
      convergence.site?.optimizationOn === false &&
      convergence.unresolvedTurnons === 0 &&
      convergence.unresolvedTurnoffs === 0;
    if (!converged) {
      failed += 1;
      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "INVERTER_SAFETY_DEACTIVATION_FAILED",
          entityType: "Inverter",
          entityId: String(target.inverterId),
          metadata: {
            siteId: target.siteId,
            reason,
            commandId: lastResult?.id ?? null,
            commandStatus: lastResult?.status ?? null,
            optimizationOn: convergence.site?.optimizationOn ?? null,
            unresolvedTurnons: convergence.unresolvedTurnons,
            unresolvedTurnoffs: convergence.unresolvedTurnoffs,
            error:
              lastError instanceof Error ? lastError.message.slice(0, 300) : lastError ? "unknown" : null,
          },
        },
      });
    }
    await options.onProgress?.();
  }
  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: failed > 0 ? "INVERTER_SAFETY_DEACTIVATION_INCOMPLETE" : "INVERTER_SAFETY_DEACTIVATION_COMPLETED",
      entityType: "User",
      entityId: String(userId),
      metadata: {
        reason,
        attempted: targets.length,
        failed,
        commandIds: results.map((result) => result.id),
      },
    },
  });
  return { attempted: targets.length, failed, results };
}

function commandResult(
  command: {
    id: string;
    type: string;
    status: CommandStatus;
    requestedAt: Date;
    completedAt: Date | null;
  },
  repeated: boolean,
): InverterCommandResult {
  return {
    id: command.id,
    type: command.type as InverterCommandType,
    status: command.status,
    repeated,
    requestedAt: command.requestedAt.toISOString(),
    completedAt: command.completedAt?.toISOString() ?? null,
    message:
      command.status === CommandStatus.ACKNOWLEDGED
        ? command.type === "sync"
          ? "Technické údaje byly znovu načtené ze SolaX Cloud."
          : "Příkaz byl střídačem přijat."
        : command.status === CommandStatus.FAILED
          ? "Příkaz se nepodařilo provést."
          : command.status === CommandStatus.CANCELED
            ? "Příkaz byl bezpečně nahrazen novějším stavem."
          : "Příkaz se zpracovává.",
  };
}
