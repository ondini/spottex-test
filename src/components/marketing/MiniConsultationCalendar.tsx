"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ConsultationSlot = {
  id: number | string;
  startUtc: string;
  endUtc?: string;
};

const WINDOW_DAYS = 14;
const MAX_DAYS = 3;
const MAX_SLOTS_PER_DAY = 4;
const PRAGUE_TIME_ZONE = "Europe/Prague";

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: PRAGUE_TIME_ZONE,
  }).format(new Date(iso));

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: PRAGUE_TIME_ZONE,
  }).format(new Date(iso));

const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PRAGUE_TIME_ZONE,
  }).format(new Date(iso));

function readSlots(value: unknown): ConsultationSlot[] {
  const payload = value as { slots?: unknown; data?: unknown } | null;
  const candidate = Array.isArray(value)
    ? value
    : Array.isArray(payload?.slots)
      ? payload.slots
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return candidate.filter((slot): slot is ConsultationSlot => {
    if (!slot || typeof slot !== "object") return false;
    const row = slot as Partial<ConsultationSlot>;
    return (
      (typeof row.id === "number" || typeof row.id === "string") &&
      typeof row.startUtc === "string" &&
      !Number.isNaN(new Date(row.startUtc).getTime())
    );
  });
}

export default function MiniConsultationCalendar() {
  const [slots, setSlots] = useState<ConsultationSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const from = new Date();
    const to = new Date(from.getTime() + WINDOW_DAYS * 86_400_000);
    const search = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });

    fetch(`/api/consultations/availability?${search.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("availability"))))
      .then((payload: unknown) => setSlots(readSlots(payload)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSlots([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const days = useMemo(() => {
    const grouped = new Map<string, ConsultationSlot[]>();

    for (const slot of slots) {
      const key = dayKey(slot.startUtc);
      const existing = grouped.get(key) ?? [];
      existing.push(slot);
      grouped.set(key, existing);
    }

    return [...grouped.entries()].slice(0, MAX_DAYS).map(([key, daySlots]) => ({
      key,
      label: dayLabel(daySlots[0].startUtc),
      slots: daySlots.slice(0, MAX_SLOTS_PER_DAY),
      remaining: Math.max(0, daySlots.length - MAX_SLOTS_PER_DAY),
    }));
  }, [slots]);

  return (
    <section className="consultation-preview" aria-labelledby="consultation-preview-title">
      <div className="consultation-preview-inner">
        <div className="section-top section-top--center">
          <div className="badge">
            <span className="badge-dot" />
            Konzultace
          </div>
          <div className="heading-row heading-row--center">
            <div className="heading-line" />
            <h2 id="consultation-preview-title">Probereme vaši fotovoltaiku</h2>
            <div className="heading-line" />
          </div>
          <p className="section-sub section-sub--center">
            Vyberte si nezávazný online termín. Společně projdeme vaši elektrárnu,
            možnosti chytrého řízení i očekávanou úsporu.
          </p>
        </div>

        <div className="consultation-preview-card">
          <div className="consultation-preview-copy">
            <span className="consultation-preview-kicker">30 minut online</span>
            <h3>Najděte termín, který vám vyhovuje</h3>
            <p>
              Bez složité přípravy a bez závazků. Stačí si rezervovat volný čas a
              my se vám ozveme s odkazem na schůzku.
            </p>
            <Link href="/konzultace" className="btn-primary">
              Zobrazit všechny termíny
            </Link>
          </div>

          <div className="consultation-slots" aria-live="polite">
            <div className="consultation-slots-title">Nejbližší volné termíny</div>
            {loading ? (
              <div className="consultation-loading" role="status">
                Načítám termíny…
              </div>
            ) : days.length === 0 ? (
              <div className="consultation-empty">
                <strong>Nové termíny právě připravujeme.</strong>
                <span>Na stránce konzultací nám můžete zanechat kontakt.</span>
                <Link href="/konzultace">Přejít na konzultace</Link>
              </div>
            ) : (
              <div className="consultation-days">
                {days.map((day) => (
                  <div className="consultation-day" key={day.key}>
                    <div className="consultation-day-label">{day.label}</div>
                    <div className="consultation-time-list">
                      {day.slots.map((slot) => (
                        <Link
                          href={`/konzultace?slot=${encodeURIComponent(String(slot.id))}`}
                          className="consultation-time"
                          key={slot.id}
                        >
                          {timeLabel(slot.startUtc)}
                        </Link>
                      ))}
                      {day.remaining > 0 && (
                        <Link href="/konzultace" className="consultation-more">
                          +{day.remaining}
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
                <Link href="/konzultace" className="consultation-show-all">
                  Další dostupné termíny →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
