"use client";

import { CalendarCheck2, CalendarPlus2, Link2, RefreshCw, Trash2, Unlink2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Booking = { id: number; guestName: string | null; guestEmail: string; guestPhone: string | null; note: string | null; status: string };
type Slot = { id: number; startUtc: string; endUtc: string; status: string; booking: Booking | null };
type CalendarItem = { id: string; summary: string; primary: boolean };
type CalendarState = {
  connected: boolean;
  configured: boolean;
  googleEmail: string | null;
  maskCalendarIds: string[];
  targetCalendarId: string | null;
  autoMeet: boolean;
  targetSlotsPerWeek: number;
  calendars: CalendarItem[];
  calendarError: string | null;
};

const STATUS_LABELS: Record<string, string> = { OPEN: "Volný", HELD: "Čeká na potvrzení", BOOKED: "Rezervovaný", BLOCKED: "Blokovaný", CANCELED: "Zrušený" };
const STATUS_CLASSES: Record<string, string> = { OPEN: "bg-blue-50 text-blue-700", HELD: "bg-warning-50 text-warning-600", BOOKED: "bg-success-50 text-success-600", BLOCKED: "bg-slate-100 text-slate-600", CANCELED: "bg-slate-100 text-slate-400" };
const formatDate = (value: string) => new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" }).format(new Date(value));

function pragueLocalToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (instant: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Prague", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour === "24" ? 0 : parts.hour), Number(parts.minute), Number(parts.second)) - instant;
  };
  let result = guess - offset(guess);
  result = guess - offset(result);
  return new Date(result).toISOString();
}

