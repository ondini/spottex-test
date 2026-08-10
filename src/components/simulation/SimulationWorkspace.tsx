"use client";

import {
  AlertTriangle,
  BatteryCharging,
  Calculator,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Play,
  SunMedium,
  TrendingDown,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader, StatusBadge } from "@/components/app-shell/PagePrimitives";
import type {
  SimulationJobView,
  SimulationResult,
  SimulationScenario,
} from "@/lib/simulation/types";

type Site = {
  id: number;
  name: string;
  provider: string;
  lastSyncedAt: string | null;
  currentBatteryKwh: number;
  currentPvKwp: number;
  dataQuality: {
    coverageDays: number;
    coveragePercent: number;
    confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
    readyForEstimate: boolean;
    minimumDays: number;
    message: string;
  };
};

type Workspace = { sites: Site[]; jobs: SimulationJobView[] };

const money = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });

function status(job: SimulationJobView) {
  if (job.status === "SUCCEEDED") return { label: "Hotovo", tone: "success" as const };
  if (job.status === "FAILED") return { label: "Vyžaduje pozornost", tone: "warning" as const };
  if (job.status === "RUNNING") return { label: "Počítáme", tone: "brand" as const };
  return { label: "Ve frontě", tone: "neutral" as const };
}

function bestByPv(result: SimulationResult): SimulationScenario[] {
  return result.pvOptionsKwp.map((pvKwp) =>
    result.scenarios
      .filter((scenario) => scenario.pvKwp === pvKwp)
      .sort((a, b) => {
        const scoreA = a.annualSavingsCzk * 10 - a.investmentCzk;
        const scoreB = b.annualSavingsCzk * 10 - b.investmentCzk;
        return scoreB - scoreA;
      })[0],
  );
}

