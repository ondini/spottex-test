"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BatteryCharging,
  CheckCircle2,
  CloudOff,
  Gauge,
  HousePlug,
  Link2,
  LoaderCircle,
  Mail,
  Plus,
  ReceiptText,
  RefreshCw,
  SunMedium,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { PageHeader, StatusBadge } from "@/components/app-shell/PagePrimitives";
import type {
  EnergyDashboardSnapshot,
  LegacyPlantCandidate,
} from "@/lib/energy/types";
import { trackEvent } from "@/lib/client-analytics";

type ApiError = {
  error?: string;
  code?: string;
  reference?: string;
  detail?: { stage?: string; upstreamStatus?: number; upstreamMessage?: string };
  requiresCredentials?: boolean;
  connectorConfigured?: boolean;
  message?: string;
  requiresSelection?: boolean;
  discoveryId?: string;
  expiresInSeconds?: number;
  plants?: LegacyPlantCandidate[];
  queuedHistoryImports?: number;
  connectedSiteIds?: number[];
};

/** What the connect form shows when a step fails, beyond the plain message. */
type ConnectFailure = {
  message: string;
  code?: string;
  reference?: string;
  stage?: string;
  upstreamStatus?: number;
  upstreamMessage?: string;
};

type ConnectedEnergyAccount = {
  connectedSiteIds: number[];
  queuedHistoryImports: number;
};

type CachedPlantSelection = {
  accountEmail: string;
  discoveryId: string;
  expiresAt: number;
  plants: LegacyPlantCandidate[];
};

const plantSelectionStorageKey = "spottex:solax-plant-selection:v1";

const numberFormat = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });
const energyNumberFormat = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dayPluralRules = new Intl.PluralRules("cs-CZ");

function formatEnergy(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? `${energyNumberFormat.format(numeric)} kWh` : "—";
}

function formatValue(value: number | null, unit: string): string {
  return value == null ? "—" : `${numberFormat.format(Math.abs(value))} ${unit}`;
}

function formatCompleteDays(value: number): string {
  const suffix = dayPluralRules.select(value) === "one"
    ? "úplný den"
    : dayPluralRules.select(value) === "few"
      ? "úplné dny"
      : "úplných dní";
  return `${numberFormat.format(value)} ${suffix}`;
}

