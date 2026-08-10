import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BatteryCharging,
  CheckCircle2,
  CircleDollarSign,
  Cpu,
  Database,
  Gauge,
  History,
  ShieldAlert,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";

import { ControlAuditHistoryChart } from "@/components/admin/ControlAuditHistoryChart";
import { ControlAuditCoverageTimeline } from "@/components/admin/ControlAuditCoverageTimeline";
import { ControlAuditReplayChart } from "@/components/admin/ControlAuditReplayChart";
import {
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/app-shell/PagePrimitives";
import { requireAdmin } from "@/lib/auth/guards";
import {
  getControlAudit,
  type AuditTone,
} from "@/lib/admin/control-audit";

export const metadata = { title: "Audit řízení" };
export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number | null, suffix = "") {
  if (value == null) return "—";
  return `${value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })}${suffix}`;
}

function toneClasses(tone: AuditTone) {
  return {
    success: {
      icon: "bg-emerald-50 text-emerald-700",
      border: "border-emerald-200",
    },
    warning: {
      icon: "bg-amber-50 text-amber-700",
      border: "border-amber-200",
    },
    danger: {
      icon: "bg-red-50 text-red-700",
      border: "border-red-200",
    },
    neutral: {
      icon: "bg-slate-100 text-slate-600",
      border: "border-slate-200",
    },
  }[tone];
}

function CheckIcon({ tone }: { tone: AuditTone }) {
  if (tone === "success") return <CheckCircle2 className="size-5" />;
  if (tone === "danger") return <XCircle className="size-5" />;
  if (tone === "warning") return <AlertTriangle className="size-5" />;
  return <Activity className="size-5" />;
}

