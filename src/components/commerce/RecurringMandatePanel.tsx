"use client";

import { CreditCard, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";

type Mandate = {
  id: string;
  provider: string;
  status: "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED" | "FAILED";
  currency: string;
  maxAmountMinor: number;
  renewalPeriodDays: number;
  noticeDays: number;
  consentedAt: string;
  validUntil: string | null;
  revokedAt: string | null;
  renewals: Array<{ status: string; amountMinor: number; scheduledAt: string; noticeSentAt: string | null }>;
};

const formatter = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "long" });

export function RecurringMandatePanel({ initialMandates }: { initialMandates: Mandate[] }) {
  const [mandates, setMandates] = useState(initialMandates);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function revoke(id: string) {
    if (!window.confirm("Opravdu chcete zrušit všechny budoucí automatické platby Spottex? Již zaplacené období zůstane aktivní.")) return;
    setPending(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/recurring-mandates/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Zrušení se nepodařilo.");
      setMandates((current) => current.map((mandate) => mandate.id === id
        ? { ...mandate, status: "REVOKED", revokedAt: new Date().toISOString() }
        : mandate));
      setMessage(body?.message || "Budoucí platby byly zrušeny.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Zrušení se nepodařilo.");
    } finally {
      setPending(null);
    }
  }

  if (!mandates.length) {
    return <section className="app-card p-5 sm:p-6"><h2 className="font-semibold text-slate-900">Opakovaná roční platba</h2><p className="mt-2 text-sm leading-6 text-slate-500">Zatím nemáte založený platební mandát. Vznikne až po vašem výslovném souhlasu a první kartové platbě roční služby.</p></section>;
  }

  return <section className="app-card p-5 sm:p-6">
    <div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><CreditCard className="size-5" /></span><div><h2 className="font-semibold text-slate-900">Opakovaná roční platba</h2><p className="mt-1 text-sm leading-6 text-slate-500">Přesnou cenu dalšího roku oznámíme nejméně 14 dní předem. Nikdy nepřekročí 990 Kč ani odsouhlasený limit.</p></div></div>
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
    <div className="mt-5 space-y-3">{mandates.map((mandate) => {
      const renewal = mandate.renewals[0];
      const active = mandate.status === "ACTIVE";
      return <article key={mandate.id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="flex items-center gap-2 font-medium text-slate-900"><ShieldCheck className="size-4 text-brand-600" />{active ? "Aktivní souhlas" : mandate.status === "REVOKED" ? "Budoucí platby zrušeny" : "Neaktivní souhlas"}</p><p className="mt-1 text-xs leading-5 text-slate-500">GoPay · maximálně {(mandate.maxAmountMinor / 100).toLocaleString("cs-CZ")} Kč jednou ročně · oznámení {mandate.noticeDays} dní předem</p>{renewal && <p className="mt-2 text-sm text-slate-700">Další plán: {(renewal.amountMinor / 100).toLocaleString("cs-CZ")} Kč dne {formatter.format(new Date(renewal.scheduledAt))}</p>}</div>{active && <button type="button" onClick={() => void revoke(mandate.id)} disabled={pending !== null} className="app-button-secondary min-h-9 px-3 py-2 text-sm disabled:opacity-50">{pending === mandate.id && <LoaderCircle className="size-4 animate-spin" />}Zrušit budoucí platby</button>}</div>
      </article>;
    })}</div>
  </section>;
}