export function SimulationWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [battery, setBattery] = useState(10);
  const [pv, setPv] = useState(10);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/app/simulations", { cache: "no-store" });
      const payload = (await response.json()) as Workspace & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Simulace se nepodařilo načíst.");
      setWorkspace(payload);
      setSiteId((current) => current ?? payload.sites[0]?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Simulace se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workspace?.jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING")) return;
    const timer = window.setInterval(() => void load(true), 4_000);
    return () => window.clearInterval(timer);
  }, [load, workspace?.jobs]);

  useEffect(() => {
    const site = workspace?.sites.find((item) => item.id === siteId);
    if (!site) return;
    if (site.currentBatteryKwh > 0) setBattery(site.currentBatteryKwh);
    if (site.currentPvKwp > 0) setPv(site.currentPvKwp);
  }, [siteId, workspace?.sites]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId) return;
    setSubmitting(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/app/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          currentBatteryKwh: battery,
          currentPvKwp: pv,
          batteryPriceCzkPerKwh: Number(form.get("batteryPrice")),
          pvPriceCzkPerKwp: Number(form.get("pvPrice")),
          exportPriceCzkPerKwh: Number(form.get("exportPrice")),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; job?: SimulationJobView };
      if (!response.ok || !payload.job) throw new Error(payload.error || "Výpočet se nepodařilo zadat.");
      setWorkspace((current) =>
        current ? { ...current, jobs: [payload.job as SimulationJobView, ...current.jobs] } : current,
      );
      setMessage("Výpočet jsme zařadili. Stránku můžete zavřít; výsledek pošleme také e-mailem.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Výpočet se nepodařilo zadat.");
    } finally {
      setSubmitting(false);
    }
  }

  const latest = workspace?.jobs[0] ?? null;
  const result = workspace?.jobs.find((job) => job.result)?.result ?? null;
  const selectedSite = workspace?.sites.find((site) => site.id === siteId) ?? null;
  const pvRecommendations = useMemo(() => (result ? bestByPv(result) : []), [result]);

  if (loading && !workspace) {
    return <div className="grid min-h-[55vh] place-items-center"><LoaderCircle className="size-8 animate-spin text-brand-600" /></div>;
  }

  if (!workspace?.sites.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analýza úspor" description="Porovnání provozu v režimu self-use a s chytrým řízením." />
        <div className="app-card p-8 text-center">
          <SunMedium className="mx-auto size-10 text-brand-600" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">Nejprve připojte elektrárnu</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">Simulace potřebuje uloženou historii výroby a spotřeby.</p>
          <Link href="/app/dashboard" className="app-button mt-5">Připojit SolaX Cloud</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analýza úspor"
        description="Porovnejte na vlastních datech self-use a chytré řízení; rozšířené hardwarové varianty připravujeme jako placenou analýzu."
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.8fr)]">
        <form onSubmit={submit} className="app-card p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Calculator className="size-5" /></span>
            <div><h2 className="font-semibold text-slate-900">Nový výpočet</h2><p className="mt-1 text-sm leading-6 text-slate-500">Rozsah variant vytvoříme automaticky kolem dnešní velikosti elektrárny.</p></div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="text-sm font-medium text-slate-700 sm:col-span-2 xl:col-span-3">Elektrárna
              <select className="app-input mt-1.5" value={siteId ?? ""} onChange={(event) => setSiteId(Number(event.target.value))}>
                {workspace.sites.map((site) => <option key={site.id} value={site.id}>{site.name}{site.provider === "DEMO" ? " · DEMO" : ""}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">Dnešní baterie (kWh)
              <input className="app-input mt-1.5" type="number" min="0" max="5000" step="0.5" value={battery} onChange={(event) => setBattery(Number(event.target.value))} required />
            </label>
            <label className="text-sm font-medium text-slate-700">Dnešní FVE (kWp)
              <input className="app-input mt-1.5" type="number" min="0.5" max="10000" step="0.5" value={pv} onChange={(event) => setPv(Number(event.target.value))} required />
            </label>
            <label className="text-sm font-medium text-slate-700">Výkup (Kč/kWh)
              <input className="app-input mt-1.5" name="exportPrice" type="number" min="-10" max="50" step="0.01" defaultValue="0.50" required />
            </label>
            <label className="text-sm font-medium text-slate-700">Baterie (Kč/kWh)
              <input className="app-input mt-1.5" name="batteryPrice" type="number" min="0" max="200000" step="100" defaultValue="15000" required />
            </label>
            <label className="text-sm font-medium text-slate-700">Dostavba FVE (Kč/kWp)
              <input className="app-input mt-1.5" name="pvPrice" type="number" min="0" max="200000" step="100" defaultValue="25000" required />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="app-button" disabled={submitting || !siteId || !selectedSite?.dataQuality.readyForEstimate}>
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
              {submitting ? "Zařazuji…" : "Spočítat varianty"}
            </button>
            <p className="text-xs text-slate-400">Baterie: 1× až 3× · FVE: 1× až 2× · sazby C03d/C25d/C26d</p>
          </div>
          {selectedSite && <p className={`mt-4 rounded-xl px-4 py-3 text-sm ${selectedSite.dataQuality.readyForEstimate ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{selectedSite.dataQuality.message} Pokrytí: {number.format(selectedSite.dataQuality.coveragePercent)} %.</p>}
          {message && <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600" role="status">{message}</p>}
        </form>

        <aside className="app-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">Stav výpočtu</h2>{latest && <StatusBadge tone={status(latest).tone}>{status(latest).label}</StatusBadge>}</div>
          {latest ? (
            <div className="mt-5">
              <div className="flex items-start gap-3">
                {latest.status === "SUCCEEDED" ? <CheckCircle2 className="mt-0.5 size-5 text-success-600" /> : latest.status === "FAILED" ? <AlertTriangle className="mt-0.5 size-5 text-warning-600" /> : <LoaderCircle className="mt-0.5 size-5 animate-spin text-brand-600" />}
                <div><p className="text-sm font-medium text-slate-700">{latest.stage}</p><p className="mt-1 text-xs text-slate-400">Zadáno {new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(latest.createdAt))}</p></div>
              </div>
              {latest.error && <p className="mt-4 rounded-xl bg-warning-50 px-4 py-3 text-sm leading-6 text-warning-600">{latest.error}</p>}
              <div className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500"><Clock3 className="mr-1.5 inline size-3.5" />Výpočet běží na serveru. Po dokončení odešleme e-mail a výsledky zde zůstanou uložené.</div>
            </div>
          ) : <p className="mt-4 text-sm leading-6 text-slate-500">Zatím jste nespustili žádný výpočet pro {selectedSite?.name}.</p>}
        </aside>
      </section>

      {result && <SimulationResults result={result} pvRecommendations={pvRecommendations} />}
    </div>
  );
}

function SimulationResults({ result, pvRecommendations }: { result: SimulationResult; pvRecommendations: SimulationScenario[] }) {
  const basePv = result.pvOptionsKwp[0];
  const matrix = result.scenarios.filter((scenario) => scenario.pvKwp === basePv);
  const tariffs = result.tariffs.map((item) => item.code);
  return (
    <div className="space-y-6">
      {result.data.confidence !== "HIGH" && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <span>Výsledek je zatím orientační: máme {number.format(result.data.coverageDays)} dne historických dat. Pro spolehlivé sezónní srovnání chceme alespoň 300 dní; přesnost se bude automaticky zvyšovat.</span>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ResultCard icon={TrendingDown} label="Odhad úspory za rok" value={money.format(result.bestScenario.annualSavingsCzk)} />
        <ResultCard icon={BatteryCharging} label="Doporučená baterie" value={`${number.format(result.bestScenario.batteryKwh)} kWh`} />
        <ResultCard icon={SunMedium} label="Doporučená FVE" value={`${number.format(result.bestScenario.pvKwp)} kWp`} />
        <ResultCard icon={Zap} label="Modelová sazba" value={result.bestScenario.tariff} />
      </section>

      <section className="app-card overflow-hidden">
        <div className="border-b border-slate-100 p-5 sm:p-6"><h2 className="font-semibold text-slate-900">Matice baterie × distribuční sazba</h2><p className="mt-1 text-sm text-slate-500">Roční úspora s chytrým řízením při dnešní velikosti FVE {number.format(basePv)} kWp. Pod částkou je prostá návratnost rozšíření.</p></div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Baterie</th>{tariffs.map((tariff) => <th key={tariff} className="px-5 py-3">{tariff}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {result.batteryOptionsKwh.map((batteryKwh) => <tr key={batteryKwh}><th className="whitespace-nowrap px-5 py-4 text-left font-semibold text-slate-800">{number.format(batteryKwh)} kWh</th>{tariffs.map((tariff) => { const item = matrix.find((scenario) => scenario.batteryKwh === batteryKwh && scenario.tariff === tariff); return <td key={tariff} className="whitespace-nowrap px-5 py-4"><span className={item && item.annualSavingsCzk > 0 ? "font-semibold text-brand-700" : "font-medium text-slate-600"}>{item ? money.format(item.annualSavingsCzk) : "—"}</span><span className="mt-1 block text-xs text-slate-400">{item?.paybackYears ? `${number.format(item.paybackYears)} roku` : "bez nové investice"}</span></td>; })}</tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="app-card overflow-hidden">
        <div className="border-b border-slate-100 p-5 sm:p-6"><h2 className="font-semibold text-slate-900">Rozšíření fotovoltaiky</h2><p className="mt-1 text-sm text-slate-500">Nejlepší nalezená kombinace baterie a sazby pro každou velikost FVE.</p></div>
        <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
          {pvRecommendations.map((scenario) => <div key={scenario.pvKwp} className="p-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">FVE {number.format(scenario.pvKwp)} kWp</p><p className="mt-3 text-xl font-semibold text-slate-900">{money.format(scenario.annualSavingsCzk)}<span className="text-sm font-normal text-slate-400"> / rok</span></p><p className="mt-2 text-sm text-slate-500">{number.format(scenario.batteryKwh)} kWh · {scenario.tariff}</p><p className="mt-1 text-xs text-slate-400">{scenario.paybackYears ? `návratnost ${number.format(scenario.paybackYears)} roku` : "bez nové investice"}</p></div>)}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="app-card p-5 sm:p-6"><h2 className="font-semibold text-slate-900">Jak výsledek číst</h2><ul className="mt-4 space-y-2 text-sm leading-6 text-slate-500">{result.assumptions.map((assumption) => <li key={assumption} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" />{assumption}</li>)}</ul></div>
        <div className="flex min-w-72 flex-col justify-center rounded-2xl bg-[#09121f] p-6 text-white"><Zap className="size-7 text-brand-400" /><h2 className="mt-4 text-lg font-semibold">Chcete úsporu začít sledovat?</h2><p className="mt-2 text-sm leading-6 text-slate-400">V současném testovacím provozu je služba řízení zdarma. Aktivace služby neposílá povel střídači; zapnutí řízení zůstává samostatný, výslovný krok v přehledu.</p><FreeTrialButton /></div>
      </section>
    </div>
  );
}

function FreeTrialButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setPending(true);
    setError(null);
    try {
      const cartResponse = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productCode: "INVERTER_CONTROL", quantity: 1 }),
      });
      const cartPayload = (await cartResponse.json().catch(() => ({}))) as { cart?: { id: string }; error?: string };
      if (!cartResponse.ok || !cartPayload.cart) throw new Error(cartPayload.error || "Aktivaci se nepodařilo připravit.");
      const checkoutResponse = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: cartPayload.cart.id }),
      });
      const checkout = (await checkoutResponse.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
      if (!checkoutResponse.ok || !checkout.redirectUrl) throw new Error(checkout.error || "Aktivaci se nepodařilo dokončit.");
      window.location.assign(checkout.redirectUrl);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(code || "Aktivaci se nepodařilo dokončit.");
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="app-button mt-5" disabled={pending} onClick={() => void activate()}>
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Zap className="size-4" />}
        {pending ? "Aktivuji…" : "Aktivovat zdarma"}
      </button>
      {error && <p className="mt-3 text-xs leading-5 text-red-300" role="alert">{error}</p>}
    </>
  );
}

function ResultCard({ icon: Icon, label, value }: { icon: typeof TrendingDown; label: string; value: string }) {
  return <div className="app-card p-5"><span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="size-5" /></span><p className="mt-4 text-2xl font-semibold text-slate-900">{value}</p><p className="mt-1 text-sm text-slate-500">{label}</p></div>;
}
