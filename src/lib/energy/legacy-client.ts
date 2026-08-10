import "server-only";

import { Secret, Token } from "fernet";

import { EnergyError } from "./types";
import { mapLegacyPlant } from "./mapping";
import type {
  EnergyDataIssue,
  EnergyDataSection,
  InverterCommandType,
  LegacyDashboardPayload,
  LegacyLoginResult,
  LegacyPlantCandidate,
  LegacyPlantDiscovery,
  LegacyTokenSet,
} from "./types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new EnergyError("LEGACY_UNAVAILABLE", "Původní energetická služba vrátila neplatná data.", 502);
  }
  return value as JsonObject;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new EnergyError("LEGACY_UNAVAILABLE", "Původní energetická služba vrátila neplatná data.", 502);
  }
  return value;
}

export function accessTokenExpiresAt(token: string): Date | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    const exp = typeof decoded.exp === "number" ? decoded.exp : Number(decoded.exp);
    return Number.isFinite(exp) ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

export class LegacySpottexClient {
  private readonly baseUrl: URL;
  private readonly fernetSecret: Secret;
  private tokens: LegacyTokenSet | null;

  constructor(options?: { baseUrl?: string; fernetKey?: string; tokens?: LegacyTokenSet }) {
    const configuredUrl = options?.baseUrl ?? process.env.SPOTTEX_LEGACY_API_URL;
    const fernetKey = options?.fernetKey ?? process.env.SPOTTEX_LEGACY_FERNET_KEY;
    if (!configuredUrl || !fernetKey) {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Napojení na původní energetickou službu není nakonfigurováno.",
        503,
      );
    }

