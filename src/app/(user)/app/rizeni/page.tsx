import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, BatteryCharging, CheckCircle2, Coins, Zap } from "lucide-react";
import Link from "next/link";

import { PageHeader, StatusBadge } from "@/components/app-shell/PagePrimitives";
import { ControlSiteCard } from "@/components/energy/ControlSiteCard";
import { requireUser } from "@/lib/auth/guards";
import { hasInverterControlEntitlement } from "@/lib/commerce/entitlement";
import { freeAccessEnabled } from "@/lib/commerce/free-access";
import { siteControlActivity, siteControlSavings } from "@/lib/energy/control-activity";
import { describeControlPlan, planModeStyle } from "@/lib/energy/control-plan";
import { getLocalControlReadiness } from "@/lib/energy/technical-profile";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Řízení" };
export const dynamic = "force-dynamic";

const czk = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
const czkPrecise = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", weekday: "short", hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", dateStyle: "medium", timeStyle: "short" });

export default async function ControlPage({ searchParams }: { searchParams: Promise<{ siteId?: string }> }) {
  const session = await requireUser("/app/rizeni");
  const userId = Number(session.user.id);
  const requestedSiteId = Number((await searchParams).siteId);
  const [sites, entitled] = await Promise.all([
    prisma.energySite.findMany({
      where: { userId },
      select: { id: true, name: true, optimizationOn: true, _count: { select: { inverters: true } } },
      orderBy: { id: "asc" },
    }),
    hasInverterControlEntitlement(userId),
  ]);
  // One plant per page: which one is chosen in the top bar, not a list.
  const site = sites.find((item) => item.id === requestedSiteId) ?? sites[0] ?? null;
  if (!site) {
    return <div className="space-y-6">
      <PageHeader title="Řízení" description="Chytré řízení baterie, spotřeby a prodeje elektřiny." />
      <section className="app-card p-6 text-center">
        <BatteryCharging className="mx-auto size-8 text-slate-400" />
        <h2 className="mt-4 font-semibold text-slate-900">Nejdříve připojte elektrárnu</h2>
        <Link href="/app/dashboard" className="app-button mt-5">Přejít na přehled <ArrowRight className="size-4" /></Link>
      </section>
    </div>;
  }

  const inverters = await prisma.inverter.findMany({ where: { energySiteId: site.id }, select: { id: true }, orderBy: { id: "asc" } });
  const now = new Date();
  const [{ readiness }, schedule, analysis, activity, savings] = await Promise.all([
    getLocalControlReadiness(userId, site.id),
    prisma.inverterSchedule.findMany({
      where: { inverterId: inverters[0]?.id ?? -1, endAt: { gte: now } },
      orderBy: { startAt: "asc" },
    }),
    prisma.energyAnalysisRun.findFirst({
      where: { energySiteId: site.id, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, createdAt: true, confidence: true,
        scenarios: {
          where: { status: "COMPLETED" },
          select: { controlMode: true, annualCostCzk: true, batteryCapacityKwh: true, pvCapacityKwp: true, priceCurve: { select: { purpose: true } } },
        },
      },
    }),
    site.optimizationOn ? siteControlActivity(userId, site.id) : Promise.resolve(null),
    site.optimizationOn ? siteControlSavings(userId, site.id) : Promise.resolve(null),
  ]);

  const plan = describeControlPlan(
    schedule.map((item) => ({
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      mode: item.mode,
      targetSocPct: item.targetSoc == null ? null : Number(item.targetSoc),
      batteryKw: item.batteryKw == null ? null : Number(item.batteryKw),
    })),
    now,
    36,
  );
  const planBlocks = [...(plan.current ? [plan.current] : []), ...plan.upcoming];

  // What the analysis says control is worth on today's plant and tariff.
  const ownTariff = analysis?.scenarios.filter((scenario) => scenario.priceCurve.purpose === "CURRENT_BASELINE") ?? [];
  const cheapest = (mode: "SMART" | "SELF_USE") => ownTariff
    .filter((scenario) => scenario.controlMode === mode && scenario.annualCostCzk != null)
    .map((scenario) => Number(scenario.annualCostCzk))
    .sort((a, b) => a - b)[0] ?? null;
  const smartCost = cheapest("SMART");
  const selfUseCost = cheapest("SELF_USE");
  const modelledSavingCzk = smartCost != null && selfUseCost != null ? selfUseCost - smartCost : null;

  const totals = (savings ?? []).reduce(
    (sum, item) => ({
      dayCzk: sum.dayCzk + item.dayCzk,
      weekCzk: sum.weekCzk + item.weekCzk,
      monthCzk: sum.monthCzk + item.monthCzk,
      yearCzk: sum.yearCzk + item.yearCzk,
    }),
    { dayCzk: 0, weekCzk: 0, monthCzk: 0, yearCzk: 0 },
  );
  const measuredIntervals = (savings ?? []).flatMap((item) => item.intervals).filter((interval) => interval.savingsCzk !== 0).length;
  const lastPlanAt = (activity ?? [])
    .map((item) => item.scheduleUpdatedAt ?? item.lastRun?.finishedAt ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return <div className="space-y-6">
    <PageHeader title="Řízení" description={`${site.name}: co chytré řízení právě dělá a co tím získáváte.`} />

    <section className="grid gap-4 md:grid-cols-3">
      <StepCard
        number="1"
        title="Technické údaje"
        done={readiness.controlReady}
        description={readiness.controlReady
          ? "Limity sítě, střídače, baterie i skutečné ceny jsou vyplněné."
          : `Chybí: ${readiness.controlMissing.map((field) => controlFieldLabels[field] ?? field).join(", ")}.`}
        href={`/app/elektrarna?siteId=${site.id}&intent=control`}
      />
      <StepCard
        number="2"
        title="Analýza úspor"
        done={Boolean(analysis)}
        description={analysis
          ? `Poslední výpočet ${dateTime.format(analysis.createdAt)}${modelledSavingCzk != null ? `, řízení podle něj ušetří ${czk.format(Math.max(0, Math.round(modelledSavingCzk)))} Kč za rok` : ""}.`
          : "Porovnáme provoz bez řízení a s chytrým řízením při stejných cenách."}
        href={`/app/analyza?siteId=${site.id}`}
      />
      <StepCard
        number="3"
        title="Aktivní řízení"
        done={site.optimizationOn}
        doneLabel="Běží"
        description={site.optimizationOn
          ? `Plán přepočítáváme každých 15 minut${lastPlanAt ? `, naposledy ${clock.format(new Date(lastPlanAt))}` : ""}.`
          : "Zapnout můžete níže. Střídač se do řízení nikdy nepřepne sám."}
      />
    </section>

    <ControlSiteCard
      site={{
        id: site.id,
        name: site.name,
        optimizationOn: site.optimizationOn,
        controlReady: readiness.controlReady,
        missingLabels: readiness.controlMissing.map((field) => controlFieldLabels[field] ?? field),
        inverterCount: site._count.inverters,
      }}
      entitled={Boolean(entitled)}
      freeAccess={freeAccessEnabled()}
    />

    {site.optimizationOn && (
      <>
        <section className="app-card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Co řízení plánuje</h2>
              <p className="mt-1 text-sm text-slate-500">
                Nejbližší kroky, které řízení chystá pro baterii a odběr. Průběh v čase vidíte v grafech na přehledu.
              </p>
            </div>
            <Zap className="size-5 text-brand-600" />
          </div>
          {planBlocks.length === 0 ? (
            <p className="p-5 text-sm text-slate-500 sm:p-6">Backend zatím pro nejbližší hodiny nemá plán. Nový vzniká každých 15 minut.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {planBlocks.slice(0, 8).map((block, index) => {
                const style = planModeStyle(block.mode);
                return (
                  <li key={`${block.startAt}-${index}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 sm:px-6">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: style.color }} />
                    <span className="w-44 shrink-0 text-sm tabular-nums text-slate-500">
                      {clock.format(new Date(block.startAt))} – {clock.format(new Date(block.endAt))}
                    </span>
                    <span className="text-sm font-medium text-slate-900">{block.mode}</span>
                    {block.targetSocPct != null && (
                      <span className="text-sm text-slate-500">cíl baterie {czkPrecise.format(block.targetSocPct)} %</span>
                    )}
                    {index === 0 && <StatusBadge tone="brand">Právě teď</StatusBadge>}
                  </li>
                );
              })}
            </ul>
          )}
          {plan.allSelfUse && (
            <p className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs leading-5 text-slate-600 sm:px-6">
              Celý plán je vlastní spotřeba. Při vaší sazbě se nabíjení ze sítě ani přednostní přetok nevyplatí, takže řízení nechává elektrárnu spotřebovávat vlastní výrobu. Jakmile se jiný krok vyplatí, plán se změní sám a uvidíte ho tady.
            </p>
          )}
        </section>

        <section className="app-card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5 sm:p-6">
            <div>
              <h2 className="font-semibold text-slate-900">Co tím vyděláváte</h2>
              <p className="mt-1 text-sm text-slate-500">
                Naměřený rozdíl proti provozu bez řízení. Počítá se každých 15 minut ze skutečných toků a cen.
              </p>
            </div>
            <Coins className="size-5 text-brand-600" />
          </div>
          {savings === null ? (
            <p className="p-5 text-sm text-slate-500 sm:p-6">Údaje o úsporách zatím nejsou dostupné.</p>
          ) : (
            <>
              <dl className="grid gap-4 p-5 sm:grid-cols-4 sm:p-6">
                <SavingsTile label="Dnes" value={totals.dayCzk} />
                <SavingsTile label="Tento týden" value={totals.weekCzk} />
                <SavingsTile label="Tento měsíc" value={totals.monthCzk} />
                <SavingsTile label="Letos" value={totals.yearCzk} />
              </dl>
              <p className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">
                {measuredIntervals > 0
                  ? `Řízení zatím zasáhlo v ${measuredIntervals} čtvrthodinách.`
                  : "Řízení zatím nemuselo zasáhnout: vlastní spotřeba byla po celou dobu nejlevnější."}
                {modelledSavingCzk != null
                  ? ` Analýza očekává ${czk.format(Math.max(0, Math.round(modelledSavingCzk)))} Kč za rok.`
                  : ""}
              </p>
            </>
          )}
        </section>
      </>
    )}

    <p className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
      <AlertTriangle className="mt-1 size-4 shrink-0" />
      Zapnutí zůstává zablokované, dokud nejsou potvrzené síťové a bateriové limity. Obchodní aktivace sama nikdy nezapne střídač.
    </p>
  </div>;
}

function SavingsTile({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">
        {czkPrecise.format(value)} <span className="text-sm font-medium text-slate-500">Kč</span>
      </dd>
    </div>
  );
}

function StepCard({ number, title, done, doneLabel = "Hotovo", description, href }: {
  number: string;
  title: string;
  done: boolean;
  doneLabel?: string;
  description: string;
  href?: string;
}) {
  const body = <>
    <div className="flex items-center justify-between">
      <span className={`grid size-9 place-items-center rounded-full text-sm font-bold ${done ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
        {done ? <CheckCircle2 className="size-5" /> : number}
      </span>
      <StatusBadge tone={done ? "success" : "neutral"}>{done ? doneLabel : "Čeká"}</StatusBadge>
    </div>
    <h2 className="mt-4 font-semibold text-slate-900">{title}</h2>
    <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
  </>;
  return href
    ? <Link href={href} className="app-card block p-5 transition hover:border-brand-200">{body}</Link>
    : <article className="app-card p-5">{body}</article>;
}

const controlFieldLabels: Record<string, string> = {
  ean: "EAN",
  distributionTariffCode: "distribuční sazba",
  phases: "počet fází",
  mainFuseA: "hlavní jistič",
  maxGridInputKw: "limit odběru ze sítě",
  maxGridOutputKw: "limit přetoků",
  exportAllowed: "povolení přetoků",
  batteryCapacityKwh: "kapacita baterie",
  batteryMaxChargeKw: "limit nabíjení",
  batteryMaxDischargeKw: "limit vybíjení",
  batteryMinSocPct: "minimální SoC",
  batteryMaxSocPct: "maximální SoC",
  buyPricingMode: "typ nákupu",
  sellPricingMode: "typ výkupu",
  fixedBuyPriceCzkKwh: "fixní nákupní cena",
  fixedSellPriceCzkKwh: "fixní výkupní cena",
  spotBuyFeeCzkKwh: "spotový poplatek k nákupu",
  spotSellFeeCzkKwh: "spotový poplatek k výkupu",
};
