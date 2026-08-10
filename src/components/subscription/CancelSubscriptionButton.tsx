"use client";

import { useState } from "react";

export function CancelSubscriptionButton({ subscriptionId }: { subscriptionId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "warning" | "error">("idle");
  if (state === "done") return <p className="text-xs font-medium text-slate-500">Služba byla ukončena.</p>;
  if (state === "warning") return <p role="alert" className="max-w-sm text-xs font-medium leading-5 text-warning-600">Služba byla ukončena, ale vypnutí zařízení zatím nebylo potvrzeno. Ověřte stav střídače a kontaktujte podporu Spottex.</p>;
  return <button type="button" disabled={state === "busy"} className="text-xs font-semibold text-error-600 hover:underline disabled:opacity-50" onClick={async () => {
    if (!window.confirm("Opravdu chcete službu okamžitě ukončit? Chytré řízení střídače se vypne.")) return;
    setState("busy");
    const response = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: "POST" });
    setState(response.status === 202 ? "warning" : response.ok ? "done" : "error");
  }}>{state === "busy" ? "Ukončuji…" : state === "error" ? "Akce selhala – zkusit znovu" : "Ukončit službu"}</button>;
}