    const parsedUrl = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new EnergyError("LEGACY_UNAVAILABLE", "Adresa energetické služby není platná.", 503);
    }
    parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/$/, "")}/`;
    parsedUrl.search = "";
    parsedUrl.hash = "";

    this.baseUrl = parsedUrl;
    try {
      this.fernetSecret = new Secret(fernetKey);
    } catch {
      throw new EnergyError("LEGACY_UNAVAILABLE", "Klíč energetické služby není platný.", 503);
    }
    this.tokens = options?.tokens ?? null;
  }

  static isConfigured(): boolean {
    return Boolean(process.env.SPOTTEX_LEGACY_API_URL && process.env.SPOTTEX_LEGACY_FERNET_KEY);
  }

  getTokens(): LegacyTokenSet | null {
    return this.tokens ? { ...this.tokens } : null;
  }

  async discoverPlants(email: string, password: string): Promise<LegacyPlantDiscovery> {
    let response: unknown;
    try {
      response = await this.requestEncrypted("discover_plants", {
        method: "POST",
        body: JSON.stringify({
          email: this.encryptString(email),
          password: this.encryptString(password),
        }),
        headers: { "Content-Type": "application/json" },
        timeoutMs: 120_000,
      });
    } catch (error) {
      if (error instanceof LegacyHttpError && error.status === 401) {
        throw new EnergyError(
          "INVALID_REQUEST",
          "E-mail nebo heslo k SolaX Cloud není správné.",
          401,
        );
      }
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Účet SolaX Cloud se nepodařilo ověřit. Zkuste to prosím znovu.",
        502,
      );
    }

    const payload = asObject(response);
    const discoveryId = requiredString(payload.discovery_id);
    const expiresInSeconds = this.optionalNumber(payload.expires_in_seconds) ?? 60 * 60;
    const rawPlants = Array.isArray(payload.plants) ? payload.plants : [];
    const plants = rawPlants.flatMap((raw): LegacyPlantCandidate[] => {
      const plant = asObject(raw);
      const plantId = plant.plant_id;
      if (typeof plantId !== "string" && typeof plantId !== "number") return [];
      const rawInverters = Array.isArray(plant.inverters) ? plant.inverters : [];
      const rawCoverage =
        plant.device_coverage !== null &&
        typeof plant.device_coverage === "object" &&
        !Array.isArray(plant.device_coverage)
          ? asObject(plant.device_coverage)
          : {};
      const coverageStatus = rawCoverage.status;
      return [{
        plantId: String(plantId),
        name: typeof plant.name === "string" && plant.name.trim()
          ? plant.name.trim()
          : "SolaX elektrárna",
        location: typeof plant.location === "string" ? plant.location.trim() : "",
        pvCapacityKwp: this.optionalNumber(plant.pv_capacity_kwp),
        batteryCapacityKwh: this.optionalNumber(plant.battery_capacity_kwh),
        createdAt: typeof plant.created_at === "string" ? plant.created_at : null,
        deviceCoverage: {
          status:
            coverageStatus === "COMPLETE" ||
            coverageStatus === "POSSIBLY_INCOMPLETE"
              ? coverageStatus
              : "UNKNOWN",
          availableRatedPowerKw: this.optionalNumber(
            rawCoverage.available_rated_power_kw,
          ),
          expectedCapacityKwp: this.optionalNumber(
            rawCoverage.expected_capacity_kwp,
          ),
          percent: this.optionalNumber(rawCoverage.percent),
          warning:
            typeof rawCoverage.warning === "string" &&
            rawCoverage.warning.trim()
              ? rawCoverage.warning.trim()
              : null,
        },
        inverters: rawInverters.map((rawInverter) => {
          const inverter = asObject(rawInverter);
          return {
            model: typeof inverter.model === "string" ? inverter.model : "SolaX",
            ratedPowerKw: this.optionalNumber(inverter.rated_power_kw),
            serialSuffix:
              typeof inverter.serial_suffix === "string" ? inverter.serial_suffix : "",
          };
        }),
      }];
    });
    return { discoveryId, expiresInSeconds, plants };
  }

  async registerPlants(
    plantIds: string[],
    discoveryId: string,
  ): Promise<LegacyLoginResult & { selectedSiteIds: string[] }> {
    let response: unknown;
    try {
      response = await this.requestEncrypted("register_selected", {
        method: "POST",
        body: JSON.stringify({
          plant_ids: this.encryptString(JSON.stringify(plantIds)),
          discovery_id: this.encryptString(discoveryId),
        }),
        headers: { "Content-Type": "application/json" },
        timeoutMs: 300_000,
      });
    } catch (error) {
      if (error instanceof LegacyHttpError && error.status === 409) {
        throw new EnergyError(
          "CONFLICT",
          "Vybraná elektrárna už je přiřazená k jinému účtu Spottex.",
          409,
        );
      }
      if (error instanceof LegacyHttpError && error.status === 404) {
        throw new EnergyError(
          "INVALID_REQUEST",
          "Vybraná elektrárna už v účtu SolaX Cloud není dostupná.",
          404,
        );
      }
      if (error instanceof LegacyHttpError && error.status === 410) {
        throw new EnergyError(
          "INVALID_REQUEST",
          "Výběr elektrárny vypršel. Načtěte seznam ze SolaX Cloud znovu.",
          410,
        );
      }
      if (error instanceof LegacyHttpError && error.status === 423) {
        throw new EnergyError(
          "CONFLICT",
          "Připojení této elektrárny už probíhá. Neodesílejte formulář znovu.",
          423,
        );
      }
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Vybranou elektrárnu se nepodařilo připojit. Zkuste to prosím znovu.",
        502,
      );
    }

    const payload = asObject(response);
    const accessToken = requiredString(payload.access_token);
    const refreshToken = requiredString(payload.refresh_token);
    const rawSelectedSiteIds = Array.isArray(payload.selected_supply_point_ids)
      ? payload.selected_supply_point_ids
      : [payload.selected_supply_point_id];
    const selectedSiteIds = rawSelectedSiteIds
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
      .map(String);
    if (selectedSiteIds.length !== plantIds.length) {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Energetická služba nepotvrdila všechny vybrané elektrárny.",
        502,
      );
    }
    this.tokens = { accessToken, refreshToken };
    const plants = (Array.isArray(payload.plants) ? payload.plants : [])
      .map(mapLegacyPlant)
      .filter((plant): plant is NonNullable<typeof plant> => plant !== null);
    return {
      accessToken,
      refreshToken,
      externalAccountId: requiredString(payload.external_account_id),
      plants,
      selectedSiteIds,
    };
  }

  async registerSelected(
    plantId: string,
    discoveryId: string,
  ): Promise<LegacyLoginResult & { selectedSiteId: string }> {
    const result = await this.registerPlants([plantId], discoveryId);
    return { ...result, selectedSiteId: result.selectedSiteIds[0] };
  }

  async login(email: string, password: string): Promise<LegacyLoginResult> {
    let response: unknown;
    try {
      response = await this.requestEncrypted("login", {
        method: "POST",
        // The legacy mobile API uses the shared Fernet transport contract for
        // credentials even though the response itself is encrypted separately.
        body: JSON.stringify({
          email: this.encryptString(email),
          password: this.encryptString(password),
        }),
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      // A 401 from /login means invalid credentials. Only authenticated
      // requests can use 401 to signal an expired access token.
      if (error instanceof LegacyHttpError && error.status === 401) {
        throw new EnergyError(
          "INVALID_REQUEST",
          "E-mail nebo heslo energetického účtu není správné.",
          401,
        );
      }
      throw error;
    }
    const payload = asObject(response);
    const accessToken = requiredString(payload.access_token);
    const refreshToken = requiredString(payload.refresh_token);
    this.tokens = { accessToken, refreshToken };
    const plants = (Array.isArray(payload.plants) ? payload.plants : [])
      .map(mapLegacyPlant)
      .filter((plant): plant is NonNullable<typeof plant> => plant !== null);

    const rawAccountId = payload.user_id ?? payload.account_id;
    return {
      accessToken,
      refreshToken,
      externalAccountId:
        typeof rawAccountId === "string" || typeof rawAccountId === "number"
          ? String(rawAccountId)
          : null,
      plants,
    };
  }

  async fetchDashboard(deviceId: string): Promise<LegacyDashboardPayload> {
    const issues: EnergyDataIssue[] = [];
    let successes = 0;

    const read = async (endpoint: string, section: EnergyDataSection, message: string) => {
      try {
        const value = await this.authenticatedEncryptedGet(endpoint, deviceId);
        successes += 1;
        return value;
      } catch {
        issues.push({ section, message });
        return {};
      }
    };

    // Keep these reads sequential. The legacy token refresh contract is not
    // concurrency-safe and concurrent 401 responses could rotate one token
    // several times. A failed optional section must not hide successful data.
    const soc = await read("soc", "battery", "Nepodařilo se načíst aktuální stav baterie.");
    const capacity = await read("capacity", "capacity", "Nepodařilo se načíst instalovaný výkon FVE.");
    const price = await read("ote_price", "prices", "Ceny elektřiny nejsou dostupné. Doplňte cenový produkt elektrárny.");
    const inverter = await read("inverter", "telemetry", "Nepodařilo se načíst aktuální výrobu a spotřebu.");
    const dailyEnergy = await read("daily_energy", "history", "Nepodařilo se načíst intervalovou historii energie.");
    const savings = await read("daily_savings", "savings", "Ověřený výpočet úspor zatím není dostupný.");
    const schedule = await read("inverter_schedule", "schedule", "Plán chytrého řízení zatím není dostupný.");

    if (successes === 0) {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Energetická služba nevrátila žádnou dostupnou část dat.",
        502,
      );
    }

    return { soc, capacity, price, inverter, dailyEnergy, savings, schedule, issues };
  }

  async fetchAdditionalTelemetry(deviceId: string): Promise<LegacyDashboardPayload> {
    const issues: EnergyDataIssue[] = [];
    const read = async (
      endpoint: string,
      section: EnergyDataSection,
      message: string,
    ) => {
      try {
        return await this.authenticatedEncryptedGet(endpoint, deviceId);
      } catch {
        issues.push({ section, message });
        return {};
      }
    };
    const inverter = await read(
      "inverter",
      "telemetry",
      "Nepodařilo se načíst aktuální hodnoty dalšího střídače.",
    );
    const dailyEnergy = await read(
      "daily_energy",
      "history",
      "Nepodařilo se načíst intervaly dalšího střídače.",
    );
    return {
      soc: {},
      capacity: {},
      price: {},
      inverter,
      dailyEnergy,
      savings: {},
      schedule: {},
      issues,
    };
  }

  async issueCommand(type: InverterCommandType, deviceId: string): Promise<unknown> {
    const endpoint = type === "sync" ? "sync_inverter" : type;
    return this.authenticatedCommand(endpoint, deviceId);
  }

  async fetchTechnicalInfo(deviceId: string): Promise<unknown> {
    return this.authenticatedEncryptedGet("inverter_user_info", deviceId);
  }

  async updateControlProfile(input: {
    deviceId: string;
    supplyPointId: string;
    ean: string;
    distributionTariffCode: string;
    buyPricingMode: "FIX" | "SPOT";
    sellPricingMode: "FIX" | "SPOT";
    fixedBuyPriceCzkKwh: number | null;
    fixedSellPriceCzkKwh: number | null;
    spotBuyFeeCzkKwh: number | null;
    spotSellFeeCzkKwh: number | null;
    fixedPriceValidUntil: string | null;
    isVatPayer: boolean;
    isCompany: boolean;
  }): Promise<void> {
    if (!this.tokens) {
      throw new EnergyError("CONNECTION_NOT_FOUND", "Energetický účet není připojen.", 409);
    }
    const body = new URLSearchParams();
    const set = (key: string, value: string | number | boolean | null) => {
      body.set(key, this.encryptString(value === null ? "" : String(value)));
    };
    set("device_id", input.deviceId);
    set("supply_point_id", input.supplyPointId);
    set("DPH", input.isVatPayer ? 1 : 0);
    set("userType", input.isCompany ? 1 : 0);
    set("buy_tariff", input.buyPricingMode);
    set("sell_tariff", input.sellPricingMode);
    set("tariffType", input.distributionTariffCode);
    set("EAN", input.ean);
    set("fix_buy_price", input.fixedBuyPriceCzkKwh ?? 0);
    set("fix_sell_price", input.fixedSellPriceCzkKwh ?? 0);
    set("buy_supplier_fee", input.spotBuyFeeCzkKwh ?? 0);
    set("sell_supplier_fee", input.spotSellFeeCzkKwh ?? 0);
    set("fix_end_date", input.fixedPriceValidUntil?.slice(0, 10) ?? "");

    const execute = async () => {
      const response = await this.requestRaw("update_supply_point", {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${this.tokens?.accessToken ?? ""}`,
          "x-refresh-token": this.tokens?.refreshToken ?? "",
        },
        timeoutMs: 30_000,
      });
      if (!response.ok) throw new LegacyHttpError(response.status);
    };
    try {
      await execute();
    } catch (error) {
      if (!(error instanceof LegacyHttpError) || error.status !== 401) throw error;
      await this.refresh();
      await execute();
    }
  }

  async fetchHistoricalIntervals(deviceId: string, from: Date, to: Date): Promise<unknown> {
    const configuredPath = process.env.SPOTTEX_LEGACY_HISTORY_PATH;
    if (!configuredPath) {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Legacy server zatím nevystavuje bezpečný endpoint pro historické intervaly. Nastavte SPOTTEX_LEGACY_HISTORY_PATH až po jeho nasazení.",
        503,
      );
    }
    const url = new URL(configuredPath, this.baseUrl);
    url.searchParams.set("device_id", deviceId);
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", to.toISOString());
    return this.authenticatedEncryptedRequest(url);
  }

  async fetchMarketIntervals(from: Date, to: Date): Promise<unknown> {
    const configuredPath =
      process.env.SPOTTEX_LEGACY_MARKET_PATH || "/market_intervals";
    const url = new URL(configuredPath, this.baseUrl);
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", to.toISOString());
    return this.authenticatedEncryptedRequest(url);
  }

  async fetchOptimizationRunning(deviceId: string): Promise<boolean> {
    const inverter = asObject(await this.authenticatedEncryptedGet("inverter", deviceId));
    if (!("optimization_running" in inverter)) {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Energetická služba nepotvrdila stav chytrého řízení.",
        502,
      );
    }
    const value = inverter.optimization_running;
    if (value === true || value === 1 || value === "1" || value === "true") return true;
    if (value === false || value === 0 || value === "0" || value === "false") return false;
    throw new EnergyError(
      "LEGACY_UNAVAILABLE",
      "Energetická služba vrátila neplatný stav chytrého řízení.",
      502,
    );
  }

  private async authenticatedCommand(endpoint: string, deviceId: string): Promise<{ accepted: true }> {
    if (!this.tokens) {
      throw new EnergyError("CONNECTION_NOT_FOUND", "Energetický účet není připojen.", 409);
    }

    const execute = async () => {
      const response = await this.requestRaw(endpoint, {
        method: "POST",
        body: JSON.stringify({ device_id: this.encryptString(deviceId) }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.tokens?.accessToken ?? ""}`,
          "x-refresh-token": this.tokens?.refreshToken ?? "",
        },
      });
      if (!response.ok) throw new LegacyHttpError(response.status);
      // The legacy Flutter client only checked the HTTP status for commands.
      // Deliberately do not forward its response body across our trust boundary.
      return { accepted: true as const };
    };

    try {
      return await execute();
    } catch (error) {
      if (!(error instanceof LegacyHttpError) || error.status !== 401) throw error;
      await this.refresh();
      return execute();
    }
  }

  private async authenticatedEncryptedGet(endpoint: string, deviceId: string): Promise<unknown> {
    const url = new URL(endpoint, this.baseUrl);
    url.searchParams.set("device_id", deviceId);
    return this.authenticatedEncryptedRequest(url);
  }

  private async authenticatedEncryptedRequest(
    endpoint: string | URL,
    options: { method?: "GET" | "POST"; body?: string; command?: boolean } = {},
  ): Promise<unknown> {
    if (!this.tokens) {
      throw new EnergyError("CONNECTION_NOT_FOUND", "Energetický účet není připojen.", 409);
    }

    const execute = () =>
      this.requestEncrypted(endpoint, {
        method: options.method ?? "GET",
        body: options.body,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${this.tokens?.accessToken ?? ""}`,
          ...(options.command ? { "x-refresh-token": this.tokens?.refreshToken ?? "" } : {}),
        },
      });

    try {
      return await execute();
    } catch (error) {
      if (!(error instanceof LegacyHttpError) || error.status !== 401) throw error;
      await this.refresh();
      return execute();
    }
  }

  private async refresh(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new EnergyError("CONNECTION_NOT_FOUND", "Připojení energetického účtu vyžaduje obnovení.", 409);
    }
    const refreshToken = this.tokens.refreshToken;
    const payload = asObject(
      await this.requestEncrypted("refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshToken}` },
      }),
    );
    this.tokens = {
      accessToken: requiredString(payload.access_token),
      refreshToken:
        typeof payload.refresh_token === "string" && payload.refresh_token
          ? payload.refresh_token
          : refreshToken,
    };
  }

  private async requestEncrypted(
    endpoint: string | URL,
    init: { method: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
  ): Promise<unknown> {
    const response = await this.requestRaw(endpoint, init);
    if (!response.ok) throw new LegacyHttpError(response.status);

    let envelope: JsonObject;
    try {
      envelope = asObject(await response.json());
    } catch {
      throw new EnergyError("LEGACY_UNAVAILABLE", "Energetická služba vrátila neplatnou odpověď.", 502);
    }

    const encrypted = requiredString(envelope.encrypted_data);
    try {
      const decrypted = new Token({ secret: this.fernetSecret, token: encrypted, ttl: 0 }).decode();
      return JSON.parse(decrypted) as unknown;
    } catch {
      throw new EnergyError("LEGACY_UNAVAILABLE", "Odpověď energetické služby nelze ověřit.", 502);
    }
  }

  private async requestRaw(
    endpoint: string | URL,
    init: { method: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
  ): Promise<Response> {
    const url = endpoint instanceof URL ? endpoint : new URL(endpoint, this.baseUrl);
    try {
      return await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        cache: "no-store",
        signal: AbortSignal.timeout(init.timeoutMs ?? 12_000),
      });
    } catch {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Původní energetická služba je dočasně nedostupná.",
        502,
      );
    }
  }

  private encryptString(value: string): string {
    try {
      return new Token({ secret: this.fernetSecret }).encode(value);
    } catch {
      throw new EnergyError(
        "LEGACY_UNAVAILABLE",
        "Požadavek pro energetickou službu nelze bezpečně připravit.",
        503,
      );
    }
  }

  private optionalNumber(value: unknown): number | null {
    if (typeof value === "string" && value.trim() === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }
}

class LegacyHttpError extends EnergyError {
  constructor(public readonly status: number) {
    super(
      "LEGACY_UNAVAILABLE",
      status === 401
        ? "Přihlášení k energetické službě vypršelo."
        : "Energetická služba požadavek nepřijala.",
      status === 401 ? 401 : 502,
    );
  }
}
