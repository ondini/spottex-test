"use client";

import { CalendarDays, CheckCircle2, Clock3, MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { trackEvent } from "@/lib/client-analytics";

type Slot = {
  id: number;
  startUtc: string;
  endUtc: string;
  hostName: string;
};

const dayKey = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(value));

const dayLabel = (value: string) => new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  weekday: "long",
  day: "numeric",
  month: "long",
}).format(new Date(value));

const timeLabel = (value: string) => new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(value));

export default function BookingWidget() {
  const searchParams = useSearchParams();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(() => {
    const value = Number(searchParams.get("slot"));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void trackEvent("CONSULTATION_VIEW", "/konzultace");
    const controller = new AbortController();
    const to = new Date(Date.now() + 45 * 86_400_000);
    fetch(`/api/consultations/availability?to=${encodeURIComponent(to.toISOString())}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Termíny se nepodařilo načíst.");
        const payload = await response.json() as { slots?: Slot[] };
        setSlots(Array.isArray(payload.slots) ? payload.slots : []);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Termíny se nepodařilo načíst.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots) grouped.set(dayKey(slot.startUtc), [...(grouped.get(dayKey(slot.startUtc)) || []), slot]);
    return [...grouped.entries()].map(([key, rows]) => ({ key, label: dayLabel(rows[0].startUtc), slots: rows }));
  }, [slots]);
  const selected = slots.find((slot) => slot.id === selectedSlotId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlotId) {
      setError("Nejprve vyberte termín konzultace.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/consultations/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slotId: selectedSlotId,
        guestName: form.get("name"),
        guestEmail: form.get("email"),
        guestPhone: form.get("phone") || null,
        note: form.get("note") || null,
        consent: form.get("consent") === "on",
        website: form.get("website") || "",
      }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    setSubmitting(false);
    if (response.ok) {
      void trackEvent("CONSULTATION_BOOKED", "/konzultace");
      setComplete(true);
      return;
    }
    if (payload.error === "SLOT_TAKEN") {
      setError("Tento termín právě rezervoval někdo jiný. Vyberte prosím jiný.");
      setSlots((current) => current.filter((slot) => slot.id !== selectedSlotId));
      setSelectedSlotId(null);
    } else if (payload.error === "RATE_LIMITED") {
      setError("Proběhlo příliš mnoho pokusů. Zkuste to prosím za několik minut.");
    } else {
      setError("Rezervaci se nepodařilo uložit. Zkontrolujte údaje a zkuste to znovu.");
    }
  }

  if (complete) {
    return (
      <div className="booking-success">
        <span><MailCheck aria-hidden="true" /></span>
        <h2>Zkontrolujte svůj e-mail</h2>
        <p>
          Termín držíme 30 minut. Rezervaci dokončíte kliknutím na potvrzovací odkaz, poté obdržíte informace ke schůzce.
        </p>
      </div>
    );
  }

  return (
    <div className="booking-layout">
      <section className="booking-panel booking-panel--slots">
        <div className="booking-step-heading">
          <span><CalendarDays aria-hidden="true" /></span>
          <div><p>1. krok</p><h3>Vyberte termín</h3></div>
        </div>
        <div className="booking-slot-list" aria-live="polite">
          {loading && <div className="booking-state">Načítám volné termíny…</div>}
          {!loading && groups.length === 0 && (
            <div className="booking-state booking-state--empty">
              <CalendarDays aria-hidden="true" />
              <strong>Nové termíny právě připravujeme.</strong>
              <p>Napište nám na <a href="mailto:info@spottex.cz">info@spottex.cz</a> a domluvíme se individuálně.</p>
            </div>
          )}
          {groups.map((group) => (
            <div className="booking-day" key={group.key}>
              <h4>{group.label}</h4>
              <div className="booking-times">
                {group.slots.map((slot) => {
                  const active = selectedSlotId === slot.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => {
                        setSelectedSlotId(slot.id);
                        setError(null);
                      }}
                      className={active ? "is-active" : ""}
                      aria-pressed={active}
                    >
                      {timeLabel(slot.startUtc)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={submit} className="booking-panel booking-panel--form">
        <div className="booking-step-heading">
          <span><CheckCircle2 aria-hidden="true" /></span>
          <div><p>2. krok</p><h3>Kontaktní údaje</h3></div>
        </div>
        <div className={`booking-selection${selected ? " is-selected" : ""}`}>
          <Clock3 aria-hidden="true" />
          {selected ? <strong>{dayLabel(selected.startUtc)}, {timeLabel(selected.startUtc)}</strong> : <span>Zvolený termín se zobrazí zde.</span>}
        </div>
        <div className="booking-fields">
          <label>Jméno a příjmení<input className="app-input" name="name" required minLength={2} maxLength={160} autoComplete="name" /></label>
          <label>E-mail<input className="app-input" name="email" type="email" required autoComplete="email" /></label>
          <label>Telefon <span>(nepovinné)</span><input className="app-input" name="phone" type="tel" maxLength={50} autoComplete="tel" /></label>
          <label>Co chcete probrat? <span>(nepovinné)</span><textarea className="app-input" name="note" maxLength={2000} /></label>
          <label className="hidden" aria-hidden="true">Web<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <label className="booking-consent"><input name="consent" type="checkbox" required /><span>Souhlasím se zpracováním údajů za účelem sjednání konzultace. <Link href="/ochrana-osobnich-udaju">Podrobnosti</Link></span></label>
        </div>
        {error && <p role="alert" className="booking-error">{error}</p>}
        <button className="booking-submit" disabled={submitting || !selectedSlotId}>{submitting ? "Rezervuji…" : "Nezávazně rezervovat termín"}</button>
        <p className="booking-submit-note">Rezervaci potvrdíte odkazem zaslaným na uvedený e-mail.</p>
      </form>
    </div>
  );
}
