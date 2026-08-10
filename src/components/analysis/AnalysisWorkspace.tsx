"use client";

import {
  BarChart3,
  Download,
  FileUp,
  Info,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Zap,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode, WheelEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/app-shell/PagePrimitives";

const dayPluralRules = new Intl.PluralRules("cs-CZ");

function completeDaysLabel(value: number) {
  const suffix = dayPluralRules.select(value) === "one"
    ? "úplný den"
    : dayPluralRules.select(value) === "few"
      ? "úplné dny"
      : "úplných dní";
  return `${value.toLocaleString("cs-CZ")} ${suffix}`;
}

type Workspace = {
  engine: { version: string; productionReady: boolean; message: string };
  supplierFulfillment: {
    mode: "COMPARISON_ONLY" | "SPOTTEX_SUPPLIER";
    directContractingAvailable: boolean;
    message: string;
  };
  costsCatalog: {
    configured: boolean;
    reachable: boolean;
    asOf: string | null;
    domains: Partial<Record<"ENERGY_SUPPLY" | "ENERGY_DISTRIBUTION", number>>;
    message: string;
  };
  catalogStats: {
    productVersions: number;
    distributionVersions: number;
  };
  fundingPrograms: Array<{
    id: number;
    kind: "GRANT" | "LOAN";
    name: string;
    providerName: string;
    officialUrl: string;
    validFrom: string;
    validTo: string | null;
    territoryCodes: string[];
    customerSegments: string[];
    supportedTechnologies: string[];
    minimumAmountCzk: number | null;
    maximumAmountCzk: number | null;
    subsidyRatePct: number | null;
    aprPct: number | null;
    feesCzk: number | null;
    conditions: unknown;
  }>;
  sites: Array<{
    id: number;
    name: string;
    preparing: boolean;
    ready: boolean;
    blockers: string[];
    profileConfirmed: boolean;
    standardCatalogReady: boolean;
    dataQuality: {
      from: string | null;
      to: string | null;
      coverageDays: number;
      coveragePercent: number;
      confidence: string;
      message: string;
      balanceEvaluatedIntervals: number;
      balanceInvalidIntervals: number;
      balanceMeanAbsoluteErrorKwh: number | null;
      measuredConsumptionKwh: number;
      measuredProductionKwh: number;
      annualizedConsumptionKwh: number;
      annualizedProductionKwh: number;
      gridMeasuredDays: number;
      measuredGridImportKwh: number;
      measuredGridExportKwh: number;
      coverageWindows: Array<{
        days: 30 | 90 | 365;
        matchedIntervals: number;
        expectedIntervals: number;
        coveragePercent: number;
      }>;
    };
    currentHardware: {
      batteryCapacityKwh: number | null;
      batteryMaxChargeKw: number | null;
      batteryMaxDischargeKw: number | null;
      pvCapacityKwp: number | null;
      maxGridInputKw: number | null;
      maxGridOutputKw: number | null;
      phases: number | null;
      mainFuseA: number | null;
      availableMainFuseA: number[];
    };
    priceCurves: Array<{
      id: string;
      label: string;
      purpose: string;
      modeled: boolean;
      sourceUrl: string | null;
    }>;
    runs: Array<{
      id: string;
      status: string;
      kind: string;
      createdAt: string;
      completedAt: string | null;
      dataFrom: string | null;
      dataTo: string | null;
      errorMessage: string | null;
      proPriceMinor: number;
      billablePointCount: number;
      compareAllTariffs: boolean;
      progress: { completed: number; total: number };
      forecastQuality: null | {
        consumption: {
          selected: string | null;
          normalizedMaePct: number | null;
          coveragePct: number | null;
        };
        production: {
          selected: string | null;
          normalizedMaePct: number | null;
          coveragePct: number | null;
        };
        neuralCandidate: string;
      };
      loadProfileMethod: string;
      scenarios: Array<{
        id: string;
        priceCurveId: string;
        key: string;
        label: string;
        status: string;
        controlMode: "SELF_USE" | "SMART";
        annualCostCzk: number | null;
        annualCostLowerCzk: number | null;
        annualCostUpperCzk: number | null;
        annualImportCostCzk: number | null;
        annualExportRevenueCzk: number | null;
        annualFixedCostCzk: number | null;
        evaluatedDays: number | null;
        savingsVsSelfUseCzk: number | null;
        savingsVsBaselineCzk: number | null;
        savingsProductCzk: number | null;
        savingsDistributionCzk: number | null;
        savingsControlCzk: number | null;
        batteryCapacityKwh: number;
        batteryMaxChargeKw: number;
        batteryMaxDischargeKw: number;
        pvCapacityKwp: number;
        mainFuseA: number | null;
        unservedKwh: number;
        priceLabel: string;
        pricingMode: string;
        sellPricingMode: string;
        buySupplierName: string;
        sellSupplierName: string;
        productName: string;
        sellProductName: string;
        buySourceUrl: string | null;
        sellSourceUrl: string | null;
        buyAvailabilityNote: string | null;
        sellAvailabilityNote: string | null;
        fixedBuyVtCzkKwh: number | null;
        fixedBuyNtCzkKwh: number | null;
        spotBuyFeeCzkKwh: number | null;
        fixedSellVtCzkKwh: number | null;
        fixedSellNtCzkKwh: number | null;
        spotSellFeeCzkKwh: number | null;
        distributionCode: string | null;
        distributionEligibilityNote: string | null;
        distributionVtCzkKwh: number | null;
        distributionNtCzkKwh: number | null;
        systemServicesCzkKwh: number | null;
        electricityTaxCzkKwh: number | null;
        pozeCzkKwh: number | null;
        monthlyMeterFeeCzk: number | null;
        monthlyBreakerFeeCzk: number | null;
        currentDistribution: boolean;
        currentScenario: boolean;
        referenceScenario: boolean;
        hdoMode: unknown;
        investmentAssessment: null | {
          grantCzk: number;
          effectiveInvestmentCzk: number;
          monthlyPaymentCzk: number;
          simplePaybackYears: number | null;
        };
      }>;
    }>;
  }>;
};

type Scenario =
  Workspace["sites"][number]["runs"][number]["scenarios"][number];

type InputSeries = {
  site: { id: number; name: string; timezone: string };
  resolution: "WEEK" | "DAY" | "HOUR" | "15MIN";
  range: { from: string; to: string };
  series: Array<{
    at: string;
    productionKwh: number;
    consumptionKwh: number;
    intervals: number;
  }>;
  inverter: {
    id: number;
    name: string | null;
    status: string;
    lastSeenAt: string | null;
  };
  daily: Array<{
    date: string;
    productionKwh: number;
    consumptionKwh: number;
    gridImportKwh: number;
    gridExportKwh: number;
    batteryKwh: number;
    completeIntervals: number;
    gridIntervals: number;
  }>;
};

type ScenarioPeriod = {
  key: string;
  intervals: number;
  importKwh: number;
  exportKwh: number;
  chargedKwh: number;
  dischargedKwh: number;
  importCostCzk: number;
  exportRevenueCzk: number;
  variableCostCzk: number;
};

type ScenarioEvidence = {
  id: string;
  controlMode: "SELF_USE" | "SMART";
  status: string;
  annualCostCzk: number | null;
  annualImportCostCzk: number | null;
  annualExportRevenueCzk: number | null;
  annualFixedCostCzk: number | null;
  periods: { monthly: ScenarioPeriod[]; daily: ScenarioPeriod[] };
};

type ScenarioDetail = ScenarioEvidence & {
  dataFrom: string | null;
  dataTo: string | null;
  comparison: {
    selfUse: ScenarioEvidence | null;
    smart: ScenarioEvidence | null;
  };
  buy: null | {
    supplier: string;
    product: string;
    mode: string;
    fixedVtCzkKwh: number | null;
    fixedNtCzkKwh: number | null;
    spotFeeCzkKwh: number | null;
    monthlyFeeCzk: number | null;
    availabilityNote: string | null;
    sourceUrl: string | null;
  };
  sell: null | {
    supplier: string;
    product: string;
    mode: string;
    fixedVtCzkKwh: number | null;
    fixedNtCzkKwh: number | null;
    spotFeeCzkKwh: number | null;
    monthlyFeeCzk: number | null;
    availabilityNote: string | null;
    sourceUrl: string | null;
  };
  distribution: null | {
    code: string;
    eligibilityNote: string | null;
    vtCzkKwh: number | null;
    ntCzkKwh: number | null;
    systemServicesCzkKwh: number | null;
    electricityTaxCzkKwh: number | null;
    pozeCzkKwh: number | null;
    monthlyMeterFeeCzk: number | null;
    monthlyBreakerFeeCzk: number | null;
  };
  monthlyFixedTotalCzk: number | null;
};

const money = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });
const unitPrice = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});
function pointLabel(count: number, adjective = true) {
  if (count === 1) return adjective ? "1 placený bod" : "1 bod";
  if (count >= 2 && count <= 4)
    return adjective ? `${count} placené body` : `${count} body`;
  return adjective ? `${count} placených bodů` : `${count} bodů`;
}

function conditionSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  return Object.entries(value as Record<string, unknown>)
    .map(
      ([key, item]) =>
        `${key}: ${typeof item === "string" || typeof item === "number" ? item : JSON.stringify(item)}`,
    )
    .join(" · ");
}

function latestAnalysisIsPending(site: Workspace["sites"][number]) {
  return ["QUEUED", "RUNNING"].includes(site.runs[0]?.status ?? "");
}

function analysisStatusLabel(status: string) {
  return {
    DRAFT: "Připraveno k objednání",
    QUEUED: "Čeká na výpočet",
    RUNNING: "Výpočet probíhá",
    COMPLETED: "Hotovo",
    FAILED: "Výpočet se nezdařil",
    SUPERSEDED: "Nahrazeno novějším výpočtem",
  }[status] ?? status;
}

function amountForEvaluatedPeriod(
  annualValue: number | null,
  evaluatedDays: number,
) {
  if (annualValue == null) return null;
  return evaluatedDays >= 360
    ? annualValue
    : annualValue * (evaluatedDays / 365);
}