export default function AdminConsultations() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [calendar, setCalendar] = useState<CalendarState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [slotsResponse, calendarResponse] = await Promise.all([
      fetch("/api/admin/consultations/slots", { cache: "no-store" }),
      fetch("/api/admin/consultations/calendar", { cache: "no-store" }),
    ]);
    if (slotsResponse.ok) setSlots(((await slotsResponse.json()) as { slots?: Slot[] }).slots || []);
    if (calendarResponse.ok) setCalendar(await calendarResponse.json() as CalendarState);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy(true); setError(null); setMessage(null);
    const response = await fetch("/api/admin/consultations/slots/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const payload = await response.json().catch(() => ({})) as { created?: number; error?: string };
    setBusy(false);
    if (!response.ok) setError(payload.error === "CALENDAR_SYNC_FAILED" ? "Nepodařilo se ověřit obsazenost Google Kalendáře. Termíny nebyly vytvořeny." : "Termíny se nepodařilo vygenerovat.");
    else setMessage(`Vytvořeno termínů: ${payload.created || 0}.`);
    await load();
  }

  async function createSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    const form = new FormData(event.currentTarget);
    const startUtc = pragueLocalToIso(String(form.get("start")));
    const duration = Number(form.get("duration"));
    const endUtc = startUtc ? new Date(new Date(startUtc).getTime() + duration * 60_000).toISOString() : "";
    const response = await fetch("/api/admin/consultations/slots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startUtc, endUtc }) });
    setBusy(false);
    if (!response.ok) setError(response.status === 409 ? "Termín se překrývá s již vytvořeným termínem." : "Termín se nepodařilo vytvořit.");
    else { setMessage("Termín byl vytvořen."); event.currentTarget.reset(); }
    await load();
  }

  async function updateSlot(id: number, status: "OPEN" | "BLOCKED") {
    await fetch(`/api/admin/consultations/slots/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    await load();
  }

  async function removeSlot(id: number) {
    if (!window.confirm("Odstranit tento termín?")) return;
    await fetch(`/api/admin/consultations/slots/${id}`, { method: "DELETE" });
    await load();
  }

  async function bookingStatus(id: number, status: "COMPLETED" | "NO_SHOW") {
    await fetch(`/api/admin/consultations/bookings/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    await load();
  }

  async function saveCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calendar) return;
    setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/consultations/calendar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetCalendarId: String(form.get("target") || "") || null,
        maskCalendarIds: form.getAll("mask").map(String),
        autoMeet: form.get("autoMeet") === "on",
        targetSlotsPerWeek: Number(form.get("targetSlots")),
      }),
    });
    setBusy(false);
    if (response.ok) setMessage("Nastavení kalendáře bylo uloženo.");
    else setError("Nastavení se nepodařilo uložit.");
    await load();
  }

  async function disconnect() {
    if (!window.confirm("Odpojit Google Kalendář? Odpojení je možné pouze bez budoucích rezervací a čekajících synchronizací.")) return;
    setBusy(true); setError(null); setMessage(null);
    const response = await fetch("/api/admin/google-calendar/disconnect", { method: "POST" });
    const payload = await response.json().catch(() => ({})) as { error?: string; activeBookings?: number; pendingJobs?: number };
    setBusy(false);
    if (response.status === 409) {
      setError(`Kalendář nelze odpojit: ${payload.activeBookings || 0} budoucích rezervací a ${payload.pendingJobs || 0} neuzavřených synchronizací jej stále potřebuje.`);
    } else if (!response.ok) {
      setError("Google oprávnění se nepodařilo bezpečně odvolat. Připojení zůstalo zachované; zkuste to znovu.");
    } else {
      setMessage("Google Kalendář byl odpojen.");
    }
    await load();
  }

  return (
    <div className="space-y-6">
      {(message || error) && <div className={`rounded-xl border p-4 text-sm ${error ? "border-error-600/20 bg-error-50 text-error-600" : "border-success-600/20 bg-success-50 text-success-600"}`}>{error || message}</div>}

      <section className="app-card p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div><div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Link2 className="size-5 text-brand-600" /> Google Kalendář</div><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Obsazené časy z vybraných kalendářů skryjeme a potvrzené konzultace vložíme do cílového kalendáře.</p></div>
          {calendar?.connected ? <button type="button" disabled={busy} onClick={disconnect} className="app-button app-button-secondary disabled:opacity-50"><Unlink2 className="size-4" />Odpojit</button> : <a href="/api/admin/google-calendar/connect" className={`app-button ${calendar && !calendar.configured ? "pointer-events-none opacity-50" : ""}`}>Připojit Google</a>}
        </div>
        {calendar && !calendar.configured && <p className="mt-4 rounded-xl bg-warning-50 p-3 text-sm leading-6 text-warning-600">Google Calendar zatím není propojený s nasazením Spottex. Postup pro vytvoření OAuth údajů a přesnou callback adresu najdete v <code>docs/INTEGRATIONS_AND_SECRETS.md</code>.</p>}
        {calendar?.connected && <form onSubmit={saveCalendar} className="mt-6 grid gap-5 border-t border-slate-100 pt-6 lg:grid-cols-2"><div><p className="mb-2 text-sm font-semibold text-slate-700">Připojeno jako {calendar.googleEmail}</p><label className="block text-sm text-slate-600">Cílový kalendář<select className="app-input mt-1.5" name="target" defaultValue={calendar.targetCalendarId || ""}><option value="">Nevytvářet události</option>{calendar.calendars.map((item) => <option key={item.id} value={item.id}>{item.summary}{item.primary ? " (hlavní)" : ""}</option>)}</select></label><label className="mt-4 flex gap-3 text-sm text-slate-600"><input name="autoMeet" type="checkbox" defaultChecked={calendar.autoMeet} className="size-4 accent-brand-600" />Automaticky vytvořit Google Meet</label><label className="mt-4 block text-sm text-slate-600">Cílový počet termínů týdně<input className="app-input mt-1.5" name="targetSlots" type="number" min={1} max={100} defaultValue={calendar.targetSlotsPerWeek} /></label></div><fieldset><legend className="text-sm font-semibold text-slate-700">Kalendáře maskující obsazenost</legend><div className="mt-2 max-h-48 space-y-2 overflow-auto rounded-xl border border-slate-200 p-3">{calendar.calendars.map((item) => <label key={item.id} className="flex gap-3 text-sm text-slate-600"><input name="mask" type="checkbox" value={item.id} defaultChecked={calendar.maskCalendarIds.includes(item.id)} className="size-4 accent-brand-600" />{item.summary}</label>)}</div><button className="app-button mt-4" disabled={busy}>Uložit nastavení</button></fieldset></form>}
      </section>

      <section className="grid gap-6 xl:grid-cols-[.75fr_1.25fr]">
        <div className="app-card p-5 sm:p-6"><div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><CalendarPlus2 className="size-5 text-brand-600" />Vypsat termíny</div><button type="button" onClick={generate} disabled={busy} className="app-button mt-5 w-full"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />Doplnit příští týden</button><p className="mt-2 text-xs leading-5 text-slate-400">Systém doplní cílový počet 30minutových termínů rovnoměrně mezi pracovní dny a respektuje připojené kalendáře.</p><div className="my-6 border-t border-slate-100" /><form onSubmit={createSlot} className="space-y-4"><label className="block text-sm font-medium text-slate-700">Ruční termín (Praha)<input name="start" type="datetime-local" required className="app-input mt-1.5" /></label><label className="block text-sm font-medium text-slate-700">Délka<select name="duration" className="app-input mt-1.5" defaultValue="30"><option value="30">30 minut</option><option value="45">45 minut</option><option value="60">60 minut</option></select></label><button className="app-button app-button-secondary w-full" disabled={busy}>Vytvořit termín</button></form></div>

        <div className="app-card overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2 font-semibold text-slate-900"><CalendarCheck2 className="size-5 text-brand-600" />Termíny a rezervace</div><span className="text-xs text-slate-400">{slots.length} záznamů</span></div><div className="max-h-[680px] overflow-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3 font-medium">Termín</th><th className="px-5 py-3 font-medium">Stav</th><th className="px-5 py-3 font-medium">Zájemce</th><th className="px-5 py-3 text-right font-medium">Akce</th></tr></thead><tbody className="divide-y divide-slate-100">{loading && <tr><td colSpan={4} className="p-8 text-center text-slate-400">Načítám…</td></tr>}{!loading && !slots.length && <tr><td colSpan={4} className="p-8 text-center text-slate-400">Zatím nejsou vypsané termíny.</td></tr>}{slots.map((slot) => <tr key={slot.id}><td className="whitespace-nowrap px-5 py-4 font-medium capitalize text-slate-700">{formatDate(slot.startUtc)}</td><td className="px-5 py-4"><span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[slot.status] || STATUS_CLASSES.BLOCKED}`}>{STATUS_LABELS[slot.status] || slot.status}</span></td><td className="px-5 py-4">{slot.booking ? <div><p className="font-medium text-slate-700">{slot.booking.guestName || "—"}</p><p className="text-xs text-slate-400">{slot.booking.guestEmail}{slot.booking.guestPhone ? ` · ${slot.booking.guestPhone}` : ""}</p>{slot.booking.note && <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{slot.booking.note}</p>}</div> : <span className="text-slate-300">—</span>}</td><td className="px-5 py-4"><div className="flex justify-end gap-1">{["OPEN", "BLOCKED"].includes(slot.status) && <><button type="button" className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100" onClick={() => updateSlot(slot.id, slot.status === "OPEN" ? "BLOCKED" : "OPEN")}>{slot.status === "OPEN" ? "Blokovat" : "Otevřít"}</button><button type="button" aria-label="Odstranit" className="rounded-lg p-1.5 text-error-600 hover:bg-error-50" onClick={() => removeSlot(slot.id)}><Trash2 className="size-4" /></button></>}{slot.status === "BOOKED" && slot.booking?.status === "CONFIRMED" && <><button type="button" className="rounded-lg px-2 py-1.5 text-xs font-semibold text-success-600 hover:bg-success-50" onClick={() => bookingStatus(slot.booking!.id, "COMPLETED")}>Dokončeno</button><button type="button" className="rounded-lg px-2 py-1.5 text-xs font-semibold text-warning-600 hover:bg-warning-50" onClick={() => bookingStatus(slot.booking!.id, "NO_SHOW")}>Nedorazil</button></>}</div></td></tr>)}</tbody></table></div></div>
      </section>
    </div>
  );
}
