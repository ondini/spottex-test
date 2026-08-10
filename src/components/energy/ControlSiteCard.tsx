"use client";

import { Activity, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/app-shell/PagePrimitives";

export function ControlSiteCard({
  site,
  entitled,
}: {
  site: {
    id: number;
    name: string;
    optimizationOn: boolean;
    controlReady: boolean;
    missingLabels: string[];
    inverterCount: number;
  };
  entitled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggleControl() {
    const turningOn = !site.optimizationOn;
    if (turningOn && !window.confirm(
      `Zapnout optimální řízení elektrárny ${site.name} na všech ${site.inverterCount} střídačích?`,
    )) return;
    setPending(true);
    setMessage(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch(`/api/app/energy/sites/${site.id}/commands`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ type: turningOn ? "turnon" : "turnoff" }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Příkaz se nepodařilo potvrdit.");
      setMessage(turningOn
        ? "Řízení potvrdily všechny střídače elektrárny."
        : "Všechny střídače potvrdily návrat do self-use režimu.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Příkaz se nepodařilo potvrdit.");
    } finally {
      setPending(false);
    }
  }

  return <article className="app-card flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center">
    <div className="flex items-start gap-4">
      <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${site.optimizationOn ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
        <Activity className="size-5" />
      </span>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-slate-900">{site.name}</h2>
          <StatusBadge tone={site.optimizationOn ? "success" : "neutral"}>
            {site.optimizationOn ? "Řízení zapnuté" : "Řízení vypnuté"}
          </StatusBadge>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {site.controlReady
            ? `Připraveno pro bezpečné řízení ${site.inverterCount} ${site.inverterCount === 1 ? "střídače" : "střídačů"}.`
            : `Chybí: ${site.missingLabels.join(", ")}.`}
        </p>
        {message ? <p className="mt-2 text-sm font-medium text-slate-700">{message}</p> : null}
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Link href={`/app/elektrarna?siteId=${site.id}&intent=control`} className="app-button app-button-secondary">
        Zkontrolovat údaje
      </Link>
      {entitled ? <button
        type="button"
        className="app-button"
        disabled={pending || (!site.controlReady && !site.optimizationOn)}
        onClick={() => void toggleControl()}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {site.optimizationOn ? "Vypnout řízení" : "Zapnout řízení"}
      </button> : <Link href="/app/sluzba" className="app-button">Aktivovat službu zdarma</Link>}
    </div>
  </article>;
}