export function AnalysisWorkspace({
  initialWorkspace,
  initialSiteId,
  autoStart = false,
  autoOpenData = false,
  advancedOnly = false,
}: {
  initialWorkspace: Workspace;
  initialSiteId?: number;
  autoStart?: boolean;
  autoOpenData?: boolean;
  advancedOnly?: boolean;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [siteId, setSiteId] = useState(
    initialWorkspace.sites.some((site) => site.id === initialSiteId)
      ? initialSiteId!
      : initialWorkspace.sites[0]?.id ?? 0,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateFilter, setRateFilter] = useState("ALL");
  const [productFilter, setProductFilter] = useState("ALL");
  const [controlMode, setControlMode] = useState<"SELF_USE" | "SMART">(
    "SMART",
  );
  const [inputModalOpen, setInputModalOpen] = useState(false);
  const [inputSeries, setInputSeries] = useState<InputSeries | null>(null);
  const [inputSeriesLoading, setInputSeriesLoading] = useState(false);
  const [inputSeriesError, setInputSeriesError] = useState<string | null>(null);
  const [scenarioModalId, setScenarioModalId] = useState<string | null>(null);
  const [scenarioDetail, setScenarioDetail] =
    useState<ScenarioDetail | null>(null);
  const [scenarioDetailLoading, setScenarioDetailLoading] = useState(false);
  const [scenarioDetailError, setScenarioDetailError] = useState<string | null>(
    null,
  );
  const [selectedDetailDay, setSelectedDetailDay] = useState<string>("");
  const [detailMode, setDetailMode] = useState<"SELF_USE" | "SMART">("SMART");
  const [explanation, setExplanation] = useState<
    | { type: "RATE"; value: string }
    | { type: "PRODUCT"; value: string }
    | null
  >(null);
  const autoStartAttempted = useRef(false);
  const inputRangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputSeriesCache = useRef(new Map<string, InputSeries>());
  const [proInput, setProInput] = useState({
    battery: "",
    batteryCharge: "",
    batteryDischarge: "",
    pv: "",
    fuse: "",
    gridInput: "",
    gridOutput: "",
    capex: "",
    grantVersionId: "",
    loanVersionId: "",
    financedAmount: "",
    termMonths: "",
    eligibilityConfirmed: false,
    compareAllTariffs: false,
    selectedPriceCurveIds: [] as string[],
  });
  const site =
    workspace.sites.find((candidate) => candidate.id === siteId) ??
    workspace.sites[0];
  const hasPending = workspace.sites.some((candidate) =>
    candidate.preparing ||
    candidate.runs.some((run) => ["QUEUED", "RUNNING"].includes(run.status)),
  );

  useEffect(() => {
    const nextSiteId = initialWorkspace.sites.some(
      (candidate) => candidate.id === initialSiteId,
    )
      ? initialSiteId!
      : initialWorkspace.sites[0]?.id ?? 0;
    setWorkspace(initialWorkspace);
    setSiteId(nextSiteId);
    setInputSeries(null);
    setInputModalOpen(false);
    setScenarioModalId(null);
    setScenarioDetail(null);
    setError(null);
  }, [initialSiteId, initialWorkspace]);

  const refresh = useCallback(async () => {
    if (!site?.id) return;
    const requestedSiteId = site.id;
    const response = await fetch(
      `/api/app/analyses?siteId=${encodeURIComponent(String(requestedSiteId))}`,
      { cache: "no-store" },
    );
    if (response.ok) {
      const nextWorkspace = (await response.json()) as Workspace;
      setWorkspace((current) =>
        current.sites.some((candidate) => candidate.id === requestedSiteId)
          ? nextWorkspace
          : current,
      );
    }
  }, [site?.id]);

  async function loadInputData(options?: {
    from?: string;
    to?: string;
    resolution?: "WEEK" | "DAY" | "HOUR" | "15MIN";
  }) {
    if (!site) return;
    const cacheKey = JSON.stringify({
      siteId: site.id,
      from: options?.from ?? null,
      to: options?.to ?? null,
      resolution: options?.resolution ?? "WEEK",
    });
    const cached = inputSeriesCache.current.get(cacheKey);
    if (cached) {
      setInputSeries(cached);
      setInputSeriesError(null);
      return;
    }
    setInputSeriesLoading(true);
    setInputSeriesError(null);
    try {
      const query = new URLSearchParams({ siteId: String(site.id) });
      if (options?.from) query.set("from", options.from);
      if (options?.to) query.set("to", options.to);
      if (options?.resolution) query.set("resolution", options.resolution);
      const response = await fetch(
        `/api/app/analyses/input-data?${query.toString()}`,
      );
      if (!response.ok) throw new Error("Vstupní data se nepodařilo načíst.");
      const payload = (await response.json()) as InputSeries;
      inputSeriesCache.current.set(cacheKey, payload);
      setInputSeries(payload);
    } catch (caught) {
      setInputSeriesError(
        caught instanceof Error
          ? caught.message
          : "Vstupní data se nepodařilo načíst.",
      );
    } finally {
      setInputSeriesLoading(false);
    }
  }

  async function openInputData() {
    if (!site) return;
    setInputModalOpen(true);
    if (inputSeries?.site.id === site.id) return;
    await loadInputData();
  }

  function zoomInputData(from: string, to: string, days: number) {
    if (inputRangeTimer.current) clearTimeout(inputRangeTimer.current);
    inputRangeTimer.current = setTimeout(() => {
      void loadInputData({
        from,
        to,
        resolution:
          days <= 4
            ? "15MIN"
            : days <= 14
              ? "HOUR"
              : days <= 120
                ? "DAY"
                : "WEEK",
      });
    }, 350);
  }

  async function openScenarioDetail(scenario: Scenario | null) {
    if (!scenario) return;
    setScenarioModalId(scenario.id);
    setScenarioDetail(null);
    setScenarioDetailError(null);
    setSelectedDetailDay("");
    setDetailMode(scenario.controlMode);
    setScenarioDetailLoading(true);
    try {
      const response = await fetch(
        `/api/app/analyses/scenarios/${scenario.id}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Detail scénáře se nepodařilo načíst.");
      const detail = (await response.json()) as ScenarioDetail;
      setScenarioDetail(detail);
      const selected =
        scenario.controlMode === "SMART"
          ? detail.comparison.smart
          : detail.comparison.selfUse;
      setSelectedDetailDay(selected?.periods.daily.at(-1)?.key ?? "");
    } catch (caught) {
      setScenarioDetailError(
        caught instanceof Error
          ? caught.message
          : "Detail scénáře se nepodařilo načíst.",
      );
    } finally {
      setScenarioDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [hasPending, refresh]);

  useEffect(() => {
    if (!autoOpenData || !site || inputModalOpen) return;
    void openInputData();
    // The query parameter is an entry action, not durable modal state.
    const url = new URL(window.location.href);
    url.searchParams.delete("data");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    // `openInputData` intentionally uses the current selected site once for
    // this URL entry action; recreating it is not a reason to reopen the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenData, inputModalOpen, site?.id]);

  async function start() {
    if (!site) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/app/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: site.id,
          kind: "BASE",
          hardwareVariants: [],
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(body?.error || "Analýzu se nepodařilo spustit.");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Analýzu se nepodařilo spustit.",
      );
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStartAttempted.current || !site) return;
    autoStartAttempted.current = true;
    // `start=1` is an entry action, not a durable page state. Consuming it here
    // prevents a refresh or a return to the same URL from enqueuing another
    // identical 32-scenario run.
    const url = new URL(window.location.href);
    url.searchParams.delete("start");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (
      !site.ready ||
      latestAnalysisIsPending(site) ||
      site.runs.some((run) => run.kind === "BASE")
    ) {
      return;
    }
    void start();
    // `start` intentionally follows the selected site's current snapshot; the
    // ref prevents a refresh from submitting a duplicate job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, site]);

  function values(raw: string, fallback: number | null) {
    if (!raw.trim()) return fallback == null ? [] : [fallback];
    const parsed = raw
      .split(/[;,\s]+/)
      .map((value) => Number(value.replace(",", ".")))
      .filter((value) => Number.isFinite(value) && value >= 0);
    return [
      ...new Set(parsed.length ? parsed : fallback == null ? [] : [fallback]),
    ];
  }

  function fuseLimitKw(phases: number | null, amperes: number) {
    if (!phases) return null;
    const apparent =
      phases === 3
        ? (Math.sqrt(3) * 400 * amperes) / 1_000
        : (230 * amperes) / 1_000;
    return Math.round(apparent * 0.95 * 1_000) / 1_000;
  }

  const proVariants = site
    ? values(proInput.battery, site.currentHardware.batteryCapacityKwh).flatMap(
        (batteryCapacityKwh) =>
          values(
            proInput.batteryCharge,
            site.currentHardware.batteryMaxChargeKw,
          ).flatMap((batteryMaxChargeKw) =>
            values(
              proInput.batteryDischarge,
              site.currentHardware.batteryMaxDischargeKw,
            ).flatMap((batteryMaxDischargeKw) =>
              values(proInput.pv, site.currentHardware.pvCapacityKwp).flatMap(
                (pvCapacityKwp) =>
                  values(proInput.fuse, site.currentHardware.mainFuseA).flatMap(
                    (mainFuseA) =>
                      values(
                        proInput.gridInput,
                        proInput.gridInput.trim() ||
                          mainFuseA === site.currentHardware.mainFuseA
                          ? site.currentHardware.maxGridInputKw
                          : (fuseLimitKw(
                              site.currentHardware.phases,
                              mainFuseA,
                            ) ?? site.currentHardware.maxGridInputKw),
                      ).flatMap((maxGridInputKw) =>
                        values(
                          proInput.gridOutput,
                          site.currentHardware.maxGridOutputKw,
                        ).map((maxGridOutputKw) => ({
                          batteryCapacityKwh,
                          batteryMaxChargeKw,
                          batteryMaxDischargeKw,
                          pvCapacityKwp,
                          mainFuseA,
                          maxGridInputKw,
                          maxGridOutputKw,
                        })),
                      ),
                  ),
              ),
            ),
          ),
      )
    : [];
  const currentKey = site
    ? `${site.currentHardware.batteryCapacityKwh}:${site.currentHardware.batteryMaxChargeKw}:${site.currentHardware.batteryMaxDischargeKw}:${site.currentHardware.pvCapacityKwp}:${site.currentHardware.maxGridInputKw}:${site.currentHardware.maxGridOutputKw}:${site.currentHardware.mainFuseA}`
    : "";
  const proPointCount = new Set(
    proVariants
      .map(
        (variant) =>
          `${variant.batteryCapacityKwh}:${variant.batteryMaxChargeKw}:${variant.batteryMaxDischargeKw}:${variant.pvCapacityKwp}:${variant.maxGridInputKw}:${variant.maxGridOutputKw}:${variant.mainFuseA}`,
      )
      .filter((key) => key !== currentKey),
  ).size;
  const proBillablePointCount =
    proPointCount + proInput.selectedPriceCurveIds.length;
  const investmentCapex = Number(proInput.capex.replace(",", "."));
  const financedAmount = Number(proInput.financedAmount.replace(",", "."));
  const termMonths = Number(proInput.termMonths);
  const investmentRequested =
    proInput.capex.trim() !== "" ||
    proInput.grantVersionId !== "" ||
    proInput.loanVersionId !== "";
  const investmentInvalid =
    investmentRequested &&
    (!Number.isFinite(investmentCapex) ||
      investmentCapex <= 0 ||
      !proInput.eligibilityConfirmed ||
      (proInput.loanVersionId !== "" &&
        (!Number.isFinite(financedAmount) ||
          financedAmount <= 0 ||
          !Number.isInteger(termMonths) ||
          termMonths <= 0)));
  const selectedGrant = workspace.fundingPrograms.find(
    (program) => String(program.id) === proInput.grantVersionId,
  );
  const selectedLoan = workspace.fundingPrograms.find(
    (program) => String(program.id) === proInput.loanVersionId,
  );

  async function startPro() {
    if (
      !site ||
      proBillablePointCount < 1 ||
      proVariants.length > 5_000
    )
      return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/app/analyses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: site.id,
          kind: "PRO",
          hardwareVariants: proVariants,
          compareAllTariffs: proInput.compareAllTariffs,
          selectedPriceCurveIds: proInput.selectedPriceCurveIds,
          investment: investmentRequested
            ? {
                capexCzk: investmentCapex,
                grantVersionId: proInput.grantVersionId
                  ? Number(proInput.grantVersionId)
                  : null,
                loanVersionId: proInput.loanVersionId
                  ? Number(proInput.loanVersionId)
                  : null,
                financedAmountCzk: proInput.loanVersionId
                  ? financedAmount
                  : null,
                termMonths: proInput.loanVersionId ? termMonths : null,
                eligibilityConfirmed: true,
              }
            : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          body.error || "Rozšířenou analýzu se nepodařilo připravit.",
        );
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Rozšířenou analýzu se nepodařilo připravit.",
      );
    } finally {
      setPending(false);
    }
  }

  async function payPro(runId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/app/analyses/${runId}/checkout`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        redirectUrl?: string;
        error?: string;
      };
      if (!response.ok || !body.redirectUrl)
        throw new Error(body.error || "Platbu se nepodařilo připravit.");
      window.location.assign(body.redirectUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Platbu se nepodařilo připravit.",
      );
      setPending(false);
    }
  }

  async function cancel(runId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/app/analyses/${runId}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Výpočet se nepodařilo zrušit.");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Výpočet se nepodařilo zrušit.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!site)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analýza úspor"
          description="Nejdřív připojte elektrárnu v části Moje elektrárna."
        />
      </div>
    );
  const latest = site.runs[0];
  const latestRunning = Boolean(
    site.preparing ||
      (latest && ["QUEUED", "RUNNING"].includes(latest.status)),
  );
  const latestProgressPercent =
    latest?.status === "RUNNING" && latest.progress.total > 0
      ? Math.max(15, Math.round((latest.progress.completed / latest.progress.total) * 100))
      : latest?.status === "QUEUED" && latest.errorMessage
        ? 10
        : 5;
  const completedBase = site.runs.find(
    (run) => run.kind === "BASE" && run.status === "COMPLETED",
  );
  const bestSmartScenarios =
    latest?.scenarios
      .filter(
        (scenario) =>
          scenario.controlMode === "SMART" &&
          scenario.status === "COMPLETED" &&
          scenario.annualCostCzk != null,
      )
      .sort((left, right) => left.annualCostCzk! - right.annualCostCzk!)
      .slice(0, 3) ?? [];
  const bestSmartId = bestSmartScenarios[0]?.id;
  const evaluatedDays = Math.max(
    1,
    Math.round(
      bestSmartScenarios[0]?.evaluatedDays ??
        latest?.scenarios.find((scenario) => scenario.evaluatedDays != null)
          ?.evaluatedDays ??
        site.dataQuality.coverageDays,
    ),
  );
  const effectivelyAnnual = evaluatedDays >= 360;
  const amountPeriodLabel = effectivelyAnnual
    ? "rok"
    : completeDaysLabel(evaluatedDays);
  const amountLabel = effectivelyAnnual
    ? "za rok"
    : `za ${completeDaysLabel(evaluatedDays)}`;
  const displayedAmount = (annualValue: number | null) =>
    amountForEvaluatedPeriod(annualValue, evaluatedDays);
  const savingsValue = (
    scenario: Workspace["sites"][number]["runs"][number]["scenarios"][number],
  ) => scenario.savingsVsBaselineCzk ?? scenario.savingsVsSelfUseCzk;
  const matrixRows = Array.from(
    (latest?.scenarios ?? [])
      .filter(
        (scenario) =>
          scenario.batteryCapacityKwh ===
            site.currentHardware.batteryCapacityKwh &&
          scenario.batteryMaxChargeKw ===
            site.currentHardware.batteryMaxChargeKw &&
          scenario.batteryMaxDischargeKw ===
            site.currentHardware.batteryMaxDischargeKw &&
          scenario.pvCapacityKwp === site.currentHardware.pvCapacityKwp &&
          scenario.mainFuseA === site.currentHardware.mainFuseA,
      )
      .reduce(
        (rows, scenario) => {
          const existing = rows.get(scenario.priceCurveId) ?? {
            priceCurveId: scenario.priceCurveId,
            priceLabel: scenario.priceLabel,
            pricingMode: scenario.pricingMode,
            sellPricingMode: scenario.sellPricingMode,
            buySupplierName: scenario.buySupplierName,
            sellSupplierName: scenario.sellSupplierName,
            productName: scenario.productName,
            sellProductName: scenario.sellProductName,
            buySourceUrl: scenario.buySourceUrl,
            sellSourceUrl: scenario.sellSourceUrl,
            buyAvailabilityNote: scenario.buyAvailabilityNote,
            sellAvailabilityNote: scenario.sellAvailabilityNote,
            fixedBuyVtCzkKwh: scenario.fixedBuyVtCzkKwh,
            fixedBuyNtCzkKwh: scenario.fixedBuyNtCzkKwh,
            spotBuyFeeCzkKwh: scenario.spotBuyFeeCzkKwh,
            fixedSellVtCzkKwh: scenario.fixedSellVtCzkKwh,
            fixedSellNtCzkKwh: scenario.fixedSellNtCzkKwh,
            spotSellFeeCzkKwh: scenario.spotSellFeeCzkKwh,
            distributionCode: scenario.distributionCode,
            eligibilityNote: scenario.distributionEligibilityNote,
            distributionVtCzkKwh: scenario.distributionVtCzkKwh,
            distributionNtCzkKwh: scenario.distributionNtCzkKwh,
            systemServicesCzkKwh: scenario.systemServicesCzkKwh,
            electricityTaxCzkKwh: scenario.electricityTaxCzkKwh,
            pozeCzkKwh: scenario.pozeCzkKwh,
            monthlyMeterFeeCzk: scenario.monthlyMeterFeeCzk,
            monthlyBreakerFeeCzk: scenario.monthlyBreakerFeeCzk,
            currentScenario: scenario.currentScenario,
            referenceScenario: scenario.referenceScenario,
            selfUse: null,
            smart: null,
          };
          if (scenario.controlMode === "SELF_USE") existing.selfUse = scenario;
          else existing.smart = scenario;
          rows.set(scenario.priceCurveId, existing);
          return rows;
        },
        new Map<
          string,
          {
            priceCurveId: string;
            priceLabel: string;
            pricingMode: string;
            sellPricingMode: string;
            buySupplierName: string;
            sellSupplierName: string;
            productName: string;
            sellProductName: string;
            buySourceUrl: string | null;
            sellSourceUrl: string | null;
            buyAvailabilityNote: string | null;
            sellAvailabilityNote: string | null;
            fixedBuyVtCzkKwh: number | null;
            fixedBuyNtCzkKwh: number | null;
            spotBuyFeeCzkKwh: number | null;
            fixedSellVtCzkKwh: number | null;
            fixedSellNtCzkKwh: number | null;
            spotSellFeeCzkKwh: number | null;
            distributionCode: string | null;
            eligibilityNote: string | null;
            currentScenario: boolean;
            referenceScenario: boolean;
            selfUse: Workspace["sites"][number]["runs"][number]["scenarios"][number] | null;
            smart: Workspace["sites"][number]["runs"][number]["scenarios"][number] | null;
          }
        >(),
      )
      .values(),
  ).sort((left, right) =>
    `${left.distributionCode}:${left.pricingMode}:${left.sellPricingMode}`.localeCompare(
      `${right.distributionCode}:${right.pricingMode}:${right.sellPricingMode}`,
      "cs",
    ),
  );
  const referenceRow = matrixRows.find((row) => row.referenceScenario) ?? null;
  const hasCurrentTariffScenario = matrixRows.some(
    (row) => row.currentScenario,
  );
  const comparisonMatrixRows = matrixRows.filter(
    (row) => !row.referenceScenario && !row.currentScenario,
  );
  const selectedProviders = {
    fixedBuy: comparisonMatrixRows.find((row) => row.pricingMode === "FIX"),
    spotBuy: comparisonMatrixRows.find((row) => row.pricingMode === "SPOT"),
    fixedSell: comparisonMatrixRows.find(
      (row) => row.sellPricingMode === "FIX",
    ),
    spotSell: comparisonMatrixRows.find(
      (row) => row.sellPricingMode === "SPOT",
    ),
  };
  const providerSelections = [
    {
      label: "Nejvýhodnější fixní nákup",
      row: selectedProviders.fixedBuy,
      supplier: selectedProviders.fixedBuy?.buySupplierName,
      product: selectedProviders.fixedBuy?.productName,
      sourceUrl: selectedProviders.fixedBuy?.buySourceUrl,
      note: selectedProviders.fixedBuy?.buyAvailabilityNote,
    },
    {
      label: "Nejvýhodnější spotový nákup",
      row: selectedProviders.spotBuy,
      supplier: selectedProviders.spotBuy?.buySupplierName,
      product: selectedProviders.spotBuy?.productName,
      sourceUrl: selectedProviders.spotBuy?.buySourceUrl,
      note: selectedProviders.spotBuy?.buyAvailabilityNote,
    },
    {
      label: "Nejvýhodnější pevný výkup",
      row: selectedProviders.fixedSell,
      supplier: selectedProviders.fixedSell?.sellSupplierName,
      product: selectedProviders.fixedSell?.sellProductName,
      sourceUrl: selectedProviders.fixedSell?.sellSourceUrl,
      note: selectedProviders.fixedSell?.sellAvailabilityNote,
    },
    {
      label: "Nejvýhodnější spotový výkup",
      row: selectedProviders.spotSell,
      supplier: selectedProviders.spotSell?.sellSupplierName,
      product: selectedProviders.spotSell?.sellProductName,
      sourceUrl: selectedProviders.spotSell?.sellSourceUrl,
      note: selectedProviders.spotSell?.sellAvailabilityNote,
    },
  ].filter((selection) => selection.row);
  const referenceAnnualCost =
    referenceRow?.selfUse?.annualCostCzk ??
    referenceRow?.smart?.annualCostCzk ??
    null;
  const rateOptions = [
    ...new Set(
      comparisonMatrixRows
        .map((row) => row.distributionCode)
      .filter((value): value is string => Boolean(value)),
    ),
  ].sort((left, right) => left.localeCompare(right, "cs", { numeric: true }));
  const baseMatrixCombinations = [
    { key: "FIX:FIX", label: "Fix → fix" },
    { key: "FIX:SPOT", label: "Fix → spot" },
    { key: "SPOT:SPOT", label: "Spot → spot" },
  ] as const;
  const baseMatrixScenario = (row: (typeof matrixRows)[number]) =>
    controlMode === "SMART" ? row.smart : row.selfUse;
  const baseMatrixCosts = comparisonMatrixRows
    .map((row) => baseMatrixScenario(row)?.annualCostCzk)
    .filter((value): value is number => value != null);
  const baseMatrixLowestCost =
    baseMatrixCosts.length > 0 ? Math.min(...baseMatrixCosts) : null;
  const baseMatrixHighestCost =
    baseMatrixCosts.length > 1 ? Math.max(...baseMatrixCosts) : null;
  const selectedScenarioForModal =
    latest?.scenarios.find((scenario) => scenario.id === scenarioModalId) ??
    null;
  const productKey = (row: (typeof matrixRows)[number]) =>
    `${row.pricingMode}:${row.sellPricingMode}`;
  const filteredMatrixRows = comparisonMatrixRows.filter(
    (row) =>
      (rateFilter === "ALL" || row.distributionCode === rateFilter) &&
      (productFilter === "ALL" || productKey(row) === productFilter),
  );
  const completedRowCosts = filteredMatrixRows
    .map((row) => row.smart?.annualCostCzk ?? row.selfUse?.annualCostCzk)
    .filter((value): value is number => value != null);
  const lowestRowCost =
    completedRowCosts.length > 0 ? Math.min(...completedRowCosts) : null;
  const highestRowCost =
    completedRowCosts.length > 1 ? Math.max(...completedRowCosts) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={advancedOnly ? "Pokročilá analýza" : "Analýza úspor"}
        description={
          advancedOnly
            ? "Placená simulace změn baterie, fotovoltaiky, jističe a investice."
            : "Porovnání ročních nákladů."
        }
        action={
          !advancedOnly ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Link
                className="app-button app-button-secondary"
                href={`/app/pokrocila-analyza?siteId=${site.id}`}
              >
                Pokročilá analýza úspor
              </Link>
              {!hasCurrentTariffScenario && (
                <Link
                  className="app-button app-button-secondary"
                  href={`/app/elektrarna?siteId=${site.id}&intent=tariff#vlastni-tarif`}
                >
                  <FileUp className="size-4" />
                  Spočítat pro můj tarif
                </Link>
              )}
              <Link
                className="app-button"
                href={`/app/elektrarna?siteId=${site.id}&intent=control#vlastni-tarif`}
              >
                <Zap className="size-4" />
                Začít řídit
              </Link>
            </div>
          ) : undefined
        }
      />
      <section className="app-card p-4 sm:p-5">
        {(pending || latestRunning) && (
          <div
            className="mb-4 rounded-xl border border-brand-200 bg-brand-50 p-3"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-brand-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {pending || site.preparing
                    ? "Kontrolujeme podklady a připravujeme výpočet"
                    : latest?.status === "QUEUED" && latest.errorMessage
                      ? "Výpočet čeká na automatické opakování"
                    : latest?.status === "QUEUED"
                      ? "Výpočet čeká ve frontě"
                      : "Porovnáváme sazby, fix a spot"}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-slate-600">
                  {pending || site.preparing
                    ? "Ověřujeme historii, technické parametry a dostupné cenové scénáře."
                    : latest?.status === "QUEUED" && latest.errorMessage
                      ? latest.errorMessage
                    : latest && latest.progress.total > 0
                      ? latest.progress.completed > 0
                        ? `Nejvýhodnější nákupní a výkupní ceníky jsou vybrané. Na elektrárně vyhodnocujeme scénář ${latest.progress.completed} z ${latest.progress.total}; hotové řádky se doplňují průběžně.`
                        : `Procházíme platné ceníky, odděleně vybíráme nejlepší nákup a nejlepší výkup a připravujeme ${latest.progress.total} scénářů.`
                      : "Výpočet je zařazený ve frontě. Tato stránka se sama obnovuje každé 4 sekundy."}
                </p>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    pending || site.preparing
                      ? undefined
                      : latestProgressPercent
                  }
                >
                  <div
                    className={`h-full rounded-full bg-brand-500 transition-all duration-500 ${pending || site.preparing || !latest?.progress.total ? "animate-pulse" : ""}`}
                    style={{
                      width:
                        pending || site.preparing
                          ? "35%"
                          : `${latestProgressPercent}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="grid divide-y divide-slate-100 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <div className="pb-4 sm:pb-0 sm:pr-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Elektrárna
              </p>
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-brand-300 hover:text-brand-700"
                aria-label="Zobrazit data použitá pro výpočet"
                title="Data použitá pro výpočet"
                onClick={() => void openInputData()}
              >
                <Info className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-lg font-semibold text-slate-950">
              {site.name}
            </p>
          </div>
          <div className="py-4 sm:px-5 sm:py-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Spotřeba
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {number.format(
                site.dataQuality.annualizedConsumptionKwh / 1_000,
              )}{" "}
              <span className="text-sm font-medium text-slate-500">MWh/rok</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Přepočteno z měřeného období
            </p>
          </div>
          <div className="pt-4 sm:pl-5 sm:pt-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Výroba
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {number.format(
                site.dataQuality.annualizedProductionKwh / 1_000,
              )}{" "}
              <span className="text-sm font-medium text-slate-500">MWh/rok</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Přepočteno z měřeného období
            </p>
          </div>
          <button
            type="button"
            className="py-4 text-left sm:py-0 sm:pl-5"
            onClick={() => void openInputData()}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Historická data
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-950">
              {completeDaysLabel(site.dataQuality.coverageDays)}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
              <BarChart3 className="size-3.5" />
              Prohlédnout graf
            </p>
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          {site.ready && !latestRunning && !completedBase ? (
            <button
              type="button"
              className="app-button"
              disabled={pending}
              onClick={() => void start()}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {pending
                ? "Připravuji výpočet…"
                : completedBase
                  ? "Přepočítat základní úspory"
                  : "Spočítat základní úspory"}
            </button>
          ) : !site.profileConfirmed ? (
            <Link
              className="app-button justify-center"
              href={`/app/elektrarna?siteId=${site.id}`}
            >
              Doplnit a potvrdit údaje
            </Link>
          ) : null}
        </div>
        {!site.ready && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">
              Připravujeme podklady
            </p>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              Nejdřív dokončete následující podklady. Jakmile budou připravené,
              tlačítko se automaticky změní na „Spočítat základní úspory“.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-amber-900">
            {site.blockers.map((blocker) => (
              <li key={blocker} className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" />
                {blocker}
              </li>
            ))}
            </ul>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-error-50 p-3 text-sm text-error-700"
          >
            {error}
          </p>
        )}
      </section>
      {completedBase && advancedOnly && <section id="pokrocila-analyza" className="order-3 app-card scroll-mt-24 p-5 sm:p-6">
        <h2 className="font-semibold text-slate-900">
          Nastavit pokročilou simulaci
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          V testovacím provozu je pokročilá i základní analýza zdarma. Zde
          můžete měnit výkon elektrárny,
          kapacitu a výkon baterie, jistič i investiční náklady; každý zvolený
          scénář před objednáním přesně vyčíslíme.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ProField
            label="Kapacita baterie (kWh)"
            value={proInput.battery}
            placeholder={String(site.currentHardware.batteryCapacityKwh ?? "")}
            onChange={(battery) =>
              setProInput((current) => ({ ...current, battery }))
            }
          />
          <ProField
            label="Nabíjecí výkon baterie (kW)"
            value={proInput.batteryCharge}
            placeholder={String(site.currentHardware.batteryMaxChargeKw ?? "")}
            onChange={(batteryCharge) =>
              setProInput((current) => ({ ...current, batteryCharge }))
            }
          />
          <ProField
            label="Vybíjecí výkon baterie (kW)"
            value={proInput.batteryDischarge}
            placeholder={String(
              site.currentHardware.batteryMaxDischargeKw ?? "",
            )}
            onChange={(batteryDischarge) =>
              setProInput((current) => ({ ...current, batteryDischarge }))
            }
          />
          <ProField
            label="Výkon FVE (kWp)"
            value={proInput.pv}
            placeholder={String(site.currentHardware.pvCapacityKwp ?? "")}
            onChange={(pv) => setProInput((current) => ({ ...current, pv }))}
          />
          <ProField
            label="Hlavní jistič (A)"
            value={proInput.fuse}
            placeholder={
              site.currentHardware.availableMainFuseA.join(", ") ||
              String(site.currentHardware.mainFuseA ?? "")
            }
            onChange={(fuse) =>
              setProInput((current) => ({ ...current, fuse }))
            }
          />
          <ProField
            label="Limit odběru (kW)"
            value={proInput.gridInput}
            placeholder={String(site.currentHardware.maxGridInputKw ?? "")}
            onChange={(gridInput) =>
              setProInput((current) => ({ ...current, gridInput }))
            }
          />
          <ProField
            label="Limit přetoku (kW)"
            value={proInput.gridOutput}
            placeholder={String(site.currentHardware.maxGridOutputKw ?? "")}
            onChange={(gridOutput) =>
              setProInput((current) => ({ ...current, gridOutput }))
            }
          />
        </div>
        <div className="mt-6 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">
            Investice, dotace a financování
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Volitelné a pouze pro Pro analýzu. Počítáme jen z publikovaných
            oficiálních podmínek; nárok musíte potvrdit vy.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProField
              label="Investice včetně DPH (Kč)"
              value={proInput.capex}
              placeholder="180000"
              onChange={(capex) =>
                setProInput((current) => ({ ...current, capex }))
              }
            />
            <label className="text-sm font-medium text-slate-700">
              Dotační titul
              <select
                className="app-input mt-1.5"
                value={proInput.grantVersionId}
                onChange={(event) =>
                  setProInput((current) => ({
                    ...current,
                    grantVersionId: event.target.value,
                  }))
                }
              >
                <option value="">Bez dotace</option>
                {workspace.fundingPrograms
                  .filter((program) => program.kind === "GRANT")
                  .map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.providerName} · {program.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Financování
              <select
                className="app-input mt-1.5"
                value={proInput.loanVersionId}
                onChange={(event) =>
                  setProInput((current) => ({
                    ...current,
                    loanVersionId: event.target.value,
                  }))
                }
              >
                <option value="">Bez financování</option>
                {workspace.fundingPrograms
                  .filter((program) => program.kind === "LOAN")
                  .map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.providerName} · {program.name}
                      {program.aprPct != null
                        ? ` · RPSN ${number.format(program.aprPct)} %`
                        : ""}
                    </option>
                  ))}
              </select>
            </label>
            {proInput.loanVersionId && (
              <>
                <ProField
                  label="Financovaná částka (Kč)"
                  value={proInput.financedAmount}
                  placeholder="100000"
                  onChange={(financedAmount) =>
                    setProInput((current) => ({
                      ...current,
                      financedAmount,
                    }))
                  }
                />
                <ProField
                  label="Doba splatnosti (měsíců)"
                  value={proInput.termMonths}
                  placeholder="60"
                  onChange={(termMonths) =>
                    setProInput((current) => ({ ...current, termMonths }))
                  }
                />
              </>
            )}
          </div>
          {[selectedGrant, selectedLoan].filter(Boolean).map((program) => (
            <article
              key={program!.id}
              className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600"
            >
              <p className="font-semibold text-slate-900">
                {program!.providerName} · {program!.name}
              </p>
              <p>
                Platnost{" "}
                {new Date(program!.validFrom).toLocaleDateString("cs-CZ")}
                {program!.validTo
                  ? `–${new Date(program!.validTo).toLocaleDateString("cs-CZ")}`
                  : " bez zadaného konce"}
                {program!.subsidyRatePct != null
                  ? ` · podpora ${number.format(program!.subsidyRatePct)} %`
                  : ""}
                {program!.aprPct != null
                  ? ` · RPSN ${number.format(program!.aprPct)} %`
                  : ""}
                {program!.feesCzk != null
                  ? ` · poplatky ${money.format(program!.feesCzk)}`
                  : ""}
              </p>
              <p>
                Území: {program!.territoryCodes.join(", ")} · žadatelé:{" "}
                {program!.customerSegments.join(", ")} · technologie:{" "}
                {program!.supportedTechnologies.join(", ")}
              </p>
              <p className="break-words">
                Podmínky: {conditionSummary(program!.conditions)}
              </p>
              <a
                href={program!.officialUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand-700 hover:underline"
              >
                Otevřít oficiální zdroj ↗
              </a>
            </article>
          ))}
          {investmentRequested && (
            <label className="mt-4 flex items-start gap-2 text-sm leading-5 text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={proInput.eligibilityConfirmed}
                onChange={(event) =>
                  setProInput((current) => ({
                    ...current,
                    eligibilityConfirmed: event.target.checked,
                  }))
                }
              />
              Potvrzuji, že jsem ověřil územní, technické, příjmové a časové
              podmínky vybraných programů. Výsledek je model, nikoli rozhodnutí
              poskytovatele dotace nebo úvěru.
            </label>
          )}
        </div>
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-950">
          <p className="font-semibold">Volitelné ceníky · nyní zdarma</p>
          <p className="mt-1 text-xs leading-5 text-brand-800">
            Základní analýza už obsahuje automaticky vybrané nejlepší fixní a
            spotové nabídky. Zde přidejte jen konkrétní ceníky, které chcete
            samostatně simulovat.
          </p>
          <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {site.priceCurves.map((curve) => (
              <label key={curve.id} className="flex items-start gap-2 rounded-lg bg-white/70 p-2 text-xs leading-4">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={proInput.selectedPriceCurveIds.includes(curve.id)}
                  onChange={(event) =>
                    setProInput((current) => ({
                      ...current,
                      selectedPriceCurveIds: event.target.checked
                        ? [...current.selectedPriceCurveIds, curve.id]
                        : current.selectedPriceCurveIds.filter((id) => id !== curve.id),
                    }))
                  }
                />
                {curve.label}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 p-4">
          <div>
            <p className="font-semibold text-slate-900">
              {pointLabel(proBillablePointCount)} · zdarma
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Celkem včetně současného stavu:{" "}
              {new Set(
                proVariants.map((variant) => JSON.stringify(variant)),
              ).size.toLocaleString("cs-CZ")}{" "}
              konfigurací. Maximum je 5 000.
            </p>
          </div>
          <button
            type="button"
            className="app-button"
            disabled={
              !site.ready ||
              pending ||
              proBillablePointCount < 1 ||
              proVariants.length > 5_000 ||
              investmentInvalid
            }
            onClick={() => void startPro()}
          >
            Připravit analýzu
          </button>
        </div>
        {latest?.kind === "PRO" && latest.status === "DRAFT" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm text-brand-900">
              <strong>
                {latest.billablePointCount > 0
                  ? `${pointLabel(latest.billablePointCount, false)} ${latest.billablePointCount === 1 ? "je připraven" : "jsou připraveny"}`
                  : "Porovnání všech ceníků je připravené"}
                {latest.compareAllTariffs && latest.billablePointCount > 0
                  ? " včetně všech ceníků"
                  : ""}
                .
              </strong>{" "}
              Výpočet můžete v testovacím provozu spustit zdarma.
            </p>
            <button
              type="button"
              className="app-button"
              disabled={pending}
              onClick={() => void payPro(latest.id)}
            >
              Spustit zdarma
            </button>
          </div>
        )}
      </section>}
      {!advancedOnly && latest && latest.kind === "BASE" && (
        <section className="order-2 app-card overflow-hidden">
          {latest.errorMessage && !latestRunning && (
            <p className="m-4 rounded-xl bg-error-50 p-3 text-sm text-error-700">
              {latest.errorMessage}
            </p>
          )}
          <div className="p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">
                  Roční náklady na energii
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Kliknutím na částku otevřete kompletní ceník a výpočet.
                  <span className="block sm:hidden">
                    Tabulku posunete tažením do stran.
                  </span>
                </p>
              </div>
              <div
                className="inline-flex self-start rounded-xl bg-slate-100 p-1"
                role="group"
                aria-label="Režim řízení"
              >
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    controlMode === "SELF_USE"
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  onClick={() => setControlMode("SELF_USE")}
                >
                  Bez chytrého řízení
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    controlMode === "SMART"
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  onClick={() => setControlMode("SMART")}
                >
                  S chytrým řízením
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[760px] w-full table-fixed text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="sticky left-0 z-20 w-36 bg-slate-50 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Nákup → výkup
                    </th>
                    {rateOptions.map((rate) => {
                      return (
                        <th
                          key={rate}
                          className="px-2 py-3 text-center text-xs font-semibold text-slate-800"
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-white hover:text-brand-700"
                            onClick={() =>
                              setExplanation({ type: "RATE", value: rate })
                            }
                          >
                            {rate}
                            <Info className="size-3.5 text-slate-400" />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {baseMatrixCombinations.map((combination) => (
                    <tr key={combination.key}>
                      <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-left">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md text-left transition hover:text-brand-700"
                          onClick={() =>
                            setExplanation({
                              type: "PRODUCT",
                              value: combination.key,
                            })
                          }
                        >
                          <span className="font-semibold">
                          {combination.label}
                          </span>
                          <Info className="size-3.5 text-slate-400" />
                        </button>
                      </th>
                      {rateOptions.map((rate) => {
                        const row = comparisonMatrixRows.find(
                          (candidate) =>
                            candidate.distributionCode === rate &&
                            productKey(candidate) === combination.key,
                        );
                        const scenario = row ? baseMatrixScenario(row) : null;
                        const cost = scenario?.annualCostCzk ?? null;
                        const best =
                          cost != null && cost === baseMatrixLowestCost;
                        const worst =
                          cost != null && cost === baseMatrixHighestCost;
                        return (
                          <td
                            key={`${combination.key}:${rate}`}
                            className={`p-1.5 text-center ${
                              best
                                ? "bg-emerald-50"
                                : worst
                                  ? "bg-rose-50"
                                  : ""
                            }`}
                          >
                            {scenario ? (
                              <button
                                type="button"
                                disabled={cost == null}
                                className="group w-full rounded-lg px-2 py-2 text-center transition hover:bg-white hover:shadow-sm disabled:cursor-wait"
                                onClick={() =>
                                  cost != null
                                    ? void openScenarioDetail(scenario)
                                    : undefined
                                }
                              >
                                {cost == null ? (
                                  <span className="block">
                                    <span className="mx-auto block h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                                      <span
                                        className={`block h-full rounded-full bg-brand-500 ${
                                          scenario.status === "RUNNING"
                                            ? "w-2/3 animate-pulse"
                                            : "w-1/4"
                                        }`}
                                      />
                                    </span>
                                    <span className="mt-1 block text-[10px] text-slate-400">
                                      počítáme
                                    </span>
                                  </span>
                                ) : (
                                  <>
                                    <strong
                                      className={`block whitespace-nowrap text-sm ${
                                        best
                                          ? "text-emerald-800"
                                          : worst
                                            ? "text-rose-800"
                                          : "text-slate-900"
                                      }`}
                                    >
                                      {money.format(cost)}
                                    </strong>
                                    {best && (
                                      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
                                        Nejlevnější
                                      </span>
                                    )}
                                    {worst && (
                                      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-rose-700">
                                        Nejdražší
                                      </span>
                                    )}
                                    <span className="mt-0.5 block text-[10px] text-slate-400 opacity-0 transition group-hover:opacity-100">
                                      Zobrazit detail
                                    </span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Částka zahrnuje nákup energie, výkup přetoků, distribuci,
              regulované platby i stálé měsíční poplatky. Podrobný rozklad je
              uvnitř každé varianty.
            </p>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="max-w-3xl text-xs leading-5 text-slate-500">
                Tabulka vybírá nejlepší veřejné ceníky. Pro porovnání s vaší
                skutečnou smlouvou stačí nahrát fakturu.
              </p>
            </div>
          </div>
        </section>
      )}
      {latest && latest.kind !== "BASE" && (
        <section className="order-2 app-card overflow-hidden">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Poslední výpočet</h2>
              <p className="mt-1 text-sm text-slate-500">
                {new Date(latest.createdAt).toLocaleString("cs-CZ")} ·{" "}
                {analysisStatusLabel(latest.status)}
                {latest.progress.total > 0
                  ? ` · ${latest.progress.completed}/${latest.progress.total} scénářů`
                  : ""}
              </p>
              {latest.forecastQuality && (
                <p className="mt-1 text-xs text-slate-500">
                  Predikce spotřeby{" "}
                  {latest.forecastQuality.consumption.selected ?? "—"}
                  {latest.forecastQuality.consumption.normalizedMaePct != null
                    ? ` · chyba ${number.format(latest.forecastQuality.consumption.normalizedMaePct)} %`
                    : " · zatím bez dostatečné validace"}{" "}
                  · výroba {latest.forecastQuality.production.selected ?? "—"}
                  {latest.forecastQuality.production.normalizedMaePct != null
                    ? ` · chyba ${number.format(latest.forecastQuality.production.normalizedMaePct)} %`
                    : ""}
                </p>
              )}
              {["QUEUED", "RUNNING"].includes(latest.status) &&
                latest.progress.total > 0 && (
                  <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-brand-500 transition-all"
                      style={{
                        width: `${Math.round((latest.progress.completed / latest.progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                )}
            </div>
            <div className="flex items-center gap-2">
              {latest.kind === "PRO" && latest.status === "COMPLETED" && (
                <a
                  className="app-button app-button-secondary"
                  href={`/api/app/analyses/${latest.id}/export`}
                >
                  <Download className="size-4" /> Stáhnout CSV
                </a>
              )}
              {["DRAFT", "QUEUED"].includes(latest.status) && (
                <button
                  type="button"
                  className="app-button app-button-secondary"
                  disabled={pending}
                  onClick={() => void cancel(latest.id)}
                >
                  Zrušit
                </button>
              )}
              {["QUEUED", "RUNNING"].includes(latest.status) && (
                <RefreshCw className="size-5 animate-spin text-brand-600" />
              )}
            </div>
          </div>
          {latest.errorMessage && !latestRunning && (
            <p className="m-5 rounded-xl bg-error-50 p-3 text-sm text-error-700">
              {latest.errorMessage}
            </p>
          )}
          {latest.scenarios.some(
            (scenario) => scenario.annualCostLowerCzk != null,
          ) && (
            <p className="mx-5 mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              Přesné časy HDO chybí. Uváděné rozpětí vzniklo novou optimalizací
              krajních variant, kdy jsou všechny intervaly ve vysokém,
              respektive nízkém tarifu. Jde o citlivostní mez, ne o
              pravděpodobnostní interval.
            </p>
          )}
          {latest.scenarios.length > 0 && (
            <>
              {latest.kind !== "BASE" && (
              <div className="mx-5 mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
                <strong>
                  Výsledek vychází z {completeDaysLabel(evaluatedDays)}.
                </strong>{" "}
                {latest.dataFrom && latest.dataTo
                  ? `Zdrojová data pokrývají období ${new Date(latest.dataFrom).toLocaleDateString("cs-CZ")}–${new Date(latest.dataTo).toLocaleDateString("cs-CZ")}. `
                  : ""}
                {effectivelyAnnual
                  ? "Rozsah je dostatečný pro roční pohled."
                  : "Roční částky v základní matici jsou modelový přepočet z tohoto období; v technickém detailu proto částky zobrazujeme jen za skutečně vyhodnocené období."}
              </div>
              )}
              {referenceRow && (
                <div className="mx-5 mt-5 rounded-xl border border-slate-300 bg-slate-50 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Výchozí srovnání
                    </p>
                    <h3 className="mt-1 font-semibold text-slate-950">
                      ČEZ · D01d · Elektřina bez závazku
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Standardní nefixovaný nákup ČEZ a spotový výkup ČEZ.
                      Všechny úspory v tabulce porovnáváme s tímto ročním
                      nákladem bez optimálního řízení.
                    </p>
                  </div>
                  <div className="mt-3 shrink-0 text-left sm:mt-0 sm:text-right">
                    <p className="text-xs text-slate-500">Referenční náklad</p>
                    <p className="text-xl font-bold text-slate-950">
                      {referenceAnnualCost == null
                        ? "počítáme…"
                        : money.format(referenceAnnualCost)}
                    </p>
                    {referenceRow.buySourceUrl && (
                      <a
                        className="text-xs font-semibold text-brand-700 underline"
                        href={referenceRow.buySourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Otevřít ceník
                      </a>
                    )}
                  </div>
                </div>
              )}
              {providerSelections.length > 0 && (
                <div className="mx-5 mt-5">
                  <div className="mb-3">
                    <h3 className="font-semibold text-slate-900">
                      Co jsme vybrali z aktuálních ceníků
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      Nákup a prodej vybíráme samostatně. Potom teprve
                      vyhodnocujeme jejich kombinaci na průběhu vaší
                      elektrárny.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {providerSelections.map((selection) => (
                      <article
                        key={selection.label}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {selection.label}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-950">
                          {selection.supplier}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {selection.product}
                        </p>
                        {selection.note && (
                          <p className="mt-1 text-[11px] leading-4 text-slate-500">
                            {selection.note}
                          </p>
                        )}
                        {selection.sourceUrl && (
                          <a
                            className="mt-2 inline-block text-xs font-semibold text-brand-700 underline"
                            href={selection.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Referenční ceník
                          </a>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}
              {matrixRows.length > 0 && (
                <div className="p-5">
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                    <h3 className="font-semibold text-slate-900">
                      Roční náklady podle sazby a produktu
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      V každém řádku je vedle sebe provoz bez optimalizace a
                      matematicky optimalizované řízení stejné elektrárny.
                      Dodavatele vybíráme podle nejnižšího modelovaného nákladu
                      z právě publikovaných referenčních ceníků v katalogu.
                    </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select
                        aria-label="Filtrovat distribuční sazbu"
                        className="app-input min-w-36 py-2 text-sm"
                        value={rateFilter}
                        onChange={(event) => setRateFilter(event.target.value)}
                      >
                        <option value="ALL">Všechny sazby</option>
                        {rateOptions.map((rate) => (
                          <option key={rate} value={rate}>
                            {rate}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Filtrovat způsob nákupu a prodeje"
                        className="app-input min-w-52 py-2 text-sm"
                        value={productFilter}
                        onChange={(event) =>
                          setProductFilter(event.target.value)
                        }
                      >
                        <option value="ALL">Všechny produkty</option>
                        <option value="FIX:FIX">Fix nákup · fix prodej</option>
                        <option value="FIX:SPOT">
                          Fix nákup · spot prodej
                        </option>
                        <option value="SPOT:SPOT">
                          Spot nákup · spot prodej
                        </option>
                      </select>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Sazba</th>
                          <th className="px-4 py-3">Nákup → prodej</th>
                          <th className="px-4 py-3">Nákup od</th>
                          <th className="px-4 py-3">Prodej do</th>
                          <th className="px-4 py-3 text-right">Roční náklad</th>
                          <th className="px-4 py-3 text-right">
                            Přínos optima
                          </th>
                          <th className="px-4 py-3 text-right">
                            Proti ČEZ D01d
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredMatrixRows.map((row) => {
                          const annualSelfUseCost =
                            row.selfUse?.annualCostCzk ?? null;
                          const annualSmartCost =
                            row.smart?.annualCostCzk ?? null;
                          const comparisonCost =
                            annualSmartCost ?? annualSelfUseCost;
                          const controlBenefit =
                            annualSelfUseCost != null &&
                            annualSmartCost != null
                              ? annualSelfUseCost - annualSmartCost
                              : null;
                          const baselineBenefit =
                            referenceAnnualCost != null &&
                            comparisonCost != null
                              ? referenceAnnualCost - comparisonCost
                              : null;
                          const cheapest =
                            comparisonCost != null &&
                            comparisonCost === lowestRowCost;
                          const mostExpensive =
                            comparisonCost != null &&
                            comparisonCost === highestRowCost &&
                            highestRowCost !== lowestRowCost;
                          return (
                            <tr
                              key={row.priceCurveId}
                              className={
                                cheapest
                                  ? "bg-emerald-50/70"
                                  : mostExpensive
                                    ? "bg-rose-50/50"
                                    : ""
                              }
                            >
                              <td className="whitespace-nowrap px-4 py-4 align-top">
                                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                                  {row.distributionCode ?? "Neuvedená"}
                                  {row.eligibilityNote && (
                                    <button
                                      type="button"
                                      className="inline-flex size-5 items-center justify-center rounded-full border border-slate-300 text-xs font-bold text-slate-500"
                                      title={row.eligibilityNote}
                                      aria-label={`${row.distributionCode}: ${row.eligibilityNote}`}
                                    >
                                      ?
                                    </button>
                                  )}
                                </span>
                                {cheapest && (
                                  <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                    Nejlevnější
                                  </span>
                                )}
                                {mostExpensive && (
                                  <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                                    Nejdražší
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-4 align-top">
                                <span className="font-medium text-slate-900">
                                  {row.pricingMode === "SPOT"
                                    ? "Spot"
                                    : row.pricingMode === "FIX"
                                      ? "Fix"
                                      : row.pricingMode}{" "}
                                  →{" "}
                                  {row.sellPricingMode === "SPOT"
                                    ? "spot"
                                    : row.sellPricingMode === "FIX"
                                      ? "fix"
                                      : row.sellPricingMode}
                                </span>
                                <span className="mt-1 block whitespace-nowrap text-[11px] text-slate-500">
                                  Nákup{" "}
                                  {row.pricingMode === "SPOT"
                                    ? `OTE + ${unitPrice.format(row.spotBuyFeeCzkKwh ?? 0)} Kč/kWh`
                                    : `${unitPrice.format(row.fixedBuyVtCzkKwh ?? 0)} Kč/kWh${
                                        row.fixedBuyNtCzkKwh != null &&
                                        row.fixedBuyNtCzkKwh !==
                                          row.fixedBuyVtCzkKwh
                                          ? ` · NT ${unitPrice.format(row.fixedBuyNtCzkKwh)}`
                                          : ""
                                      }`}
                                </span>
                                <span className="block whitespace-nowrap text-[11px] text-slate-500">
                                  Prodej{" "}
                                  {row.sellPricingMode === "SPOT"
                                    ? `OTE − ${unitPrice.format(row.spotSellFeeCzkKwh ?? 0)} Kč/kWh`
                                    : `${unitPrice.format(row.fixedSellVtCzkKwh ?? 0)} Kč/kWh`}
                                </span>
                              </td>
                              <td className="px-4 py-4 align-top text-slate-700">
                                <span className="block font-medium text-slate-900">
                                  {row.buySupplierName}
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-slate-500">
                                  {row.productName}
                                </span>
                                {row.buySourceUrl && (
                                  <a
                                    className="mt-1 inline-block text-xs font-semibold text-brand-700 underline"
                                    href={row.buySourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    ceník
                                  </a>
                                )}
                              </td>
                              <td className="px-4 py-4 align-top text-slate-700">
                                <span className="block font-medium text-slate-900">
                                  {row.sellSupplierName}
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-slate-500">
                                  {row.sellProductName}
                                </span>
                                {row.sellSourceUrl && (
                                  <a
                                    className="mt-1 inline-block text-xs font-semibold text-brand-700 underline"
                                    href={row.sellSourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    ceník
                                  </a>
                                )}
                              </td>
                              <td className="min-w-48 px-4 py-4 text-right align-top">
                                <span className="block text-xs text-slate-500">
                                  Bez řízení{" "}
                                  <strong className="ml-1 font-medium text-slate-800">
                                    {annualSelfUseCost == null
                                      ? row.selfUse?.status === "RUNNING"
                                        ? "počítáme…"
                                        : "čeká"
                                      : money.format(annualSelfUseCost)}
                                  </strong>
                                </span>
                                <span className="mt-1 block text-xs text-slate-500">
                                  Optimální řízení{" "}
                                  <strong className="ml-1 text-sm font-bold text-slate-950">
                                    {annualSmartCost == null
                                      ? row.smart?.status === "RUNNING"
                                        ? "počítáme…"
                                        : "čeká"
                                      : money.format(annualSmartCost)}
                                  </strong>
                                </span>
                                {(annualSelfUseCost == null ||
                                  annualSmartCost == null) && (
                                  <span className="ml-auto mt-2 block h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                                    <span
                                      className={`block h-full rounded-full bg-brand-500 ${
                                        row.selfUse?.status === "RUNNING" ||
                                        row.smart?.status === "RUNNING"
                                          ? "w-2/3 animate-pulse"
                                          : "w-1/4"
                                      }`}
                                    />
                                  </span>
                                )}
                              </td>
                              <td
                                className={`px-4 py-4 text-right align-top font-semibold ${
                                  controlBenefit == null
                                    ? "text-slate-400"
                                    : controlBenefit > 0
                                      ? "text-emerald-700"
                                      : "text-slate-600"
                                }`}
                              >
                                {controlBenefit == null
                                  ? "čeká"
                                  : controlBenefit > 0
                                    ? money.format(controlBenefit)
                                    : "bez zhoršení"}
                              </td>
                              <td
                                className={`px-4 py-4 text-right align-top font-semibold ${
                                  baselineBenefit == null
                                    ? "text-slate-400"
                                    : baselineBenefit > 0
                                      ? "text-emerald-700"
                                      : "text-rose-700"
                                }`}
                              >
                                {baselineBenefit == null
                                  ? "čeká"
                                  : baselineBenefit >= 0
                                    ? money.format(baselineBenefit)
                                    : `o ${money.format(Math.abs(baselineBenefit))} dráž`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-col gap-1 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      <strong className="text-slate-700">
                        Optimální řízení
                      </strong>{" "}
                      je minimum nalezené pro stejné ceny, předpověď a technické
                      limity. Vyšší deklarovanou úsporu lze porovnávat jen nad
                      stejnými vstupy.
                    </p>
                    <p className="shrink-0">
                      Odhad z {completeDaysLabel(evaluatedDays)} dat
                    </p>
                  </div>
                </div>
              )}
              {latest.kind !== "BASE" && (
              <div className="grid gap-3 p-5 sm:grid-cols-3">
                {bestSmartScenarios.map((scenario, index) => (
                  <article
                    key={scenario.id}
                    className={`rounded-xl border p-4 ${index === 0 ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {index === 0
                        ? "Doporučený scénář"
                        : `${index + 1}. nejnižší náklad`}
                    </p>
                    <h3 className="mt-2 text-sm font-semibold text-slate-900">
                      {scenario.priceLabel}
                    </h3>
                    <p className="mt-3 text-xl font-bold text-slate-950">
                      {money.format(
                        displayedAmount(scenario.annualCostCzk) ?? 0,
                      )}{" "}
                      / {amountPeriodLabel}
                    </p>
                    {scenario.annualCostLowerCzk != null &&
                      scenario.annualCostUpperCzk != null && (
                        <p className="mt-1 text-xs text-amber-800">
                          HDO rozpětí{" "}
                          {money.format(
                            displayedAmount(scenario.annualCostLowerCzk) ?? 0,
                          )}
                          –
                          {money.format(
                            displayedAmount(scenario.annualCostUpperCzk) ?? 0,
                          )}
                        </p>
                      )}
                    <p
                      className={`mt-1 text-xs ${
                        (displayedAmount(savingsValue(scenario)) ?? 0) >= 0
                          ? "text-emerald-700"
                          : "text-amber-800"
                      }`}
                    >
                      {(displayedAmount(savingsValue(scenario)) ?? 0) >= 0
                        ? scenario.savingsVsBaselineCzk != null
                          ? "Úspora proti dnešku"
                          : "Úspora řízením proti self-use"
                        : scenario.savingsVsBaselineCzk != null
                          ? "Vyšší náklad proti dnešku"
                          : "Vyšší náklad proti self-use"}{" "}
                      {money.format(
                        Math.abs(displayedAmount(savingsValue(scenario)) ?? 0),
                      )}
                    </p>
                    {scenario.investmentAssessment && (
                      <p className="mt-2 text-xs text-slate-600">
                        Investice po dotaci a financování{" "}
                        {money.format(
                          scenario.investmentAssessment.effectiveInvestmentCzk,
                        )}
                        {scenario.investmentAssessment.simplePaybackYears !=
                        null
                          ? ` · návratnost ${number.format(scenario.investmentAssessment.simplePaybackYears)} roku`
                          : " · návratnost nelze vyčíslit"}
                      </p>
                    )}
                  </article>
                ))}
              </div>
              )}
              {latest.kind !== "BASE" && (
              <>
              <div className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                <p className="max-w-3xl leading-6">
                  {workspace.supplierFulfillment.message}
                </p>
                {workspace.supplierFulfillment.directContractingAvailable && (
                  <a
                    className="app-button"
                    href={`/app/sluzba?energyOffer=${encodeURIComponent(bestSmartId ?? "")}`}
                  >
                    Poptat dodávku u SpotTEXu
                  </a>
                )}
              </div>
              <details className="border-t border-slate-100">
                <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-brand-700">
                  Zobrazit technický detail ({latest.scenarios.length} scénářů)
                </summary>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Scénář</th>
                        <th className="px-5 py-3">Režim</th>
                        <th className="px-5 py-3 text-right">
                          Náklad {amountLabel}
                        </th>
                        <th className="px-5 py-3 text-right">
                          Úspora {amountLabel}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {latest.scenarios.map((scenario) => (
                        <tr
                          key={scenario.id}
                          className={
                            scenario.id === bestSmartId
                              ? "bg-emerald-50/60"
                              : scenario.currentScenario
                                ? "bg-violet-50/60"
                                : scenario.currentDistribution
                                  ? "bg-blue-50/40"
                                  : ""
                          }
                        >
                          <td className="px-5 py-4 text-slate-700">
                            <span className="font-medium text-slate-900">
                              {scenario.priceLabel}
                            </span>
                            <span className="mt-1 block text-xs text-slate-400">
                              {number.format(scenario.pvCapacityKwp)} kWp ·{" "}
                              {number.format(scenario.batteryCapacityKwh)} kWh
                              {scenario.mainFuseA != null
                                ? ` · jistič ${number.format(scenario.mainFuseA)} A`
                                : ""}{" "}
                              · HDO {String(scenario.hdoMode)}
                              {scenario.investmentAssessment
                                ?.simplePaybackYears != null
                                ? ` · návratnost ${number.format(scenario.investmentAssessment.simplePaybackYears)} roku`
                                : ""}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-1">
                              {scenario.currentScenario && (
                                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                                  Váš současný scénář
                                </span>
                              )}
                              {scenario.currentDistribution && (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                                  Vaše distribuční sazba
                                </span>
                              )}
                              {scenario.id === bestSmartId && (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                  Nejnižší vypočtený náklad
                                </span>
                              )}
                            </span>
                            {scenario.distributionEligibilityNote && (
                              <span className="mt-1 block text-xs text-amber-700">
                                Nárok na sazbu je nutné ověřit:{" "}
                                {scenario.distributionEligibilityNote}
                              </span>
                            )}
                            {scenario.status === "INELIGIBLE" && (
                              <span className="mt-1 block text-xs font-medium text-red-700">
                                Nevyhovuje limitu připojení:{" "}
                                {number.format(scenario.unservedKwh)} kWh by
                                nebylo možné dodat.
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 font-medium text-slate-900">
                            {scenario.controlMode === "SELF_USE"
                              ? "Self-use"
                              : "Chytré"}
                          </td>
                          <td className="px-5 py-4 text-right font-medium text-slate-900">
                            {scenario.status === "INELIGIBLE" ||
                            scenario.annualCostCzk == null ? (
                              "Nelze vyčíslit"
                            ) : (
                              <>
                                {money.format(
                                  displayedAmount(scenario.annualCostCzk) ?? 0,
                                )}
                                {scenario.annualCostLowerCzk != null &&
                                  scenario.annualCostUpperCzk != null && (
                                    <span className="mt-1 block whitespace-nowrap text-[10px] font-normal text-amber-700">
                                      HDO{" "}
                                      {money.format(
                                        displayedAmount(
                                          scenario.annualCostLowerCzk,
                                        ) ?? 0,
                                      )}
                                      –
                                      {money.format(
                                        displayedAmount(
                                          scenario.annualCostUpperCzk,
                                        ) ?? 0,
                                      )}
                                    </span>
                                  )}
                                <span className="mt-1 block whitespace-nowrap text-[10px] font-normal text-slate-400">
                                  nákup{" "}
                                  {money.format(
                                    displayedAmount(
                                      scenario.annualImportCostCzk,
                                    ) ?? 0,
                                  )}{" "}
                                  − výkup{" "}
                                  {money.format(
                                    displayedAmount(
                                      scenario.annualExportRevenueCzk,
                                    ) ?? 0,
                                  )}{" "}
                                  + stálé{" "}
                                  {money.format(
                                    displayedAmount(
                                      scenario.annualFixedCostCzk,
                                    ) ?? 0,
                                  )}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right text-emerald-700">
                            {scenario.status === "COMPLETED" &&
                            savingsValue(scenario) != null ? (
                              <>
                                {money.format(
                                  displayedAmount(savingsValue(scenario)) ?? 0,
                                )}
                                <span className="mt-1 block whitespace-nowrap text-[10px] font-normal text-slate-500">
                                  produkt{" "}
                                  {money.format(
                                    displayedAmount(
                                      scenario.savingsProductCzk,
                                    ) ?? 0,
                                  )}{" "}
                                  · distribuce{" "}
                                  {money.format(
                                    displayedAmount(
                                      scenario.savingsDistributionCzk,
                                    ) ?? 0,
                                  )}{" "}
                                  · řízení{" "}
                                  {money.format(
                                    displayedAmount(
                                      scenario.savingsControlCzk,
                                    ) ?? 0,
                                  )}
                                </span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              </>
              )}
            </>
          )}
        </section>
      )}
      {inputModalOpen && (
        <InputDataModal
          site={site}
          data={inputSeries}
          loading={inputSeriesLoading}
          error={inputSeriesError}
          onRange={zoomInputData}
          onReset={() => void loadInputData()}
          onClose={() => setInputModalOpen(false)}
        />
      )}
      {scenarioModalId && (
        <ScenarioDetailModal
          scenario={selectedScenarioForModal}
          detail={scenarioDetail}
          loading={scenarioDetailLoading}
          error={scenarioDetailError}
          selectedDay={selectedDetailDay}
          onSelectedDay={setSelectedDetailDay}
          detailMode={detailMode}
          onDetailMode={setDetailMode}
          onClose={() => {
            setScenarioModalId(null);
            setScenarioDetail(null);
          }}
        />
      )}
      {explanation && (
        <AnalysisExplanationModal
          explanation={explanation}
          catalogCount={workspace.catalogStats.productVersions}
          rows={comparisonMatrixRows
            .filter(
              (row) =>
                explanation.type !== "PRODUCT" ||
                productKey(row) === explanation.value,
            )
            .map((row) => ({
              distributionCode: row.distributionCode,
              buySupplierName: row.buySupplierName,
              productName: row.productName,
              sellSupplierName: row.sellSupplierName,
              sellProductName: row.sellProductName,
              eligibilityNote: row.eligibilityNote,
              distributionVtCzkKwh: row.selfUse?.distributionVtCzkKwh ?? null,
              distributionNtCzkKwh: row.selfUse?.distributionNtCzkKwh ?? null,
              systemServicesCzkKwh: row.selfUse?.systemServicesCzkKwh ?? null,
              electricityTaxCzkKwh: row.selfUse?.electricityTaxCzkKwh ?? null,
              pozeCzkKwh: row.selfUse?.pozeCzkKwh ?? null,
              monthlyMeterFeeCzk: row.selfUse?.monthlyMeterFeeCzk ?? null,
              monthlyBreakerFeeCzk: row.selfUse?.monthlyBreakerFeeCzk ?? null,
              mainFuseA: row.selfUse?.mainFuseA ?? null,
              hdoMode: row.selfUse?.hdoMode,
              fixedBuyVtCzkKwh: row.fixedBuyVtCzkKwh,
              fixedBuyNtCzkKwh: row.fixedBuyNtCzkKwh,
              spotBuyFeeCzkKwh: row.spotBuyFeeCzkKwh,
              fixedSellVtCzkKwh: row.fixedSellVtCzkKwh,
              spotSellFeeCzkKwh: row.spotSellFeeCzkKwh,
            }))}
          onClose={() => setExplanation(null)}
        />
      )}
    </div>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Zavřít"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

const rateDescriptions: Record<string, string> = {
  D01d: "Jednotarifní sazba pro odběrná místa s velmi malou spotřebou.",
  D02d: "Běžná jednotarifní sazba pro domácnosti bez elektrického vytápění.",
  D25d: "Dvoutarifní sazba určená zejména pro elektrický ohřev vody.",
  D26d: "Dvoutarifní sazba pro vyšší spotřebu s akumulačním vytápěním.",
  D27d: "Dvoutarifní sazba určená pro domácí nabíjení elektromobilu.",
};

function AnalysisExplanationModal({
  explanation,
  catalogCount,
  rows,
  onClose,
}: {
  explanation:
    | { type: "RATE"; value: string }
    | { type: "PRODUCT"; value: string };
  catalogCount: number;
  rows: Array<{
    distributionCode: string | null;
    buySupplierName: string;
    productName: string;
    sellSupplierName: string;
    sellProductName: string;
    eligibilityNote: string | null;
    distributionVtCzkKwh: number | null;
    distributionNtCzkKwh: number | null;
    systemServicesCzkKwh: number | null;
    electricityTaxCzkKwh: number | null;
    pozeCzkKwh: number | null;
    monthlyMeterFeeCzk: number | null;
    monthlyBreakerFeeCzk: number | null;
    mainFuseA: number | null;
    hdoMode: unknown;
    fixedBuyVtCzkKwh: number | null;
    fixedBuyNtCzkKwh: number | null;
    spotBuyFeeCzkKwh: number | null;
    fixedSellVtCzkKwh: number | null;
    spotSellFeeCzkKwh: number | null;
  }>;
  onClose: () => void;
}) {
  const availableRates = [
    ...new Set(
      rows
        .map((row) => row.distributionCode)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const [selectedRate, setSelectedRate] = useState(availableRates[0] ?? "");
  if (explanation.type === "RATE") {
    const row = rows.find(
      (candidate) => candidate.distributionCode === explanation.value,
    );
    return (
      <ModalShell title={`Distribuční sazba ${explanation.value}`} onClose={onClose}>
        <div className="max-w-2xl text-sm leading-6 text-slate-600">
          <p>
            {rateDescriptions[explanation.value] ??
              "Distribuční sazba s vlastními podmínkami distributora."}
          </p>
          {row?.eligibilityNote && (
            <p className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-950">
              {row.eligibilityNote}
            </p>
          )}
          {row && (
            <dl className="mt-4 grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
              {[
                ["Distribuce VT", row.distributionVtCzkKwh == null ? "—" : `${unitPrice.format(row.distributionVtCzkKwh)} Kč/kWh`],
                ["Distribuce NT", row.distributionNtCzkKwh == null ? "—" : `${unitPrice.format(row.distributionNtCzkKwh)} Kč/kWh`],
                ["Systémové služby + daň + POZE", `${unitPrice.format((row.systemServicesCzkKwh ?? 0) + (row.electricityTaxCzkKwh ?? 0) + (row.pozeCzkKwh ?? 0))} Kč/kWh`],
                ["Měření + jistič", money.format((row.monthlyMeterFeeCzk ?? 0) + (row.monthlyBreakerFeeCzk ?? 0)) + " / měsíc"],
                ["Uvažovaný jistič", row.mainFuseA == null ? "—" : `${row.mainFuseA} A`],
                ["Přepínání VT/NT", conditionSummary(row.hdoMode)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Výsledek v tabulce ukazuje, kolik by stejný provoz stál při této
            sazbě. Nárok na sazbu je potřeba potvrdit s distributorem.
          </p>
        </div>
      </ModalShell>
    );
  }
  const [buyMode, sellMode] = explanation.value.split(":");
  const selectedOffer =
    rows.find((row) => row.distributionCode === selectedRate) ?? rows[0];
  return (
    <ModalShell
      title={`${buyMode === "FIX" ? "Fixní" : "Spotový"} nákup → ${
        sellMode === "FIX" ? "fixní" : "spotový"
      } výkup`}
      subtitle={`Výběr z ${catalogCount.toLocaleString("cs-CZ")} publikovaných ceníkových verzí`}
      onClose={onClose}
    >
      <p className="max-w-3xl text-sm leading-6 text-slate-600">
        Pro každou distribuční sazbu porovnáváme dostupné ceníky a do hlavní
        tabulky dáváme kombinaci s nejnižším ročním nákladem. Dražší použitelné
        nabídky se do matice nezobrazují.
      </p>
      {availableRates.length > 1 && (
        <label className="mt-4 block max-w-xs text-sm font-medium text-slate-700">
          Distribuční sazba
          <select className="app-input mt-1.5" value={selectedRate} onChange={(event) => setSelectedRate(event.target.value)}>
            {availableRates.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
          </select>
        </label>
      )}
      <div className="mt-4 rounded-xl border border-slate-200">
        {selectedOffer && (
          <div
            className="grid gap-2 p-4 text-sm sm:grid-cols-2"
          >
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">Nákup</p>
              <p className="mt-1 font-semibold text-slate-900">{selectedOffer.buySupplierName}</p>
              <p className="text-slate-500">{selectedOffer.productName}</p>
              <p className="mt-2 text-xs text-slate-600">
                {buyMode === "SPOT"
                  ? `OTE + ${unitPrice.format(selectedOffer.spotBuyFeeCzkKwh ?? 0)} Kč/kWh`
                  : `${unitPrice.format(selectedOffer.fixedBuyVtCzkKwh ?? 0)} Kč/kWh VT${selectedOffer.fixedBuyNtCzkKwh != null ? ` · ${unitPrice.format(selectedOffer.fixedBuyNtCzkKwh)} Kč/kWh NT` : ""}`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">Výkup</p>
              <p className="mt-1 font-semibold text-slate-900">{selectedOffer.sellSupplierName}</p>
              <p className="text-slate-500">{selectedOffer.sellProductName}</p>
              <p className="mt-2 text-xs text-slate-600">
                {sellMode === "SPOT"
                  ? `OTE − ${unitPrice.format(selectedOffer.spotSellFeeCzkKwh ?? 0)} Kč/kWh`
                  : `${unitPrice.format(selectedOffer.fixedSellVtCzkKwh ?? 0)} Kč/kWh`}
              </p>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function InputDataModal({
  site,
  data,
  loading,
  error,
  onRange,
  onReset,
  onClose,
}: {
  site: Workspace["sites"][number];
  data: InputSeries | null;
  loading: boolean;
  error: string | null;
  onRange: (from: string, to: string, days: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const chartData =
    data?.series.map((point) => ({
      ...point,
      label: new Intl.DateTimeFormat("cs-CZ", {
        day: "numeric",
        month: "numeric",
        year: ["WEEK", "DAY"].includes(data.resolution) ? "2-digit" : undefined,
        hour: ["WEEK", "DAY"].includes(data.resolution) ? undefined : "2-digit",
        minute: data.resolution === "15MIN" ? "2-digit" : undefined,
        timeZone: data.site.timezone,
      }).format(new Date(point.at)),
    })) ?? [];
  const resolutionLabel =
    data?.resolution === "15MIN"
      ? "15minutový průběh"
      : data?.resolution === "HOUR"
        ? "Hodinový průběh"
        : data?.resolution === "WEEK"
          ? "Týdenní výroba a spotřeba"
          : "Denní výroba a spotřeba";
  const showsFullRange = Boolean(
    data &&
      (!site.dataQuality.from ||
        new Date(data.range.from) <= new Date(site.dataQuality.from)) &&
      (!site.dataQuality.to ||
        new Date(data.range.to) >= new Date(site.dataQuality.to)),
  );
  function zoomWithWheel(event: WheelEvent<HTMLDivElement>) {
    if (!data) return;
    event.preventDefault();
    const currentFrom = new Date(data.range.from).getTime();
    const currentTo = new Date(data.range.to).getTime();
    const fullFrom = site.dataQuality.from
      ? new Date(site.dataQuality.from).getTime()
      : currentFrom;
    const fullTo = site.dataQuality.to
      ? new Date(site.dataQuality.to).getTime() + 15 * 60_000
      : currentTo;
    const currentSpan = Math.max(6 * 3_600_000, currentTo - currentFrom);
    const nextSpan = Math.min(
      Math.max(6 * 3_600_000, currentSpan * (event.deltaY < 0 ? 0.6 : 1.65)),
      Math.max(6 * 3_600_000, fullTo - fullFrom),
    );
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)),
    );
    let nextFrom = currentFrom - (nextSpan - currentSpan) * anchor;
    let nextTo = nextFrom + nextSpan;
    if (nextFrom < fullFrom) {
      nextFrom = fullFrom;
      nextTo = Math.min(fullTo, nextFrom + nextSpan);
    }
    if (nextTo > fullTo) {
      nextTo = fullTo;
      nextFrom = Math.max(fullFrom, nextTo - nextSpan);
    }
    const days = Math.max(1, (nextTo - nextFrom) / 86_400_000);
    onRange(
      new Date(nextFrom).toISOString(),
      new Date(nextTo).toISOString(),
      days,
    );
  }
  return (
    <ModalShell
      title="Data použitá pro výpočet"
      subtitle={`${site.name} · posledních ${completeDaysLabel(site.dataQuality.coverageDays)}`}
      onClose={onClose}
    >
      {loading ? (
        <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="size-5 animate-spin text-brand-600" />
          Načítáme měřený průběh…
        </div>
      ) : error ? (
        <p className="rounded-xl bg-error-50 p-4 text-sm text-error-700">
          {error}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <DataStat
              label="Spotřeba"
              value={`${number.format(site.dataQuality.annualizedConsumptionKwh / 1_000)} MWh/rok`}
            />
            <DataStat
              label="Výroba"
              value={`${number.format(site.dataQuality.annualizedProductionKwh / 1_000)} MWh/rok`}
            />
            <DataStat
              label="Historická data"
              value={completeDaysLabel(site.dataQuality.coverageDays)}
            />
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  {resolutionLabel}
                </h3>
              <p className="mt-1 text-xs text-slate-500">
                  Zeleně je výroba, šedě spotřeba. Podle rozsahu automaticky
                  přepínáme týdny, dny, hodiny a 15minutová měření. Kolečkem
                  myši přiblížíte období pod kurzorem.
              </p>
              </div>
              {!showsFullRange && (
                <button type="button" className="app-button app-button-secondary" onClick={onReset}>
                  Zobrazit celý rok
                </button>
              )}
            </div>
            <div
              className="mt-4 h-72 min-w-0 cursor-zoom-in"
              onWheel={zoomWithWheel}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ left: -12, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    minTickGap={48}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    unit=" kWh"
                    domain={[0, "auto"]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) => [
                      `${number.format(Number(value))} kWh`,
                    ]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.at
                        ? new Intl.DateTimeFormat("cs-CZ", {
                            dateStyle: "medium",
                            timeStyle: ["WEEK", "DAY"].includes(data?.resolution ?? "DAY")
                              ? undefined
                              : "short",
                            timeZone: data?.site.timezone,
                          }).format(new Date(payload[0].payload.at))
                        : ""
                    }
                    contentStyle={{
                      borderRadius: 12,
                      borderColor: "#e2e8f0",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    name="Výroba"
                    type="linear"
                    dataKey="productionKwh"
                    stroke="#65a30d"
                    fill="#84cc16"
                    fillOpacity={0.18}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Area
                    name="Spotřeba"
                    type="linear"
                    dataKey="consumptionKwh"
                    stroke="#475569"
                    fill="#64748b"
                    fillOpacity={0.1}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  {["WEEK", "DAY"].includes(data?.resolution ?? "") && (
                    <Brush
                      dataKey="label"
                      height={28}
                      travellerWidth={10}
                      stroke="#94a3b8"
                      fill="#f8fafc"
                      startIndex={Math.max(0, chartData.length - 90)}
                      endIndex={Math.max(0, chartData.length - 1)}
                      onChange={(range) => {
                        const startIndex = range.startIndex ?? 0;
                        const endIndex = range.endIndex ?? chartData.length - 1;
                        const start = chartData[startIndex];
                        const end = chartData[endIndex];
                        if (!start || !end) return;
                        const bucketMs =
                          data?.resolution === "WEEK"
                            ? 7 * 86_400_000
                            : 86_400_000;
                        const to = new Date(
                          new Date(end.at).getTime() + bucketMs,
                        ).toISOString();
                        const days = Math.max(
                          1,
                          (new Date(to).getTime() -
                            new Date(start.at).getTime()) /
                            86_400_000,
                        );
                        onRange(start.at, to, days);
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function ScenarioDetailModal({
  scenario,
  detail,
  loading,
  error,
  selectedDay,
  onSelectedDay,
  detailMode,
  onDetailMode,
  onClose,
}: {
  scenario: Scenario | null;
  detail: ScenarioDetail | null;
  loading: boolean;
  error: string | null;
  selectedDay: string;
  onSelectedDay: (value: string) => void;
  detailMode: "SELF_USE" | "SMART";
  onDetailMode: (value: "SELF_USE" | "SMART") => void;
  onClose: () => void;
}) {
  const activeEvidence =
    detailMode === "SMART"
      ? detail?.comparison.smart
      : detail?.comparison.selfUse;
  const monthlyData =
    activeEvidence?.periods.monthly.map((period) => {
      const [year, month] = period.key.split("-").map(Number);
      const days = new Date(year, month, 0).getDate();
      const fixed =
        (detail?.monthlyFixedTotalCzk ?? 0) *
        Math.min(1, period.intervals / (days * 96));
      return {
        ...period,
        label: new Date(year, month - 1, 1).toLocaleDateString("cs-CZ", {
          month: "short",
          year: "2-digit",
        }),
        purchase: Math.round(period.importCostCzk),
        sale: -Math.round(period.exportRevenueCzk),
        total: Math.round(period.variableCostCzk + fixed),
      };
    }) ?? [];
  const [selectedMonth, setSelectedMonth] = useState("");
  useEffect(() => {
    const months = activeEvidence?.periods.monthly ?? [];
    setSelectedMonth(months.at(-1)?.key ?? "");
  }, [activeEvidence?.id, activeEvidence?.periods.monthly, detailMode]);
  const dailyData =
    activeEvidence?.periods.daily
      .filter((period) => period.key.startsWith(`${selectedMonth}-`))
      .map((period) => ({
        ...period,
        label: new Date(`${period.key}T12:00:00`).toLocaleDateString("cs-CZ", {
          day: "numeric",
        }),
        purchase: Math.round(period.importCostCzk),
        sale: -Math.round(period.exportRevenueCzk),
        total: Math.round(period.variableCostCzk),
      })) ?? [];
  function chooseMonth(key: string) {
    setSelectedMonth(key);
    const lastDay = activeEvidence?.periods.daily
      .filter((period) => period.key.startsWith(`${key}-`))
      .at(-1);
    if (lastDay) onSelectedDay(lastDay.key);
  }
  const selectedDayDetail =
    activeEvidence?.periods.daily.find((period) => period.key === selectedDay) ??
    null;
  const selfUseDay =
    detail?.comparison.selfUse?.periods.daily.find(
      (period) => period.key === selectedDay,
    ) ?? null;
  const smartDay =
    detail?.comparison.smart?.periods.daily.find(
      (period) => period.key === selectedDay,
    ) ?? null;
  return (
    <ModalShell
      title={
        scenario
          ? `${scenario.distributionCode ?? ""} · ${
              scenario.pricingMode === "SPOT" ? "Spot" : "Fix"
            } → ${scenario.sellPricingMode === "SPOT" ? "spot" : "fix"}`
          : "Detail scénáře"
      }
      subtitle={
        scenario
          ? `${scenario.buySupplierName} → ${scenario.sellSupplierName}`
          : undefined
      }
      onClose={onClose}
    >
      {loading ? (
        <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="size-5 animate-spin text-brand-600" />
          Načítáme rozklad výpočtu…
        </div>
      ) : error ? (
        <p className="rounded-xl bg-error-50 p-4 text-sm text-error-700">
          {error}
        </p>
      ) : detail && detail.status !== "COMPLETED" ? (
        <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500">
          <LoaderCircle className="size-5 animate-spin text-brand-600" />
          Tuto variantu ještě počítáme. Výsledek se zobrazí po dokončení.
        </div>
      ) : detail ? (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[minmax(120px,1fr)_minmax(110px,1fr)_minmax(110px,1fr)] bg-slate-50 text-xs font-semibold text-slate-500">
              <div className="p-3">Roční souhrn</div>
              <div className="p-3 text-right">Bez řízení</div>
              <div className="p-3 text-right">S řízením</div>
            </div>
            {[
              ["Roční náklad", "annualCostCzk"],
              ["Nákup energie", "annualImportCostCzk"],
              ["Výkup přetoků", "annualExportRevenueCzk"],
              ["Stálé poplatky", "annualFixedCostCzk"],
            ].map(([label, key]) => {
              const property = key as
                | "annualCostCzk"
                | "annualImportCostCzk"
                | "annualExportRevenueCzk"
                | "annualFixedCostCzk";
              const selfUse = detail.comparison.selfUse?.[property] ?? null;
              const smart = detail.comparison.smart?.[property] ?? null;
              return (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(120px,1fr)_minmax(110px,1fr)_minmax(110px,1fr)] border-t border-slate-100 text-sm"
                >
                  <div className="p-3 font-medium text-slate-700">{label}</div>
                  <div className="p-3 text-right font-semibold text-slate-900">
                    {selfUse == null ? "—" : money.format(selfUse)}
                  </div>
                  <div
                    className={`p-3 text-right font-semibold ${
                      property === "annualCostCzk" &&
                      selfUse != null &&
                      smart != null &&
                      smart < selfUse
                        ? "bg-emerald-50 text-emerald-800"
                        : "text-slate-900"
                    }`}
                  >
                    {smart == null ? "—" : money.format(smart)}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Roční náklad = nákup − výnos z výkupu + stálé poplatky.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <PriceCard
              title="Nákup energie"
              supplier={detail.buy?.supplier}
              product={detail.buy?.product}
              rows={[
                [
                  "Cena",
                  detail.buy?.mode === "SPOT"
                    ? `OTE + ${unitPrice.format(detail.buy.spotFeeCzkKwh ?? 0)} Kč/kWh`
                    : `${unitPrice.format(detail.buy?.fixedVtCzkKwh ?? 0)} Kč/kWh VT${
                        detail.buy?.fixedNtCzkKwh != null &&
                        detail.buy.fixedNtCzkKwh !== detail.buy.fixedVtCzkKwh
                          ? ` · ${unitPrice.format(detail.buy.fixedNtCzkKwh)} Kč/kWh NT`
                          : ""
                      }`,
                ],
                [
                  "Měsíční plat",
                  money.format(detail.buy?.monthlyFeeCzk ?? 0),
                ],
              ]}
              note={detail.buy?.availabilityNote}
            />
            <PriceCard
              title="Výkup přetoků"
              supplier={detail.sell?.supplier}
              product={detail.sell?.product}
              rows={[
                [
                  "Cena",
                  detail.sell?.mode === "SPOT"
                    ? `OTE − ${unitPrice.format(detail.sell.spotFeeCzkKwh ?? 0)} Kč/kWh`
                    : `${unitPrice.format(detail.sell?.fixedVtCzkKwh ?? 0)} Kč/kWh`,
                ],
                [
                  "Měsíční plat",
                  money.format(detail.sell?.monthlyFeeCzk ?? 0),
                ],
              ]}
              note={detail.sell?.availabilityNote}
            />
            <PriceCard
              title={`Distribuce ${detail.distribution?.code ?? ""}`}
              rows={[
                [
                  "Distribuce VT",
                  `${unitPrice.format(detail.distribution?.vtCzkKwh ?? 0)} Kč/kWh`,
                ],
                [
                  "Distribuce NT",
                  `${unitPrice.format(detail.distribution?.ntCzkKwh ?? 0)} Kč/kWh`,
                ],
                [
                  "Systém + daň + POZE",
                  `${unitPrice.format(
                    (detail.distribution?.systemServicesCzkKwh ?? 0) +
                      (detail.distribution?.electricityTaxCzkKwh ?? 0) +
                      (detail.distribution?.pozeCzkKwh ?? 0),
                  )} Kč/kWh`,
                ],
                [
                  "Měření + jistič",
                  `${money.format(
                    (detail.distribution?.monthlyMeterFeeCzk ?? 0) +
                      (detail.distribution?.monthlyBreakerFeeCzk ?? 0),
                  )}/měsíc`,
                ],
              ]}
              note={detail.distribution?.eligibilityNote}
            />
          </div>
          {monthlyData.length > 0 ? (
            <div className="mt-5 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">
                    Jak výsledek vzniká v průběhu roku
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Graf zobrazuje skutečně vyhodnocené měsíce, nikoli roční
                    extrapolaci.
                  </p>
                </div>
                <div className="inline-flex self-start rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      detailMode === "SELF_USE"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500"
                    }`}
                    onClick={() => onDetailMode("SELF_USE")}
                  >
                    Bez řízení
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      detailMode === "SMART"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500"
                    }`}
                    onClick={() => onDetailMode("SMART")}
                  >
                    S řízením
                  </button>
                </div>
              </div>
              <div className="mt-4 h-64 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value) => money.format(Number(value))}
                      contentStyle={{
                        borderRadius: 12,
                        borderColor: "#e2e8f0",
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      name="Nákup"
                      dataKey="purchase"
                      fill="#64748b"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const key = (entry as unknown as { key?: string }).key;
                        if (key) chooseMonth(key);
                      }}
                    />
                    <Bar
                      name="Výkup"
                      dataKey="sale"
                      fill="#65a30d"
                      radius={[0, 0, 4, 4]}
                      isAnimationActive={false}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const key = (entry as unknown as { key?: string }).key;
                        if (key) chooseMonth(key);
                      }}
                    />
                    <Bar
                      name="Čistý náklad"
                      dataKey="total"
                      fill="#2563eb"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const key = (entry as unknown as { key?: string }).key;
                        if (key) chooseMonth(key);
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {dailyData.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        Rozpad vybraného měsíce po dnech
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Kliknutím na měsíc nebo den přejdete na konkrétní období.
                      </p>
                    </div>
                    <label className="text-xs font-medium text-slate-700">
                      Měsíc
                      <select
                        className="app-input ml-2 py-2 text-xs"
                        value={selectedMonth}
                        onChange={(event) => chooseMonth(event.target.value)}
                      >
                        {monthlyData.map((month) => (
                          <option key={month.key} value={month.key}>
                            {month.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 h-56 min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#e2e8f0"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          minTickGap={12}
                          tick={{ fontSize: 10, fill: "#94a3b8" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#94a3b8" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value) => money.format(Number(value))}
                          labelFormatter={(_, payload) =>
                            payload?.[0]?.payload?.key
                              ? new Date(
                                  `${payload[0].payload.key}T12:00:00`,
                                ).toLocaleDateString("cs-CZ", {
                                  dateStyle: "long",
                                })
                              : ""
                          }
                          contentStyle={{
                            borderRadius: 12,
                            borderColor: "#e2e8f0",
                            fontSize: 12,
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar
                          name="Nákup"
                          dataKey="purchase"
                          fill="#64748b"
                          isAnimationActive={false}
                          className="cursor-pointer"
                          onClick={(entry) => {
                            const key = (entry as unknown as { key?: string }).key;
                            if (key) onSelectedDay(key);
                          }}
                        />
                        <Bar
                          name="Výkup"
                          dataKey="sale"
                          fill="#65a30d"
                          isAnimationActive={false}
                          className="cursor-pointer"
                          onClick={(entry) => {
                            const key = (entry as unknown as { key?: string }).key;
                            if (key) onSelectedDay(key);
                          }}
                        />
                        <Bar
                          name="Čistý náklad"
                          dataKey="total"
                          fill="#2563eb"
                          isAnimationActive={false}
                          className="cursor-pointer"
                          onClick={(entry) => {
                            const key = (entry as unknown as { key?: string }).key;
                            if (key) onSelectedDay(key);
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                <label className="text-xs font-medium text-slate-700">
                  Konkrétní den
                  <select
                    className="app-input mt-1 min-w-44 py-2 text-xs"
                    value={selectedDay}
                    onChange={(event) => onSelectedDay(event.target.value)}
                  >
                    {(activeEvidence?.periods.daily ?? []).map((day) => (
                      <option key={day.key} value={day.key}>
                        {new Date(`${day.key}T12:00:00`).toLocaleDateString(
                          "cs-CZ",
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedDayDetail && (
                  <div className="grid flex-1 gap-3 lg:grid-cols-2">
                    <DailyEvidence
                      title="Bez řízení"
                      period={selfUseDay}
                    />
                    <DailyEvidence
                      title="S chytrým řízením"
                      period={smartDay}
                      accent
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              Tento starší výpočet ještě nemá uložený měsíční průběh. Po
              nejbližším přepočtu se zde zobrazí celý rok i jednotlivé dny.
            </p>
          )}
        </>
      ) : null}
    </ModalShell>
  );
}

function DataStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3 ${
        accent ? "bg-brand-50" : "bg-slate-50"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function DailyEvidence({
  title,
  period,
  accent = false,
}: {
  title: string;
  period: ScenarioPeriod | null;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        accent
          ? "border-brand-200 bg-brand-50/50"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <p className="mb-2 text-xs font-semibold text-slate-800">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SmallMetric
          label="Nákup"
          value={period ? money.format(period.importCostCzk) : "—"}
        />
        <SmallMetric
          label="Výkup"
          value={period ? money.format(period.exportRevenueCzk) : "—"}
        />
        <SmallMetric
          label="Nabito"
          value={period ? `${number.format(period.chargedKwh)} kWh` : "—"}
        />
        <SmallMetric
          label="Vybito"
          value={period ? `${number.format(period.dischargedKwh)} kWh` : "—"}
        />
      </div>
    </div>
  );
}

function PriceCard({
  title,
  supplier,
  product,
  rows,
  note,
}: {
  title: string;
  supplier?: string;
  product?: string;
  rows: Array<[string, string]>;
  note?: string | null;
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      {supplier && (
        <h3 className="mt-1 font-semibold text-slate-950">{supplier}</h3>
      )}
      {product && <p className="mt-0.5 text-xs text-slate-500">{product}</p>}
      <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-right font-semibold text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      {note && (
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-[11px] leading-4 text-amber-900">
          {note}
        </p>
      )}
    </article>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <span className="block text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <strong className="mt-0.5 block text-xs text-slate-900">{value}</strong>
    </div>
  );
}

function ProField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input
        className="app-input mt-1.5"
        inputMode="decimal"
        value={value}
        placeholder={placeholder ? `např. ${placeholder}` : "např. 10, 15, 20"}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
