"use client";

import { Save } from "lucide-react";
import { useState } from "react";

export default function UserAccessControl({ userId, initialRole, initialStatus }: { userId: number; initialRole: "USER" | "ADMIN"; initialStatus: "ACTIVE" | "DISABLED" | "PENDING_VERIFICATION" }) {
  const [role, setRole] = useState(initialRole);
  const [status, setStatus] = useState(initialStatus === "PENDING_VERIFICATION" ? "ACTIVE" : initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true); setMessage(null);
    const response = await fetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, status }) });
    const payload = await response.json().catch(() => ({})) as { error?: string; warning?: string };
    setBusy(false);
    if (response.ok) setMessage(payload.warning === "DEACTIVATION_PENDING" ? "Přístup uložen; bezpečné vypnutí elektrárny čeká na potvrzení." : "Uloženo");
    else setMessage(payload.error === "LAST_ADMIN" ? "Posledního administrátora nelze odebrat." : payload.error === "CANNOT_DISABLE_SELF" ? "Vlastní účet nelze takto omezit." : "Uložení selhalo.");
  }

  const messageTone = message === "Uloženo"
    ? "text-success-600"
    : message?.includes("čeká na potvrzení")
      ? "text-amber-700"
      : "text-error-600";

  return <div className="min-w-48 space-y-2"><div className="flex gap-2"><select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" value={role} onChange={(event) => setRole(event.target.value as "USER" | "ADMIN")}><option value="USER">Uživatel</option><option value="ADMIN">Admin</option></select><select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE" | "DISABLED")}><option value="ACTIVE">Aktivní</option><option value="DISABLED">Zakázaný</option></select><button type="button" onClick={save} disabled={busy} aria-label="Uložit přístup" className="grid size-8 place-items-center rounded-lg bg-slate-900 text-white disabled:opacity-50"><Save className="size-3.5" /></button></div>{message && <p className={`text-xs ${messageTone}`}>{message}</p>}</div>;
}
