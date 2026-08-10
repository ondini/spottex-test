"use client";

import { FormEvent, useState } from "react";

export function HdoCalendarImportForm({ sites }: { sites: Array<{ id: number; label: string }> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const intervals = JSON.parse(String(form.get("intervals") || "[]")) as unknown;
      const response = await fetch("/api/admin/hdo-calendars", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ energySiteId: Number(form.get("energySiteId")), validFrom: new Date(String(form.get("validFrom"))).toISOString(), validTo: new Date(String(form.get("validTo"))).toISOString(), sourceReference: String(form.get("sourceReference")), intervals }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "HDO_IMPORT_FAILED");
      setMessage("Přesný kalendář byl uložen. Modelové křivky a staré analýzy byly zneplatněny.");
    } catch (error) {
      setMessage(error instanceof SyntaxError ? "Intervaly nejsou platné JSON." : error instanceof Error ? error.message : "Import se nezdařil.");
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="app-card space-y-4 p-5 sm:p-6">
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Elektrárna<select required name="energySiteId" className="app-input mt-1.5"><option value="">Vyberte…</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Oficiální URL zdroje<input required type="url" name="sourceReference" className="app-input mt-1.5" /></label><label className="text-sm font-medium text-slate-700">Platnost od<input required type="datetime-local" name="validFrom" className="app-input mt-1.5" /></label><label className="text-sm font-medium text-slate-700">Platnost do<input required type="datetime-local" name="validTo" className="app-input mt-1.5" /></label></div>
    <label className="block text-sm font-medium text-slate-700">Intervaly nízkého tarifu v ISO 8601<textarea required name="intervals" rows={10} className="app-input mt-1.5 font-mono text-xs" placeholder={'[{"startAt":"2026-01-01T21:00:00.000Z","endAt":"2026-01-02T05:00:00.000Z"}]'} /></label>
    <p className="text-xs leading-5 text-slate-500">Intervaly musí být uvnitř platnosti, bez překryvů a na hranicích 15 minut. EAN, distributor a časová zóna se neměnně převezmou z elektrárny.</p>
    <div className="flex items-center justify-between gap-3"><span role="status" className="text-sm text-slate-700">{message}</span><button className="app-button" disabled={busy || !sites.length}>{busy ? "Importuji…" : "Importovat přesné HDO"}</button></div>
  </form>;
}
