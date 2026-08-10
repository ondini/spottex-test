"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

export default function ConfirmConsultationForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/consultations/verify", {
        method: "POST",
        body: new URLSearchParams({ token }),
      });
      if (!response.ok) {
        setError("Rezervaci se nepodařilo potvrdit. Otevřete prosím odkaz z e-mailu znovu.");
        return;
      }
      window.location.assign(response.url);
    } catch {
      setError("Rezervaci se nepodařilo potvrdit. Zkuste to prosím znovu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action="/api/consultations/verify" method="post" onSubmit={submit} className="mt-7">
      <input type="hidden" name="token" value={token} />
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-error-50 p-3 text-sm text-error-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="app-button w-full disabled:opacity-60">
        {pending && <LoaderCircle className="size-5 animate-spin" />}
        {pending ? "Potvrzuji…" : "Potvrdit rezervaci"}
      </button>
    </form>
  );
}
