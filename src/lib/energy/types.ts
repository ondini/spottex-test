export type EnergyDataSource = "LIVE" | "CACHE" | "DEMO";

export type EnergyDataSection =
  | "telemetry"
  | "battery"
  | "capacity"
  | "prices"
  | "history"
  | "savings"
  | "schedule";

export type EnergyDataIssue = {
  section: EnergyDataSection;
  message: string;
};

export type EnergySiteSummary = {
  id: number;
  name: string;
  provider: "LEGACY_SPOTTEX" | "GRIDLINK" | "DEMO";
  status: "ONLINE" | "OFFLINE" | "ONBOARDING" | "ERROR";
  optimizationOn: boolean;
  requiredInfo: boolean;
  lastSyncedAt: string | null;
};

export type EnergyCurrentValues = {
  productionKw: number | null;
  consumptionKw: number | null;
  gridKw: number | null;
  batteryKw: number | null;
  batterySocPct: number | null;
  batteryCapacityKwh: number | null;
  pvCapacityKwp: number | null;
  buyPriceCzk: number | null;
  sellPriceCzk: number | null;
};

export type EnergySeriesPoint = {
  at: string;
  endAt: string;
  predicted: boolean;
  productionKwh: number;
  consumptionKwh: number;
  batteryKwh: number;
  batterySocKwh?: number | null;
  batteryCapacityKwh?: number | null;
  batterySocPct?: number | null;
  gridImportKwh: number;
  gridExportKwh: number;
};

export type EnergySavings = {
  todayCzk: number;
  weekCzk: number;
  monthCzk: number;
  yearCzk: number;
};

export type EnergyScheduleItem = {
  startAt: string;
  endAt: string;
  mode: string;
  sellKw: number | null;
  buyKw: number | null;
  batteryKw: number | null;
  targetSocPct: number | null;
  costCzk: number | null;
};

export type EnergyDashboardSnapshot = {
  generatedAt: string;
  dataAsOf: string | null;
  dataTimestampKind: "MEASURED" | "RECEIVED" | "CACHED";
  source: EnergyDataSource;
  stale: boolean;
  warning: string | null;
  issues: EnergyDataIssue[];
  sites: EnergySiteSummary[];
  selectedSiteId: number;
  inverterCount: number;
  current: EnergyCurrentValues;
  dailySeries: EnergySeriesPoint[];
  savings: EnergySavings;
  schedule: EnergyScheduleItem[];
  history: EnergyHistoryStatus;
};

export type EnergyHistoryStatus = {
  importStatus:
    | "NOT_STARTED"
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "PARTIAL"
    | "FAILED"
    | "CANCELED";
  progressPercent: number;
  importedPoints: number;
  totalChunks: number;
  succeededChunks: number;
  failedChunks: number;
  dataFrom: string | null;
  dataTo: string | null;
  coverageDays: number;
  spanDays: number;
  coveragePercent: number;
  confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  readyForEstimate: boolean;
  minimumDays: number;
  message: string;
};

export type LegacyPlant = {
  siteId: string;
  deviceId: string;
  name: string;
  optimizationOn: boolean;
  requiredInfo: boolean;
  location: string | null;
  pvCapacityKwp: number | null;
  batteryCapacityKwh: number | null;
  inverterModel: string | null;
  inverterRatedPowerKw: number | null;
  inverterSerialSuffix: string | null;
  deviceCoverageStatus: "COMPLETE" | "POSSIBLY_INCOMPLETE" | "UNKNOWN";
  availableInverterRatedPowerKw: number | null;
  deviceCoveragePercent: number | null;
};

export type LegacyPlantCandidate = {
  plantId: string;
  name: string;
  location: string;
  pvCapacityKwp: number | null;
  batteryCapacityKwh: number | null;
  createdAt: string | null;
  deviceCoverage: {
    status: "COMPLETE" | "POSSIBLY_INCOMPLETE" | "UNKNOWN";
    availableRatedPowerKw: number | null;
    expectedCapacityKwp: number | null;
    percent: number | null;
    warning: string | null;
  };
  inverters: Array<{
    model: string;
    ratedPowerKw: number | null;
    serialSuffix: string;
  }>;
};

export type LegacyPlantDiscovery = {
  discoveryId: string;
  expiresInSeconds: number;
  plants: LegacyPlantCandidate[];
};

export type LegacyTokenSet = {
  accessToken: string;
  refreshToken: string;
};

export type LegacyLoginResult = LegacyTokenSet & {
  externalAccountId: string | null;
  plants: LegacyPlant[];
};

export type LegacyDashboardPayload = {
  soc: unknown;
  capacity: unknown;
  price: unknown;
  inverter: unknown;
  dailyEnergy: unknown;
  savings: unknown;
  schedule: unknown;
  issues: EnergyDataIssue[];
};

export type InverterCommandType = "turnon" | "turnoff" | "sync";

export type InverterCommandResult = {
  id: string;
  type: InverterCommandType;
  status: "PENDING" | "SENT" | "ACKNOWLEDGED" | "FAILED" | "CANCELED";
  repeated: boolean;
  requestedAt: string;
  completedAt: string | null;
  message: string;
};

export type EnergyApiErrorCode =
  | "NO_SITES"
  | "SITE_NOT_FOUND"
  | "INVERTER_NOT_FOUND"
  | "CONNECTION_NOT_FOUND"
  | "LEGACY_UNAVAILABLE"
  | "REQUIRED_INFO_MISSING"
  | "COMMAND_COOLDOWN"
  | "SUBSCRIPTION_REQUIRED"
  | "CONFLICT"
  | "INVALID_REQUEST";

/**
 * Non-sensitive technical context for a failed energy operation. It exists so
 * an operator can tell "the plant list expired" apart from "the backend
 * rejected our request shape" without reading server logs. Never put
 * credentials, tokens, or full request bodies in here.
 */
export type EnergyErrorDetail = {
  /** Which step of the flow failed, e.g. "discover_plants". */
  stage: string;
  /** Upstream HTTP status, when the failure came from an external service. */
  upstreamStatus?: number;
  /** Sanitized upstream message, when the external service returned one. */
  upstreamMessage?: string;
};

export class EnergyError extends Error {
  constructor(
    public readonly code: EnergyApiErrorCode,
    message: string,
    public readonly status = 400,
    public readonly detail?: EnergyErrorDetail,
  ) {
    super(message);
    this.name = "EnergyError";
  }
}