export default async function ControlAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ siteId?: string }>;
}) {
  await requireAdmin("/admin/audit-rizeni");
  const params = await searchParams;
  const requestedSiteId = Number(params.siteId);
  const audit = await getControlAudit(
    Number.isInteger(requestedSiteId) && requestedSiteId > 0
      ? requestedSiteId
      : undefined,
  );
  if (!audit) {
    return (
      <EmptyState
        icon={Database}
        title="Žádná elektrárna"
        description="Audit bude dostupný, jakmile bude připojená první elektrárna."
      />
    );
  }

  const failedChecks = audit.checks.filter((check) => check.tone === "danger").length;
  const warnings = audit.checks.filter((check) => check.tone === "warning").length;
  const overallTone: AuditTone =
    failedChecks > 0 ? "danger" : warnings > 0 ? "warning" : "success";
  const balanceFailureRate = audit.quality.balanceEvaluatedIntervals
    ? (audit.quality.balanceInvalidIntervals /
        audit.quality.balanceEvaluatedIntervals) *
      100
    : null;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Audit predikcí a řízení"
        description="Interní důkazní stránka: odděluje měřenou realitu, simulaci analýzy a skutečně vykonané řízení."
        action={
          <form method="get" className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Elektrárna
            </label>
            <select
              name="siteId"
              defaultValue={audit.site.id}
              className="h-11 min-w-64 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-brand-500"
            >
              {audit.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} · {site.owner}
                </option>
              ))}
            </select>
            <button className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800">
              Zobrazit
            </button>
          </form>
        }
      />

      <section
        className={`app-card overflow-hidden border ${toneClasses(overallTone).border}`}
      >
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span
              className={`grid size-12 shrink-0 place-items-center rounded-2xl ${toneClasses(overallTone).icon}`}
            >
              <ShieldAlert className="size-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-900">
                  {audit.site.name}
                </h2>
                <StatusBadge
                  tone={
                    audit.site.optimizationOn ? "success" : "neutral"
                  }
                >
                  {audit.site.optimizationOn
                    ? "Řízení zapnuto"
                    : "Řízení vypnuto"}
                </StatusBadge>
                <StatusBadge tone={overallTone}>
                  {failedChecks
                    ? `${failedChecks} kritické nálezy`
                    : warnings
                      ? `${warnings} upozornění`
                      : "Bez nálezu"}
                </StatusBadge>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {audit.site.optimizationOn
                  ? "Řízení je označené jako aktivní. Níže ověřujeme návaznost plánu, povelu a naměřené odezvy."
                  : "Pro tuto elektrárnu zatím nelze tvrdit, že chytré řízení v provozu dosahuje vypočtených úspor. Existují pouze výsledky simulace."}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Vlastník {audit.site.owner} · externí ID {audit.site.externalSiteId} ·
                poslední synchronizace {formatDate(audit.site.lastSyncedAt)}
              </p>
            </div>
          </div>
          <div className="grid min-w-[20rem] grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 px-3 py-3">
              <p className="text-2xl font-semibold text-slate-900">{audit.inverters.length}</p>
              <p className="mt-1 text-xs text-slate-500">střídače</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-3">
              <p className="text-2xl font-semibold text-slate-900">
                {formatNumber(audit.quality.coverageDays)}
              </p>
              <p className="mt-1 text-xs text-slate-500">úplných dní</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-3">
              <p className="text-2xl font-semibold text-slate-900">
                {audit.analysis.pairedScenarios}
              </p>
              <p className="mt-1 text-xs text-slate-500">párových testů</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {audit.checks.map((check) => {
          const styles = toneClasses(check.tone);
          return (
            <article
              key={check.title}
              className={`app-card border p-5 ${styles.border}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={`grid size-10 place-items-center rounded-xl ${styles.icon}`}>
                  <CheckIcon tone={check.tone} />
                </span>
                <StatusBadge tone={check.tone}>{check.status}</StatusBadge>
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{check.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{check.detail}</p>
            </article>
          );
        })}
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Database className="size-5 text-brand-600" />
              <h2 className="font-semibold text-slate-900">
                Kdy opravdu měřil jeden a kdy oba střídače
              </h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Samostatné řádky ukazují dostupnost výroby i spotřeby každého
              zařízení. Souhrnný řádek červeně označí dny, kdy data existují,
              spotřeba běží, ale výroba je téměř nulová.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="success">
              oba {audit.coverageSummary.bothDays} dní
            </StatusBadge>
            <StatusBadge tone="warning">
              jen jeden {audit.coverageSummary.oneDays} dní
            </StatusBadge>
            <StatusBadge tone="neutral">
              bez dat {audit.coverageSummary.noDataDays} dní
            </StatusBadge>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <ControlAuditCoverageTimeline
            data={audit.coverageTimeline}
            inverters={audit.inverters}
          />
        </div>
        {audit.inverters.length > 1 && audit.coverageSummary.oneDays > 0 && (
          <div className="border-t border-amber-100 bg-amber-50 px-6 py-4 text-sm leading-6 text-amber-900">
            Ve {audit.coverageSummary.oneDays} dnech má úplná data pouze jeden
            střídač. Tyto dny jsou v časové ose označené a nesmí se potichu
            vydávat za úplný součet celé elektrárny.
          </div>
        )}
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <History className="size-5 text-brand-600" />
              <h2 className="font-semibold text-slate-900">
                Měřená výroba a spotřeba
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Součet všech připojených střídačů, pouze skutečně naměřené 15minutové intervaly.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={audit.quality.readyForEstimate ? "success" : "warning"}>
              Pokrytí {formatNumber(audit.quality.coveragePercent, " %")}
            </StatusBadge>
            <StatusBadge tone={balanceFailureRate != null && balanceFailureRate <= 5 ? "success" : "warning"}>
              Bilance mimo toleranci {formatNumber(balanceFailureRate, " %")}
            </StatusBadge>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <ControlAuditHistoryChart data={audit.dailySeries} />
        </div>
        <div className="grid border-t border-slate-100 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Výroba v historii",
              value: formatNumber(audit.quality.measuredProductionKwh, " kWh"),
            },
            {
              label: "Spotřeba v historii",
              value: formatNumber(audit.quality.measuredConsumptionKwh, " kWh"),
            },
            {
              label: "Dny s nulovou výrobou",
              value: `${audit.anomaly.zeroProductionDays} dní`,
            },
            {
              label: "Nejdelší nulový úsek",
              value: `${audit.anomaly.longestZeroProductionStreak} dní`,
            },
          ].map((item) => (
            <div key={item.label} className="border-slate-100 px-5 py-4 sm:border-r last:border-r-0">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      {audit.replay && (
        <section className="app-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-violet-600" />
                <h2 className="font-semibold text-slate-900">
                  {audit.replay.title}
                </h2>
              </div>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">
                {audit.replay.description}
              </p>
            </div>
            <StatusBadge tone="danger">Model neprošel kontrolou</StatusBadge>
          </div>
          <div className="p-4 sm:p-6">
            <ControlAuditReplayChart replay={audit.replay} />
          </div>
          <div className="grid border-t border-slate-100 lg:grid-cols-2">
            <div className="border-b border-slate-100 p-6 lg:border-b-0 lg:border-r">
              <h3 className="text-sm font-semibold text-slate-900">
                Přesné vstupy replaye
              </h3>
              <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-3 text-sm">
                {[
                  ["Zařízení", `střídač ${audit.replay.deviceId}`],
                  [
                    "Historie před predikcí",
                    `${audit.replay.inputs.historyHours} hodin`,
                  ],
                  [
                    "Výkon předaný živým kódem",
                    `${audit.replay.inputs.sitePvPowerKwpPassedByLiveCode} kWp`,
                  ],
                  [
                    "Výkon přiřazený zařízení",
                    `${audit.replay.inputs.devicePvArrayKwp} kWp`,
                  ],
                  [
                    "Maximální AC výkon střídače",
                    `${audit.replay.inputs.deviceMaxAcKw} kW`,
                  ],
                  [
                    "Měřítko kontrolního replaye",
                    `${audit.replay.inputs.physicalDeviceScaleKwp} kW`,
                  ],
                  [
                    "Souřadnice počasí",
                    audit.replay.inputs.coordinates.join(", "),
                  ],
                  [
                    "Checkpoint výroby",
                    audit.replay.modelFiles.production,
                  ],
                  [
                    "Checkpoint spotřeby",
                    audit.replay.modelFiles.consumption,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-mono text-xs font-semibold text-slate-800">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="p-6">
              <h3 className="text-sm font-semibold text-slate-900">
                Co přesně je špatně
              </h3>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <p>
                  <strong className="text-slate-900">Čas predikce:</strong>{" "}
                  znamená čas poslední hodinové hodnoty. Z něj model odvodí
                  hodinu, den v týdnu a počasí pro následující hodiny. Nasazený
                  kód místo něj používá aktuální čas serveru, takže při
                  zpoždění nebo backfillu zamění časové i meteorologické vstupy.
                </p>
                <p>
                  <strong className="text-slate-900">Škálování výroby:</strong>{" "}
                  registrace zapsala celkových 20 kWp ke každému ze dvou
                  střídačů. Součet 40 kWp se potom předává modelu každého
                  jednotlivého 10kW zařízení. Hodnota je mimo rozsah tréninku
                  a násobí výstup dvakrát: při normalizaci vstupu i při převodu
                  predikce zpět na kWh.
                </p>
                <p>
                  <strong className="text-slate-900">Trénovací data:</strong>{" "}
                  obsahují kladnou výrobu při nulovém globálním ozáření a podle
                  lokality mají výrobu vůči počasí posunutou o 0 až 3 hodiny.
                  Noční pojistka proto zůstává nutná, ale model se musí přeučit
                  na časově sjednocených a fyzicky validních datech.
                </p>
                <p>
                  <strong className="text-slate-900">Spotřeba:</strong> 48hodinový
                  vstup má součet{" "}
                  {formatNumber(
                    audit.replay.inputs.consumptionHistoryTotalKwh,
                    " kWh",
                  )}{" "}
                  a {audit.replay.inputs.consumptionHistoryNegativeHours} záporných
                  hodin. Model je ořízne na nulu. Takový signál není spotřeba
                  objektu a nesmí být použit pro učení.
                </p>
                <p>
                  <strong className="text-slate-900">Noc:</strong> ochranné
                  oříznutí pod horizontem je nutná pojistka, nikoli důkaz kvality
                  modelu. Naměřená data i model se musí samostatně kontrolovat;
                  v tomto okně byla reálná noční výroba 0 kWh, živý odhad{" "}
                  {formatNumber(audit.replay.night.forecastLiveKwh, " kWh")}.
                </p>
              </div>
            </div>
          </div>
          <div className="border-t border-amber-100 bg-amber-50 px-6 py-4 text-xs leading-5 text-amber-900">
            {audit.replay.inputs.weatherSource} Replay proto spolehlivě odhaluje
            chybu modelu a vstupů, ale netvrdí, že rekonstruuje přesnou
            předpověď počasí dostupnou v čase původního výpočtu.
          </div>
        </section>
      )}

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="app-card overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-violet-600" />
              <h2 className="font-semibold text-slate-900">Predikce vs. realita</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Hodnotíme jen predikce, které vznikly před cílovým intervalem a nesou verzi modelu.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-100">
            <div className="bg-white p-5">
              <p className="text-xs text-slate-500">Kandidáti přepsaní realitou</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {audit.forecast.reclassifiedCandidates}
              </p>
            </div>
            <div className="bg-white p-5">
              <p className="text-xs text-slate-500">Ověřitelné forecasty</p>
              <p className="mt-2 text-2xl font-semibold text-red-700">
                {audit.forecast.verifiableSamples}
              </p>
            </div>
            <div className="bg-white p-5">
              <p className="text-xs text-slate-500">MAE výroby</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatNumber(audit.forecast.productionMaeKwh, " kWh")}
              </p>
            </div>
            <div className="bg-white p-5">
              <p className="text-xs text-slate-500">MAE spotřeby</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatNumber(audit.forecast.consumptionMaeKwh, " kWh")}
              </p>
            </div>
          </div>
          <div className="border-t border-red-100 bg-red-50 px-6 py-4 text-sm leading-6 text-red-800">
            {audit.forecast.reason}
            {audit.forecast.exactReclassificationPercent != null && (
              <> Shodných hodnot je {audit.forecast.exactReclassificationPercent.toLocaleString("cs-CZ")} %.</>
            )}
          </div>
        </article>

        <article className="app-card overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-brand-600" />
              <h2 className="font-semibold text-slate-900">Řetězec skutečného řízení</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Každý zásah musí mít dohledatelný plán, povel, potvrzení a následnou telemetrii.
            </p>
          </div>
          <div className="space-y-0 p-6">
            {[
              {
                label: "Optimalizační plán",
                value: `${audit.control.schedules} intervalů`,
                ok: audit.control.schedules > 0,
              },
              {
                label: "Odeslané uživatelské povely",
                value: `${audit.control.commands} povelů`,
                ok: audit.control.commands > 0,
              },
              {
                label: "Potvrzené povely",
                value: `${audit.control.acknowledgedCommands} potvrzeno`,
                ok: audit.control.acknowledgedCommands > 0,
              },
              {
                label: "Odezva v telemetrii",
                value: "není párovaná s plánem",
                ok: false,
              },
            ].map((item, index, items) => (
              <div key={item.label} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span
                    className={`grid size-9 place-items-center rounded-full ${
                      item.ok
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {item.ok ? <CheckCircle2 className="size-4" /> : <span className="size-2 rounded-full bg-current" />}
                  </span>
                  {index < items.length - 1 && <span className="h-10 w-px bg-slate-200" />}
                </div>
                <div className="flex min-w-0 flex-1 items-start justify-between gap-4 pb-5 pt-1.5">
                  <span className="text-sm font-medium text-slate-700">{item.label}</span>
                  <span className="text-sm text-slate-500">{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
        <article className="app-card overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="size-5 text-brand-600" />
              <h2 className="font-semibold text-slate-900">Audit cenového výpočtu</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Poslední analýza musí splnit náklad = nákup − výkup + stálé platby.
            </p>
          </div>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Konkrétní tarif</p>
              <p className="mt-2 font-semibold text-slate-900">
                {audit.tariff.complete ? "Kompletně zadaný" : "Není kompletní"}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {audit.tariff.complete
                  ? `${audit.tariff.supplier || "Dodavatel"} · ${audit.tariff.product || "produkt"}`
                  : `Chybí: ${audit.tariff.missing.join(", ")}.`}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cenové křivky</p>
              <p className="mt-2 font-semibold text-slate-900">
                {audit.tariff.readyPriceCurves} připravených z {audit.tariff.priceCurves}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Sazba {audit.tariff.distributionTariffCode || "nezadaná"} · nákup {audit.tariff.buyMode || "nezadaný"} · výkup {audit.tariff.sellMode || "nezadaný"}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Kontrola posledního běhu</th>
                  <th className="px-5 py-3">Výsledek</th>
                  <th className="px-5 py-3">Stav</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-5 py-3 text-slate-600">Roční rozklad nákladů</td>
                  <td className="px-5 py-3 font-semibold text-slate-900">
                    rozdíl {formatNumber(audit.analysis.maxCostDecompositionDifferenceCzk, " Kč")}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge tone={(audit.analysis.maxCostDecompositionDifferenceCzk ?? Infinity) <= 0.05 ? "success" : "warning"}>
                      {(audit.analysis.maxCostDecompositionDifferenceCzk ?? Infinity) <= 0.05 ? "Sedí" : "Prověřit"}
                    </StatusBadge>
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-600">Doložení použitých ceníků</td>
                  <td className="px-5 py-3 font-semibold text-slate-900">
                    {audit.tariff.sourceBackedCatalogVersions} z {audit.tariff.referencedCatalogVersions} verzí
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge
                      tone={
                        audit.tariff.referencedCatalogVersions > 0 &&
                        audit.tariff.sourceBackedCatalogVersions ===
                          audit.tariff.referencedCatalogVersions
                          ? "success"
                          : "danger"
                      }
                    >
                      {audit.tariff.referencedCatalogVersions > 0 &&
                      audit.tariff.sourceBackedCatalogVersions ===
                        audit.tariff.referencedCatalogVersions
                        ? "Doloženo"
                        : "Chybí zdroj"}
                    </StatusBadge>
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-600">Smart proti self-use</td>
                  <td className="px-5 py-3 font-semibold text-slate-900">
                    {audit.analysis.smartWorseScenarios} horších z {audit.analysis.pairedScenarios}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge tone={audit.analysis.pairedScenarios > 0 && audit.analysis.smartWorseScenarios === 0 ? "success" : "danger"}>
                      {audit.analysis.pairedScenarios > 0 && audit.analysis.smartWorseScenarios === 0 ? "Sedí" : "Prověřit"}
                    </StatusBadge>
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-600">Rozsah přínosu řízení</td>
                  <td className="px-5 py-3 font-semibold text-slate-900">
                    {formatNumber(audit.analysis.minSmartSavingCzk, " Kč")} až {formatNumber(audit.analysis.maxSmartSavingCzk, " Kč")}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge tone="neutral">Podle tarifu</StatusBadge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-6 py-4 text-xs leading-5 text-slate-400">
            Engine {audit.analysis.engineVersion || "—"} · metodika {audit.analysis.methodologyVersion || "—"} · dokončeno {formatDate(audit.analysis.completedAt)}
          </div>
        </article>

        <article className="app-card overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-2">
              <Cpu className="size-5 text-violet-600" />
              <h2 className="font-semibold text-slate-900">Připravenost na doučení</h2>
            </div>
          </div>
          <div className="space-y-4 p-6">
            {[
              {
                label: "Historie pro train / validation",
                ok: audit.training.enoughHistoryForSplit,
                value: `${audit.training.completeDays} dní`,
              },
              {
                label: "Nezávislé forecast labely",
                ok: audit.training.forecastLabelsReady,
                value: `${audit.forecast.verifiableSamples} vzorků`,
              },
              {
                label: "Datové anomálie odstraněny",
                ok: audit.anomaly.zeroProductionDays === 0,
                value: `${audit.anomaly.zeroProductionDays} podezřelých dní`,
              },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 px-4 py-3">
                <div className="flex items-center gap-3">
                  {item.ok ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="size-5 text-amber-600" />
                  )}
                  <span className="text-sm font-medium text-slate-700">{item.label}</span>
                </div>
                <span className="text-xs font-semibold text-slate-500">{item.value}</span>
              </div>
            ))}
            <div className="rounded-2xl bg-violet-50 p-4 text-sm leading-6 text-violet-900">
              {audit.training.recommendation}
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Bezpečný postup nasazení modelu</p>
              <ol className="mt-3 space-y-2 text-sm text-slate-500">
                {[
                  "časový rolling backtest proti sezónnímu baseline",
                  "měsíc shadow režimu bez povelů",
                  "porovnání plánu a telemetrie",
                  "teprve potom aktivní řízení",
                ].map((item, index) => (
                  <li key={item} className="flex gap-3">
                    <span className="font-semibold text-violet-600">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </article>
      </section>

      <section className="app-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <BatteryCharging className="size-5 text-brand-600" />
              <h2 className="font-semibold text-slate-900">Střídače zahrnuté do auditu</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Výroba ani spotřeba se nesmí potichu omezit pouze na první zařízení.
            </p>
          </div>
          <StatusBadge tone={audit.inverters.length > 1 ? "brand" : "neutral"}>
            {audit.inverters.length} zařízení
          </StatusBadge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Zařízení</th>
                <th className="px-5 py-3">Stav</th>
                <th className="px-5 py-3">Měřené intervaly</th>
                <th className="px-5 py-3">Výroba</th>
                <th className="px-5 py-3">Spotřeba</th>
                <th className="px-5 py-3">Poslední měření</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {audit.inverters.map((inverter) => (
                <tr key={inverter.id}>
                  <td className="px-5 py-3">
                    <p className="font-semibold text-slate-800">{inverter.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-400">ID {inverter.externalDeviceId}</p>
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge tone={inverter.status === "ONLINE" ? "success" : inverter.status === "ERROR" ? "danger" : "neutral"}>
                      {inverter.status}
                    </StatusBadge>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{inverter.measuredIntervals.toLocaleString("cs-CZ")}</td>
                  <td className="px-5 py-3 font-semibold text-slate-800">{formatNumber(inverter.productionKwh, " kWh")}</td>
                  <td className="px-5 py-3 font-semibold text-slate-800">{formatNumber(inverter.consumptionKwh, " kWh")}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(inverter.lastMeasuredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl bg-[#09121f] p-6 text-white">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-400">
              <Gauge className="size-4" /> Verdikt pro prezentaci Litoměřicím
            </div>
            <p className="mt-3 max-w-4xl text-lg leading-8 text-white">
              Výsledky nové analýzy jsou finančně vnitřně konzistentní a smart režim v posledním běhu nezhoršil žádný párový scénář. Přesnost produkční predikce ani reálný přínos live řízení ale zatím pro MŠ Větrník prokázané nejsou.
            </p>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
              Před prezentací doplňte konkrétní tarif, opravte ukládání forecast snapshotů, prověřte výpadky výroby a proveďte shadow běh řízení bez fyzických zásahů.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-white/5 px-5 py-4">
            <BarChart3 className="size-6 text-brand-400" />
            <div>
              <p className="text-xs text-slate-400">Stav důkazu</p>
              <p className="font-semibold">Simulace ano · provoz zatím ne</p>
            </div>
            <ArrowRight className="size-5 text-slate-500" />
          </div>
        </div>
      </section>
    </div>
  );
}
