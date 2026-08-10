import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, BatteryCharging, CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { PageHeader, StatusBadge } from "@/components/app-shell/PagePrimitives";
import { ControlSiteCard } from "@/components/energy/ControlSiteCard";
import { requireUser } from "@/lib/auth/guards";
import { hasInverterControlEntitlement } from "@/lib/commerce/entitlement";
import { getLocalControlReadiness } from "@/lib/energy/technical-profile";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Řízení" };

export default async function ControlPage() {
  const session = await requireUser("/app/rizeni");
  const userId = Number(session.user.id);
  const [sites, entitled] = await Promise.all([
    prisma.energySite.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        optimizationOn: true,
        _count: { select: { inverters: true } },
      },
      orderBy: { id: "asc" },
    }),
    hasInverterControlEntitlement(userId),
  ]);
  const controlSites = await Promise.all(sites.map(async (site) => {
    const { readiness } = await getLocalControlReadiness(userId, site.id);
    return {
      id: site.id,
      name: site.name,
      optimizationOn: site.optimizationOn,
      controlReady: readiness.controlReady,
      missingLabels: readiness.controlMissing.map((field) => controlFieldLabels[field] ?? field),
      inverterCount: site._count.inverters,
    };
  }));

  return <div className="space-y-6">
    <PageHeader title="Řízení" description="Před aktivací společně ověříme technické limity, očekávanou úsporu a platnost služby." />
    <section className="grid gap-4 md:grid-cols-3">
      <StepCard number="1" title="Technické údaje" done={controlSites.length > 0 && controlSites.every((site) => site.controlReady)} description="Limity sítě, střídače, baterie a skutečné ceny musí být vyplněné." />
      <StepCard number="2" title="Analýza úspor" done={false} description="Porovnáme self-use a chytré řízení při stejných cenách." />
      <StepCard number="3" title="Roční služba" done={Boolean(entitled)} description="Před aktivací ukážeme konečnou cenu a podmínky služby." />
    </section>
    {sites.length === 0 ? <section className="app-card p-6 text-center"><BatteryCharging className="mx-auto size-8 text-slate-400" /><h2 className="mt-4 font-semibold text-slate-900">Nejdříve připojte elektrárnu</h2><Link href="/app/dashboard" className="app-button mt-5">Přejít na přehled <ArrowRight className="size-4" /></Link></section> : <section className="space-y-4">{controlSites.map((site) => <ControlSiteCard key={site.id} site={site} entitled={Boolean(entitled)} />)}</section>}
    <p className="flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800"><AlertTriangle className="mt-1 size-4 shrink-0" /> Zapnutí zůstává zablokované, dokud nejsou potvrzené síťové a bateriové limity. Obchodní aktivace sama nikdy nezapne střídač.</p>
  </div>;
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
  spotBuyFeeCzkKwh: "přirážka ke spotovému nákupu",
  spotSellFeeCzkKwh: "srážka ze spotového výkupu",
  fixedPriceValidUntil: "platnost fixní ceny",
};

function StepCard({ number, title, done, description }: { number: string; title: string; done: boolean; description: string }) {
  return <article className="app-card p-5"><div className="flex items-center justify-between"><span className={`grid size-9 place-items-center rounded-full text-sm font-bold ${done ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{done ? <CheckCircle2 className="size-5" /> : number}</span><StatusBadge tone={done ? "success" : "neutral"}>{done ? "Hotovo" : "Čeká"}</StatusBadge></div><h2 className="mt-4 font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{description}</p></article>;
}
