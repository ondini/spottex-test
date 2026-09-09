"use client";

import { Activity, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/app-shell/PagePrimitives";
import { activateFreeControlService } from "@/components/commerce/activate-free-service";

export function ControlSiteCard({
  site,
  entitled,
  freeAccess,
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
  // Free-access mode: the service is activated in the same step as the
  // switch-on, so the owner never has to find the order page first.
  freeAccess: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inverters = `${site.inverterCount} ${site.inverterCount === 1 ? "střídači" : "střídačích"}`;

  async function toggleControl() {
    const turningOn = !site.optimizationOn;
    const activating = turningOn && !entitled && freeAccess;
    if (turningOn && !window.confirm(
      activating
        ? `Aktivovat službu zdarma a zapnout optimální řízení elektrárny ${site.name} na ${inverters}?`
        : `Zapnout optimální řízení elektrárny ${site.name} na ${inverters}?`,
    )) return;
    setPending(true);
    setMessage(null);
    try {
      if (activating) {
        setMessage("Aktivuji službu…");
        await activateFreeControlService();
        setMessage("Služba je aktivní, zapínám řízení…");
      }
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
      if (turningOn) {
        // The plant is running: show it where the owner watches it, not here.
        router.push(`/app/dashboard?siteId=${site.id}`);
        return;
      }
      setMessage("Všechny střídače potvrdily návrat do self-use režimu.");
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
      {entitled || freeAccess ? <button
        type="button"
        className="app-button"
        disabled={pending || (!site.controlReady && !site.optimizationOn)}
        onClick={() => void toggleControl()}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {site.optimizationOn ? "Vypnout řízení" : "Zapnout řízení"}
      </button> : <Link href="/app/sluzba/objednavka" className="app-button">Objednat službu</Link>}
    </div>
  </article>;
}