function ConnectLegacyAccount({ compact = false, configured = true, emptyState = false, onConnected }: { compact?: boolean; configured?: boolean; emptyState?: boolean; onConnected: (result: ConnectedEnergyAccount) => void }) {
  const [open, setOpen] = useState(!compact);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [plants, setPlants] = useState<LegacyPlantCandidate[]>([]);
  const [selectedPlantIds, setSelectedPlantIds] = useState<string[]>([]);
  const [discoveryId, setDiscoveryId] = useState<string>("");
  const [accountEmail, setAccountEmail] = useState<string>("");
  const [selectionExpiresAt, setSelectionExpiresAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "discovering" | "selecting" | "connecting" | "history">("idle");
  // The registration step re-verifies the SolaX credentials, so they are kept
  // in memory for the second request only. They are never cached in
  // sessionStorage, which is why a restored selection has to ask again.
  const [password, setPassword] = useState<string>("");
  const [passwordNeeded, setPasswordNeeded] = useState(false);

  useEffect(() => {
    try {
      const storedSelection = window.sessionStorage.getItem(plantSelectionStorageKey);
      if (!storedSelection) return;
      const cached = JSON.parse(storedSelection) as Partial<CachedPlantSelection>;
      if (
        typeof cached.discoveryId !== "string" ||
        typeof cached.accountEmail !== "string" ||
        typeof cached.expiresAt !== "number" ||
        cached.expiresAt <= Date.now() ||
        !Array.isArray(cached.plants) ||
        cached.plants.length === 0
      ) {
        window.sessionStorage.removeItem(plantSelectionStorageKey);
        return;
      }
      setPlants(cached.plants);
      setDiscoveryId(cached.discoveryId);
      setAccountEmail(cached.accountEmail);
      setSelectionExpiresAt(cached.expiresAt);
      setPhase("selecting");
      setPasswordNeeded(true);
      setStatusMessage(`Pokračujte výběrem jedné nebo více z ${cached.plants.length} nalezených elektráren.`);
    } catch {
      clearCachedSelection();
    }
  }, []);

  function clearCachedSelection() {
    try {
      window.sessionStorage.removeItem(plantSelectionStorageKey);
    } catch {
      // Soukromý režim nebo zásady prohlížeče mohou sessionStorage zakázat.
    }
  }

  function cacheSelection(selection: CachedPlantSelection) {
    try {
      window.sessionStorage.setItem(plantSelectionStorageKey, JSON.stringify(selection));
    } catch {
      // Výběr stále funguje v otevřené stránce, i když úložiště není dostupné.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selecting = plants.length > 0;
    // Discovery reads both fields from the form; registration reuses the
    // verified account and takes the password from state, or from the field
    // shown again after a page reload dropped it.
    const email = selecting ? accountEmail : String(form.get("email") || "");
    const submittedPassword = String(form.get("password") || "");
    const effectivePassword = selecting
      ? passwordNeeded
        ? submittedPassword
        : password
      : submittedPassword;

    if (selecting && !effectivePassword) {
      setPasswordNeeded(true);
      setFailure({
        message: "Pro dokončení připojení zadejte znovu heslo k účtu SolaX Cloud.",
      });
      setPhase("selecting");
      return;
    }

    setSubmitting(true);
    setFailure(null);
    setStatusMessage(null);
    setPhase(selecting ? "connecting" : "discovering");
    try {
      const response = await fetch("/api/app/energy/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: effectivePassword,
          ...(selecting ? { plantIds: selectedPlantIds, discoveryId } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        if (payload.requiresCredentials) setPasswordNeeded(true);
        setFailure({
          message: payload.error || `Účet se nepodařilo připojit (HTTP ${response.status}).`,
          code: payload.code,
          reference: payload.reference,
          stage: payload.detail?.stage,
          upstreamStatus: payload.detail?.upstreamStatus,
          upstreamMessage: payload.detail?.upstreamMessage,
        });
        setPhase(selecting ? "selecting" : "idle");
        return;
      }
      if (payload.requiresSelection && payload.plants?.length && payload.discoveryId) {
        const expiresAt = Date.now() + (payload.expiresInSeconds ?? 3600) * 1000;
        setPlants(payload.plants);
        setSelectedPlantIds([]);
        setDiscoveryId(payload.discoveryId);
        setAccountEmail(email);
        setPassword(effectivePassword);
        setPasswordNeeded(false);
        setSelectionExpiresAt(expiresAt);
        cacheSelection({
          accountEmail: email,
          discoveryId: payload.discoveryId,
          expiresAt,
          plants: payload.plants,
        });
        formElement.reset();
        setPhase("selecting");
        setStatusMessage(
          `Vyberte jednu nebo více z ${payload.plants.length} nalezených elektráren.`,
        );
        return;
      }
      setPhase("history");
      setStatusMessage(
        payload.queuedHistoryImports
          ? `Připojeno. Zahajuji přípravu historie pro ${payload.queuedHistoryImports} ${
              payload.queuedHistoryImports === 1 ? "elektrárnu" : "elektráren"
            }…`
          : payload.message || "Elektrárna je připojená.",
      );
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      formElement.reset();
      setPlants([]);
      setSelectedPlantIds([]);
      setDiscoveryId("");
      setAccountEmail("");
      setPassword("");
      setPasswordNeeded(false);
      setSelectionExpiresAt(null);
      clearCachedSelection();
      setOpen(false);
      onConnected({
        connectedSiteIds: payload.connectedSiteIds ?? [],
        queuedHistoryImports: payload.queuedHistoryImports ?? 0,
      });
    } catch (error) {
      setFailure({
        message:
          error instanceof Error
            ? `Požadavek na server se nepodařilo dokončit: ${error.message}`
            : "Účet se nepodařilo připojit.",
        stage: selecting ? "register_selected" : "discover_plants",
      });
      setPhase(selecting ? "selecting" : "idle");
    } finally {
      setSubmitting(false);
    }
  }

  function changeAccount() {
    setPlants([]);
    setSelectedPlantIds([]);
    setDiscoveryId("");
    setAccountEmail("");
    setPassword("");
    setPasswordNeeded(false);
    setSelectionExpiresAt(null);
    clearCachedSelection();
    setFailure(null);
    setStatusMessage(null);
    setPhase("idle");
  }

  function togglePlant(plantId: string) {
    setSelectedPlantIds((current) =>
      current.includes(plantId)
        ? current.filter((id) => id !== plantId)
        : [...current, plantId],
    );
  }

  if (compact && !open) {
    return (
      <button type="button" className="app-button app-button-secondary" onClick={() => setOpen(true)}>
        <Link2 className="size-4" /> Připojit SolaX Cloud
      </button>
    );
  }

  return (
    <section className={`${compact ? "app-card mt-5" : emptyState ? "app-card w-full" : "mx-auto w-full max-w-lg"} p-5 sm:p-6`}>
      {emptyState && <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Připojte svoji elektrárnu</h1>}
      {!configured && (
        <p className="mt-5 rounded-xl bg-warning-50 px-4 py-3 text-sm leading-6 text-warning-600">
          Read-only konektor zatím není na tomto serveru nakonfigurovaný. Správce musí doplnit interní API adresu a Fernet klíč podle <code>docs/INTEGRATIONS_AND_SECRETS.md</code>.
        </p>
      )}
      <form onSubmit={submit} className={`grid gap-3 ${emptyState ? "mt-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" : "mt-5 sm:grid-cols-2"}`}>
        {plants.length === 0 ? <>
          <label className={`text-sm font-medium text-slate-700 ${emptyState ? "lg:h-full" : ""}`}>
            <span className={emptyState ? "sr-only" : undefined}>E-mail do SolaX Cloud</span>
            <input className={`app-input ${emptyState ? "lg:h-full" : "mt-1.5"}`} type="email" name="email" autoComplete="email" placeholder={emptyState ? "E-mail do SolaX Cloud" : undefined} required disabled={!configured} />
          </label>
          <label className={`text-sm font-medium text-slate-700 ${emptyState ? "lg:h-full" : ""}`}>
            <span className={emptyState ? "sr-only" : undefined}>Heslo do SolaX Cloud</span>
            <input className={`app-input ${emptyState ? "lg:h-full" : "mt-1.5"}`} type="password" name="password" autoComplete="current-password" placeholder={emptyState ? "Heslo do SolaX Cloud" : undefined} required disabled={!configured} />
          </label>
        </> : <div className={`${emptyState ? "lg:col-span-3" : "sm:col-span-2"} grid gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <span className="text-slate-600">Účet <strong className="text-slate-900">{accountEmail}</strong> je bezpečně ověřený.</span>
            <span className="text-xs text-slate-500">
              Výběr je uložený do {selectionExpiresAt ? new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(selectionExpiresAt) : "60 minut"}.
            </span>
          </div>
          {/* The password is never cached, so a reloaded selection has to ask
              for it again before the registration step can run. */}
          {passwordNeeded && (
            <label className="text-sm font-medium text-slate-700">
              Heslo do SolaX Cloud
              <input className="app-input mt-1.5" type="password" name="password" autoComplete="current-password" required disabled={!configured} />
              <span className="mt-1.5 block text-xs font-normal text-slate-500">
                Připojení elektrárny potvrzuje účet ještě jednou, proto heslo zadejte prosím znovu.
              </span>
            </label>
          )}
        </div>}
        {plants.length > 0 && (
          <fieldset className={`grid gap-3 ${emptyState ? "lg:col-span-3" : "sm:col-span-2"}`}>
            <legend className="sr-only">Elektrárny k připojení</legend>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">
                Vyberte elektrárny, které chcete připojit
              </p>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  className="font-semibold text-brand-700 hover:text-brand-600"
                  onClick={() =>
                    setSelectedPlantIds(plants.map((plant) => plant.plantId))
                  }
                  disabled={submitting || selectedPlantIds.length === plants.length}
                >
                  Vybrat vše
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  className="font-semibold text-slate-600 hover:text-slate-900"
                  onClick={() => setSelectedPlantIds([])}
                  disabled={submitting || selectedPlantIds.length === 0}
                >
                  Zrušit výběr
                </button>
              </div>
            </div>
            <div className="grid max-h-96 gap-2 overflow-y-auto pr-1">
              {plants.map((plant) => (
                <label
                  key={plant.plantId}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${
                    selectedPlantIds.includes(plant.plantId)
                      ? "border-brand-500 bg-brand-50"
                      : "border-slate-200 bg-white hover:border-brand-300"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <input
                      className="mt-0.5 size-5 shrink-0 accent-brand-600"
                      type="checkbox"
                      name="plantId"
                      value={plant.plantId}
                      checked={selectedPlantIds.includes(plant.plantId)}
                      onChange={() => togglePlant(plant.plantId)}
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900">{plant.name}</span>
                      <span className="mt-1 block text-sm text-slate-600">
                        {[
                          plant.location,
                          plant.pvCapacityKwp == null ? null : `${numberFormat.format(plant.pvCapacityKwp)} kWp`,
                          plant.batteryCapacityKwh == null ? null : `baterie ${numberFormat.format(plant.batteryCapacityKwh)} kWh`,
                        ].filter(Boolean).join(" · ")}
                      </span>
                      {plant.inverters.length > 0 && (
                        <span className="mt-1 block text-xs text-slate-500">
                          SolaX zpřístupňuje {plant.inverters.length} {
                            plant.inverters.length === 1 ? "střídač" : plant.inverters.length < 5 ? "střídače" : "střídačů"
                          }:{" "}
                          {plant.inverters.map((inverter) =>
                            `${inverter.model}${inverter.serialSuffix ? ` · …${inverter.serialSuffix}` : ""}`
                          ).join(", ")}
                        </span>
                      )}
                    </span>
                  </span>
                  {plant.deviceCoverage.status === "POSSIBLY_INCOMPLETE" && (
                    <span className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>
                        {plant.deviceCoverage.warning}
                        {plant.deviceCoverage.availableRatedPowerKw != null &&
                          plant.deviceCoverage.expectedCapacityKwp != null && (
                            <> Dostupný výkon je {numberFormat.format(plant.deviceCoverage.availableRatedPowerKw)} z {numberFormat.format(plant.deviceCoverage.expectedCapacityKwp)} kW.</>
                          )}
                      </span>
                    </span>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Vybráno {selectedPlantIds.length} z {plants.length}. Připojíme pouze zařízení, která účet SolaX skutečně zpřístupňuje.
            </p>
          </fieldset>
        )}
        {phase !== "idle" && (
          <div className={`${emptyState ? "lg:col-span-3" : "sm:col-span-2"} rounded-2xl border border-brand-100 bg-brand-50/70 p-4`} role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-slate-900">
                {phase === "discovering" && "Ověřujeme účet SolaX Cloud"}
                {phase === "selecting" && `Našli jsme ${plants.length} elektráren`}
                {phase === "connecting" && "Bezpečně připojujeme vybrané elektrárny"}
                {phase === "history" && "Připravujeme historická data"}
              </span>
              {phase === "selecting" || phase === "history"
                ? <CheckCircle2 className="size-5 text-brand-600" />
                : <LoaderCircle className="size-5 animate-spin text-brand-600" />}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-700"
                style={{
                  width:
                    phase === "discovering"
                      ? "28%"
                      : phase === "selecting"
                        ? "50%"
                        : phase === "connecting"
                          ? "76%"
                          : "100%",
                }}
              />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1 text-[11px] text-slate-500">
              <span className="text-brand-700">Účet</span>
              <span className={phase !== "discovering" ? "text-brand-700" : ""}>Seznam</span>
              <span className={phase === "connecting" || phase === "history" ? "text-brand-700" : ""}>Připojení</span>
              <span className={phase === "history" ? "text-brand-700" : ""}>Historie</span>
            </div>
            {phase === "history" && (
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Můžete pokračovat do přehledu. Starší data se budou doplňovat na pozadí a stav uvidíte přímo u analýzy.
              </p>
            )}
          </div>
        )}
        <div className={`flex flex-wrap gap-2 ${emptyState ? "" : "sm:col-span-2"}`}>
          <button
            className={`app-button ${emptyState ? "w-full justify-center whitespace-nowrap lg:w-auto" : ""}`}
            disabled={submitting || !configured || (plants.length > 0 && selectedPlantIds.length === 0)}
            type="submit"
          >
            {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {submitting
              ? plants.length ? "Připojuji elektrárny…" : "Načítám elektrárny…"
              : plants.length ? `Připojit vybrané (${selectedPlantIds.length})` : "Načíst elektrárny"}
          </button>
          {plants.length > 0 && (
            <button type="button" className="app-button app-button-secondary" onClick={changeAccount} disabled={submitting}>
              Změnit účet
            </button>
          )}
          {compact && (
            <button type="button" className="app-button app-button-secondary" onClick={() => setOpen(false)}>
              Zrušit
            </button>
          )}
        </div>
        {statusMessage && <p className={`text-sm text-brand-700 ${emptyState ? "lg:col-span-3" : "sm:col-span-2"}`} role="status">{statusMessage}</p>}
        {failure && (
          <div
            className={`rounded-2xl border border-error-200 bg-error-50 p-4 ${emptyState ? "lg:col-span-3" : "sm:col-span-2"}`}
            role="alert"
          >
            <p className="text-sm font-semibold leading-6 text-error-600">{failure.message}</p>
            {(failure.code || failure.reference || failure.stage || failure.upstreamStatus || failure.upstreamMessage) && (
              <>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  Technické podrobnosti pro správce – zkopírujte je prosím do hlášení:
                </p>
                <dl className="mt-1.5 grid gap-x-3 gap-y-1 text-xs leading-5 text-slate-700 sm:grid-cols-[auto_minmax(0,1fr)]">
                  {failure.reference && (
                    <>
                      <dt className="text-slate-500">Kód chyby</dt>
                      <dd className="font-mono font-semibold text-slate-900">{failure.reference}</dd>
                    </>
                  )}
                  {failure.stage && (
                    <>
                      <dt className="text-slate-500">Krok</dt>
                      <dd className="font-mono">{failure.stage}</dd>
                    </>
                  )}
                  {failure.code && (
                    <>
                      <dt className="text-slate-500">Typ</dt>
                      <dd className="font-mono">{failure.code}</dd>
                    </>
                  )}
                  {failure.upstreamStatus != null && (
                    <>
                      <dt className="text-slate-500">Odpověď služby</dt>
                      <dd className="font-mono">HTTP {failure.upstreamStatus}</dd>
                    </>
                  )}
                  {failure.upstreamMessage && (
                    <>
                      <dt className="text-slate-500">Hlášení služby</dt>
                      <dd className="font-mono break-words">{failure.upstreamMessage}</dd>
                    </>
                  )}
                </dl>
              </>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

export function EnergyDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSiteId = Number(searchParams.get("siteId")) || undefined;
  const [snapshot, setSnapshot] = useState<EnergyDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code?: string; connectorConfigured?: boolean } | null>(null);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [preparationDialog, setPreparationDialog] = useState<ConnectedEnergyAccount | null>(null);
  const dashboardTracked = useRef(false);

  const load = useCallback(async (siteId?: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const query = siteId ? `?siteId=${siteId}` : "";
      const response = await fetch(`/api/app/energy/dashboard${query}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as ApiError & {
        snapshot?: EnergyDashboardSnapshot;
      };
      if (!response.ok || !payload.snapshot) {
        throw Object.assign(new Error(payload.error || "Data elektrárny se nepodařilo načíst."), {
          code: payload.code,
          connectorConfigured: payload.connectorConfigured,
        });
      }
      setSnapshot(payload.snapshot);
      if (!dashboardTracked.current) {
        dashboardTracked.current = true;
        void trackEvent("DASHBOARD_VIEW", "/app/dashboard", { source: payload.snapshot.source });
      }
    } catch (caught) {
      const value = caught as Error & { code?: string };
      setError({
        message: value.message,
        code: value.code,
        connectorConfigured: (value as Error & { connectorConfigured?: boolean }).connectorConfigured,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(requestedSiteId);
  }, [load, requestedSiteId]);

  useEffect(() => {
    if (!snapshot) return;
    const importInProgress = ["QUEUED", "RUNNING"].includes(snapshot.history.importStatus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(snapshot.selectedSiteId, true);
    }, importInProgress ? 8_000 : 60_000);
    return () => window.clearInterval(interval);
  }, [load, snapshot]);

  const selectedSite = snapshot?.sites.find((site) => site.id === snapshot.selectedSiteId) ?? null;
  const energyChartData = useMemo(
    () =>
      (snapshot?.dailySeries ?? [])
        .filter((point) => {
          const at = new Date(point.at).getTime();
          const now = Date.now();
          return at >= now - 24 * 60 * 60 * 1000 && at <= now + 24 * 60 * 60 * 1000;
        })
        .map((point) => ({
          ...point,
          time: new Intl.DateTimeFormat("cs-CZ", {
            day: "numeric",
            month: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(point.at)),
          measuredProductionKwh: point.predicted ? null : point.productionKwh,
          measuredConsumptionKwh: point.predicted ? null : point.consumptionKwh,
          predictedProductionKwh: point.predicted ? point.productionKwh : null,
          predictedConsumptionKwh: point.predicted ? point.consumptionKwh : null,
        })),
    [snapshot?.dailySeries],
  );
  const batteryChartData = useMemo(
    () => energyChartData
      .filter((point) => !point.predicted && new Date(point.at).getTime() <= Date.now())
      .map((point) => ({
        ...point,
        chargeKwh: Math.max(0, -point.batteryKwh),
        dischargeKwh: Math.max(0, point.batteryKwh),
      })),
    [energyChartData],
  );

  if (loading && !snapshot) {
    return (
      <div className="grid min-h-[55vh] place-items-center text-center">
        <div><LoaderCircle className="mx-auto size-8 animate-spin text-brand-600" /><p className="mt-3 text-sm text-slate-500">Načítám elektrárnu…</p></div>
      </div>
    );
  }

  if (!snapshot) {
    const noSites = error?.code === "NO_SITES";
    if (noSites) {
      return (
        <ConnectLegacyAccount
          emptyState
          configured={error?.connectorConfigured !== false}
          onConnected={(result) => {
            setPreparationDialog(result);
            router.refresh();
            void load();
          }}
        />
      );
    }
    return (
      <div className="space-y-6">
        <PageHeader title="Energetický přehled" description="Výroba, spotřeba a chytré řízení vaší fotovoltaické elektrárny." />
        <div className="app-card flex min-h-80 flex-col items-center justify-center p-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
            <CloudOff className="size-7" />
          </span>
          <h2 className="mt-5 text-lg font-semibold text-slate-900">
            Data teď nejsou dostupná
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">{error?.message}</p>
          <button className="app-button mt-5" onClick={() => void load()}><RefreshCw className="size-4" /> Zkusit znovu</button>
        </div>
      </div>
    );
  }

  const optimizationOn = selectedSite?.optimizationOn ?? false;
  const soc = snapshot.current.batterySocPct;
  const gridExport = (snapshot.current.gridKw ?? 0) < 0;
  const history = snapshot.history;
  const historyImporting = ["QUEUED", "RUNNING"].includes(history.importStatus);
  const controlHref = selectedSite?.requiredInfo
    ? `/app/elektrarna?siteId=${snapshot.selectedSiteId}&intent=control#vlastni-tarif`
    : `/app/rizeni?siteId=${snapshot.selectedSiteId}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Energetický přehled"
        description="Aktuální stav výroby, spotřeby, sítě a baterie."
        action={
          <button
            type="button"
            className="app-button app-button-secondary"
            onClick={() => setConnectorOpen((value) => !value)}
          >
            <Plus className="size-4" />
            Připojit další elektrárnu
          </button>
        }
      />

      {preparationDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="energy-preparation-title">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                <LoaderCircle className="size-6 animate-spin" />
              </span>
              <div>
                <h2 id="energy-preparation-title" className="text-xl font-semibold text-slate-950">Elektrárna je připojená. Připravujeme její vyhodnocení.</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Teď stahujeme historická data výroby, spotřeby, baterie a toku se sítí. První data bývají dostupná přibližně během minuty; úplná roční historie může trvat déle.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["1", "Načteme historii", "Ověříme úplnost a energetickou bilanci."],
                ["2", "Porovnáme možnosti", "Dodavatele, veřejné ceníky, tarify a distribuční sazby."],
                ["3", "Doporučíme řízení", "Řízení doporučíme jen tehdy, když má co ekonomicky optimalizovat."],
              ].map(([step, title, description]) => (
                <div key={step} className="rounded-2xl bg-slate-50 p-4">
                  <span className="text-xs font-semibold text-brand-700">KROK {step}</span>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-slate-700">
              <Mail className="mt-0.5 size-5 shrink-0 text-brand-700" />
              <p>Stránku nemusíte nechávat otevřenou. Jakmile bude základní analýza dokončená, pošleme vám e-mail.</p>
            </div>

            <p className="mt-5 text-sm leading-6 text-slate-600">
              Přínos řízení závisí hlavně na tom, zda má systém co optimalizovat — například proměnlivé ceny, dvě distribuční pásma nebo baterii. Nejdřív proto ověříme, zda by pro vás řízení skutečně dávalo ekonomický smysl.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Mezitím můžete nahrát fakturu. Doplníme z ní váš skutečný tarif a v analýze porovnáme dnešní náklady s veřejně dostupnými nabídkami.
            </p>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" className="app-button app-button-secondary justify-center" onClick={() => setPreparationDialog(null)}>
                Pokračovat do přehledu
              </button>
              <Link
                className="app-button justify-center"
                href={`/app/elektrarna?siteId=${preparationDialog.connectedSiteIds[0] ?? snapshot.selectedSiteId}&intent=tariff#vlastni-tarif`}
              >
                <ReceiptText className="size-4" /> Nahrát fakturu
              </Link>
            </div>
          </div>
        </div>
      )}

      {connectorOpen && (
        <ConnectLegacyAccount
          compact
          onConnected={(result) => {
            setPreparationDialog(result);
            setConnectorOpen(false);
            router.refresh();
            void load();
          }}
        />
      )}

      <section className="app-card overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-950">
                {selectedSite?.name}
              </h2>
              <StatusBadge tone={snapshot.source === "LIVE" ? "brand" : "neutral"}>
                {snapshot.source === "LIVE" ? "Reálná data" : "Uložená data"}
              </StatusBadge>
              {optimizationOn && <StatusBadge tone="success">Řídíme</StatusBadge>}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {snapshot.dataAsOf
                ? `Poslední data ${new Intl.DateTimeFormat("cs-CZ", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(snapshot.dataAsOf))}`
                : "Čas posledních dat není známý"}
              {snapshot.inverterCount > 1
                ? ` · součet ${snapshot.inverterCount} střídačů`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="app-button app-button-secondary"
              href={`/app/analyza?siteId=${snapshot.selectedSiteId}`}
            >
              Spočítat úspory
            </Link>
            <Link className="app-button" href={controlHref}>
              <Zap className="size-4" />
              Zapnout řízení
            </Link>
          </div>
        </div>
        {(historyImporting || history.totalChunks > 0) && (
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-4 text-xs text-slate-600">
              <span>
                {historyImporting
                  ? "Stahujeme a kontrolujeme historii z cloudu"
                  : `Historická data: ${formatCompleteDays(history.coverageDays)}`}
              </span>
              <strong>{history.progressPercent} %</strong>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${history.progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={SunMedium} label="Výroba" value={formatValue(snapshot.current.productionKw, "kW")} tone="brand" />
        <MetricCard icon={HousePlug} label="Spotřeba" value={formatValue(snapshot.current.consumptionKw, "kW")} />
        <MetricCard icon={gridExport ? ArrowUpFromLine : ArrowDownToLine} label={gridExport ? "Dodávka do sítě" : "Odběr ze sítě"} value={formatValue(snapshot.current.gridKw == null ? null : Math.abs(snapshot.current.gridKw), "kW")} />
        <MetricCard
          icon={BatteryCharging}
          label={snapshot.current.batteryKw == null || snapshot.current.batteryKw === 0
            ? "Tok baterie"
            : snapshot.current.batteryKw > 0
              ? "Vybíjení baterie"
              : "Nabíjení baterie"}
          value={formatValue(snapshot.current.batteryKw == null ? null : Math.abs(snapshot.current.batteryKw), "kW")}
        />
        <div className="app-card p-5">
          <div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Gauge className="size-5" /></span><span className="text-2xl font-semibold text-slate-900">{soc == null ? "—" : `${numberFormat.format(soc)} %`}</span></div>
          <p className="mt-4 text-sm font-medium text-slate-600">Stav baterie</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, soc ?? 0))}%` }} /></div>
        </div>
      </section>

      <section className="app-card min-w-0 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Výroba a spotřeba: měření a predikce</h2>
            <p className="mt-1 text-sm text-slate-500">
              Vlevo jsou naměřené hodnoty za 24 hodin, přerušovaně navazuje predikce dalších 24 hodin. Jeden bod představuje 15 minut.
            </p>
          </div>
          <Zap className="size-5 text-brand-600" />
        </div>
        <div className="mt-6 h-80 min-w-0">
          {energyChartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={energyChartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <defs><linearGradient id="production" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#82c651" stopOpacity={0.35} /><stop offset="95%" stopColor="#82c651" stopOpacity={0} /></linearGradient><linearGradient id="consumption" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#64748b" stopOpacity={0.25} /><stop offset="95%" stopColor="#64748b" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis width={72} domain={[0, "auto"]} tickFormatter={formatEnergy} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatEnergy(value)} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                <Area name="Výroba – měření" type="linear" dataKey="measuredProductionKwh" stroke="#59a43c" strokeWidth={2} fill="url(#production)" isAnimationActive={false} connectNulls={false} />
                <Area name="Spotřeba – měření" type="linear" dataKey="measuredConsumptionKwh" stroke="#64748b" strokeWidth={2} fill="url(#consumption)" isAnimationActive={false} connectNulls={false} />
                <Line name="Výroba – predikce" type="linear" dataKey="predictedProductionKwh" stroke="#59a43c" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line name="Spotřeba – predikce" type="linear" dataKey="predictedConsumptionKwh" stroke="#64748b" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-slate-400">
              Intervalová data se doplní automaticky.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="app-card min-w-0 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Tok energie baterií</h2>
              <p className="mt-1 text-sm text-slate-500">
                Energie uložená do baterií a energie odebraná z baterií v každých 15 minutách.
              </p>
            </div>
            <BatteryCharging className="size-5 text-brand-600" />
          </div>
          <div className="mt-6 h-64 min-w-0">
            {batteryChartData.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={batteryChartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis width={72} domain={[0, "auto"]} tickFormatter={formatEnergy} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => formatEnergy(value)} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                <Bar name="Nabíjení" dataKey="chargeKwh" stackId="battery" fill="#38bdf8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar name="Vybíjení" dataKey="dischargeKwh" stackId="battery" fill="#8b5cf6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-slate-400">Tok baterie zatím není dostupný.</div>}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Při uložení a pozdějším využití energie vznikají převodní ztráty. Proto nelze z baterie získat zpět 100 % energie vložené při nabíjení.
          </p>
        </div>

        <div className="app-card min-w-0 p-5 sm:p-6">
          <div>
            <h2 className="font-semibold text-slate-900">Stav nabití baterií</h2>
            <p className="mt-1 text-sm text-slate-500">Souhrnný stav nabití všech baterií elektrárny.</p>
          </div>
          <div className="mt-6 h-64 min-w-0">
            {batteryChartData.some((point) => point.batterySocPct != null) ? <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={batteryChartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <defs><linearGradient id="batterySoc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis width={64} domain={[0, 100]} tickFormatter={(value) => `${energyNumberFormat.format(Number(value))} %`} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => `${energyNumberFormat.format(Number(value))} %`} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }} />
                <Area name="SoC" type="monotone" dataKey="batterySocPct" stroke="#8b5cf6" strokeWidth={2} fill="url(#batterySoc)" connectNulls isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer> : <div className="grid h-full place-items-center text-center text-sm text-slate-400">Historický stav nabití zatím není dostupný.<br />Aktuálně: {soc == null ? "—" : `${energyNumberFormat.format(soc)} %`}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, tone = "neutral" }: { icon: typeof SunMedium; label: string; value: string; tone?: "brand" | "neutral" }) {
  return <div className="app-card p-5"><div className="flex items-start justify-between gap-3"><span className={`grid size-10 place-items-center rounded-xl ${tone === "brand" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}><Icon className="size-5" /></span><strong className="text-xl font-semibold text-slate-900">{value}</strong></div><p className="mt-4 text-sm font-medium text-slate-600">{label}</p></div>;
}
