"use client";

import { CalendarClock, CircleCheck, CircleX, ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Booking = {
  id: number;
  status: string;
  guestName: string | null;
  canModify: boolean;
  slot: { id: number; startUtc: string; endUtc: string; meetUrl: string | null };
};
type Slot = { id: number; startUtc: string; endUtc: string };

const formatDate = (value: string) => new Intl.DateTimeFormat("cs-CZ", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Prague" }).format(new Date(value));

export default function ManageBooking() {
  const searchToken = useSearchParams().get("token") || "";
  const [token] = useState(searchToken);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [newSlotId, setNewSlotId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) { setError("Odkaz pro správu rezervace není úplný."); setLoading(false); return; }
    const response = await fetch(`/api/consultations/manage?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) { setError("Rezervaci se nepodařilo najít. Odkaz může být neplatný."); setLoading(false); return; }
    const payload = await response.json() as { booking: Booking };
    setBooking(payload.booking);
    if (payload.booking.canModify) {
      const availability = await fetch("/api/consultations/availability", { cache: "no-store" });
      const available = await availability.json() as { slots?: Slot[] };
      setSlots((available.slots || []).filter((slot) => slot.id !== payload.booking.slot.id));
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (searchToken) window.history.replaceState(null, "", window.location.pathname);
    void load();
  }, [load, searchToken]);
  const availableOptions = useMemo(() => slots.slice(0, 100), [slots]);

  async function cancel() {
    if (!window.confirm("Opravdu chcete konzultaci zrušit?")) return;
    setBusy(true); setError(null);
    const response = await fetch("/api/consultations/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    setBusy(false);
    if (!response.ok) { setError("Konzultaci už nelze zrušit online. Kontaktujte nás prosím."); return; }
    setMessage("Rezervace byla zrušena a termín je opět volný.");
    setBooking((current) => current ? { ...current, status: "CANCELED", canModify: false, slot: { ...current.slot, meetUrl: null } } : current);
  }

  async function reschedule() {
    if (!newSlotId) return;
    setBusy(true); setError(null);
    const response = await fetch("/api/consultations/reschedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newSlotId }) });
    setBusy(false);
    if (!response.ok) { setError("Vybraný termín už není dostupný. Obnovte stránku a vyberte jiný."); return; }
    setMessage("Termín jsme změnili. Aktualizované potvrzení najdete v e-mailu.");
    setNewSlotId(null);
    await load();
  }

  if (loading) return <div className="app-card p-8 text-center text-slate-500">Načítám rezervaci…</div>;
  if (error && !booking) return <div className="app-card p-8 text-center text-error-600"><CircleX className="mx-auto mb-4 size-12" />{error}</div>;
  if (!booking) return null;

  return (
    <div className="app-card overflow-hidden p-6 sm:p-9">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700"><CalendarClock className="size-6" /></span>
        <div><p className="text-sm font-semibold text-brand-700">Rezervace #{booking.id}</p><h2 className="mt-1 text-2xl font-bold text-slate-950">{formatDate(booking.slot.startUtc)}</h2><p className="mt-2 text-slate-500">Stav: {booking.status === "CONFIRMED" ? "potvrzená" : booking.status === "CANCELED" ? "zrušená" : booking.status}</p></div>
      </div>
      {booking.slot.meetUrl && booking.status === "CONFIRMED" && <a className="app-button mt-6" href={booking.slot.meetUrl} target="_blank" rel="noreferrer">Připojit se ke schůzce <ExternalLink className="size-4" /></a>}
      {message && <p className="mt-6 flex gap-2 rounded-xl bg-success-50 p-4 text-sm text-success-600"><CircleCheck className="size-5 shrink-0" />{message}</p>}
      {error && <p className="mt-6 rounded-xl bg-error-50 p-4 text-sm text-error-600">{error}</p>}
      {booking.canModify ? <div className="mt-8 border-t border-slate-100 pt-7"><h3 className="font-semibold text-slate-900">Změnit termín</h3><div className="mt-3 flex flex-col gap-3 sm:flex-row"><select className="app-input" value={newSlotId || ""} onChange={(event) => setNewSlotId(Number(event.target.value) || null)}><option value="">Vyberte nový termín</option>{availableOptions.map((slot) => <option key={slot.id} value={slot.id}>{formatDate(slot.startUtc)}</option>)}</select><button type="button" className="app-button shrink-0" disabled={!newSlotId || busy} onClick={reschedule}>Uložit změnu</button></div><button type="button" className="mt-6 text-sm font-semibold text-error-600 hover:underline" disabled={busy} onClick={cancel}>Zrušit konzultaci</button><p className="mt-3 text-xs text-slate-400">Změny jsou možné nejpozději 2 hodiny před začátkem.</p></div> : <p className="mt-8 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">Tuto rezervaci už nelze změnit online. V případě potřeby napište na info@spottex.cz.</p>}
    </div>
  );
}
