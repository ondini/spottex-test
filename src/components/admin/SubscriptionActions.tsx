"use client";

import { useState } from "react";

export function SubscriptionActions({ id, active }: { id: string; active: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "warning" | "error">("idle");
  if (!active || state === "done") return <span className="text-xs text-slate-400">—</span>;
  if (state === "warning") return <span role="alert" className="block max-w-56 text-xs font-medium leading-5 text-warning-600">Ukončeno; OFF není potvrzen. Ověřte zařízení a audit.</span>;
  return <button type="button" disabled={state === "busy"} className="text-xs font-semibold text-error-600 hover:underline disabled:opacity-50" onClick={async () => {
    if (!window.confirm("Opravdu ukončit toto předplatné? Řízení střídače se uživateli deaktivuje.")) return;
    setState("busy");
    const response = await fetch(`/api/admin/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    setState(response.status === 202 ? "warning" : response.ok ? "done" : "error");
  }}>{state === "busy" ? "Ukončuji…" : state === "error" ? "Akce selhala – zkusit znovu" : "Ukončit"}</button>;
}
