"use client";

import { useState } from "react";

type Offer = { id: string; siteName: string; expectedControlSavingsMinor: number; listPriceMinor: number; discountMinor: number; finalPriceMinor: number; validUntil: string; confidence: string | null; methodologyVersion: string; dataFrom: string | null; dataTo: string | null };
const money = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK", maximumFractionDigits: 0 });

export function ServiceOfferCard({ offer }: { offer: Offer }) {
  const freeAccess = process.env.NEXT_PUBLIC_FREE_ACCESS_MODE === "true";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function order() {
    setBusy(true); setError(null);
    const response = await fetch(`/api/app/service-offers/${offer.id}/order`, { method: "POST" });
    const body = await response.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
    if (!response.ok || !body.redirectUrl) { setError("Nabídku se nepodařilo otevřít. Možná už vypršela."); setBusy(false); return; }
    window.location.assign(body.redirectUrl);
  }
  return <section className="app-card border-brand-200 p-5 sm:p-6"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Nabídka pro {offer.siteName}</p><h2 className="mt-2 text-xl font-semibold text-slate-900">{freeAccess ? "Chytré řízení je nyní zdarma" : `Chytré řízení za ${money.format(offer.finalPriceMinor / 100)} ročně`}</h2><p className="mt-2 text-sm leading-6 text-slate-600">Očekávaná úspora proti self-use na stejném tarifu je {money.format(offer.expectedControlSavingsMinor / 100)}. {freeAccess ? "V testovacím provozu neúčtujeme aktivační ani pravidelný poplatek." : `Ceníková cena ${money.format(offer.listPriceMinor / 100)} je snížena o ${money.format(offer.discountMinor / 100)}, aby poplatek nepřesáhl 25 % odhadované úspory.`}</p><div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><strong className="text-slate-800">Jak odhad vznikl:</strong> 15minutové porovnání self-use a chytrého řízení na stejném tarifu, distribuční sazbě a hardwaru. Jistota dat: {offer.confidence || "neuvedena"}.{offer.dataFrom && offer.dataTo ? ` Historie ${new Date(offer.dataFrom).toLocaleDateString("cs-CZ")}–${new Date(offer.dataTo).toLocaleDateString("cs-CZ")}.` : ""} Jde o modelovaný odhad, nikoli záruku skutečné úspory. Metodika {offer.methodologyVersion}.</div><p className="mt-2 text-xs text-slate-400">Platí do {new Date(offer.validUntil).toLocaleDateString("cs-CZ")}. {freeAccess ? "Platební údaje ani souhlas s obnovou nejsou potřeba." : "Před platbou doplníte fakturační údaje a sami zvolíte roční obnovu."}</p></div><button type="button" className="app-button shrink-0" disabled={busy} onClick={() => void order()}>{busy ? "Připravuji…" : freeAccess ? "Aktivovat zdarma" : "Objednat za vypočtenou cenu"}</button></div>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</section>;
}
