"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function HistoryImportRetryButton({ importId }: { importId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry() {
    setPending(true); setError(null);
    const response = await fetch(`/api/admin/history-imports/${importId}/retry`, { method: "POST" });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(body.error || "Import se nepodařilo znovu zařadit."); setPending(false); return; }
    router.refresh();
    setPending(false);
  }
  return <div className="text-right"><button type="button" className="app-button app-button-secondary min-h-9 px-3 py-2 text-sm" disabled={pending} onClick={() => void retry()}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}Znovu spustit chybné bloky</button>{error && <p className="mt-2 text-xs text-red-700">{error}</p>}</div>;
}
