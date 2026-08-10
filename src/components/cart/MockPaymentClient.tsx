"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MockPaymentClient({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/payments/mock/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Testovací platbu se nepodařilo dokončit.");
      return;
    }
    router.push(`/platba/navrat?payment=${encodeURIComponent(paymentId)}`);
    router.refresh();
  }

  return <div><button type="button" className="app-button w-full" onClick={complete} disabled={busy}>{busy ? <LoaderCircle className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />}{busy ? "Dokončuji…" : "Simulovat úspěšnou platbu"}</button>{error && <p className="mt-3 rounded-xl bg-error-50 p-3 text-sm text-error-600">{error}</p>}</div>;
}
