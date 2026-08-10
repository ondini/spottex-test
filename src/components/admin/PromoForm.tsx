"use client";

import { useState } from "react";

export default function PromoForm({ userId }: { userId: number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("Individuální PROMO aktivace z administrace");

  async function activate() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/subscriptions/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, days, reason }),
    });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "PROMO aktivováno" : data.error === "ACTIVE_SUBSCRIPTION_EXISTS" ? "Uživatel už má aktivní službu" : "Aktivace se nezdařila");
    setBusy(false);
  }

  return (
    <div className="flex min-w-72 flex-col gap-2">
      <div className="flex items-center gap-2">
        <input className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs" type="number" min={1} max={730} aria-label="Počet dnů PROMO" value={days} onChange={(event) => setDays(Number(event.target.value))} />
        <input className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs" maxLength={500} aria-label="Důvod PROMO" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <button type="button" onClick={activate} disabled={busy} className="rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
        {busy ? "Aktivuji…" : `Aktivovat PROMO na ${days || 0} dní`}
      </button>
      {message ? <span className="text-xs text-gray-500">{message}</span> : null}
    </div>
  );
}
