"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  entity:
    "source" | "product-version" | "distribution-version" | "funding-version";
  id: string;
  status: string;
  hasWarnings: boolean;
  valid: boolean;
};

const errors: Record<string, string> = {
  CATALOG_VALIDATION_FAILED:
    "Návrh nesplňuje povinné kontroly. Opravte uvedené chyby.",
  CATALOG_WARNINGS_NOT_ACCEPTED:
    "Nejdřív výslovně potvrďte varování a velké cenové odchylky.",
  CATALOG_INVALID_TRANSITION: "Tento krok nelze v aktuálním stavu provést.",
  CATALOG_PUBLICATION_OVERLAP:
    "Platnost se překrývá s novější publikovanou verzí.",
};

export function CatalogReviewActions({
  entity,
  id,
  status,
  hasWarnings,
  valid,
}: Props) {
  const router = useRouter();
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "VALIDATE" | "PUBLISH" | "REJECT") {
    let rejectionReason: string | undefined;
    if (action === "REJECT") {
      rejectionReason = window
        .prompt("Důvod zamítnutí (uloží se do auditu):")
        ?.trim();
      if (!rejectionReason) return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/catalog/${entity}/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, acceptWarnings, rejectionReason }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok)
      setError(errors[body.error ?? ""] ?? "Akci se nepodařilo dokončit.");
    else router.refresh();
    setBusy(false);
  }

  const canValidate =
    entity === "source"
      ? ["DRAFT", "REJECTED"].includes(status)
      : ["DRAFT", "REJECTED"].includes(status);
  const canPublish = entity !== "source" && status === "VALIDATED";

  return (
    <div className="space-y-2">
      {hasWarnings && (
        <label className="flex items-start gap-2 text-xs text-amber-800">
          <input
            type="checkbox"
            checked={acceptWarnings}
            onChange={(event) => setAcceptWarnings(event.target.checked)}
            className="mt-0.5"
          />
          Prověřil/a jsem varování a přijímám odchylky.
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {canValidate && (
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => void submit("VALIDATE")}
            className="btn-secondary px-3 py-2 text-xs disabled:opacity-40"
          >
            Zkontrolovat
          </button>
        )}
        {canPublish && (
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => void submit("PUBLISH")}
            className="btn-primary px-3 py-2 text-xs disabled:opacity-40"
          >
            Publikovat do výpočtů
          </button>
        )}
        {status !== "PUBLISHED" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit("REJECT")}
            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40"
          >
            Zamítnout
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
