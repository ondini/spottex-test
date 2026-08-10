"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Row = {
  id: string;
  referenceCode: string;
  status: string;
  notes: string | null;
  documents: Array<{
    id: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    billingPeriodFrom: string | null;
    billingPeriodTo: string | null;
    extractionVersion: string | null;
    retainedUntil: string;
  }>;
  latestExtractionVersion: number | null;
  latestExtractionMethod: string | null;
  aiDraft: null | {
    values: Record<string, unknown>;
    fieldEvidence: unknown[];
    warnings: string[];
  };
  site: { ean: string | null; address: string | null };
  profile: null | {
    distributorCode: string | null;
    distributionTariffCode: string | null;
    phases: number | null;
    mainFuseA: number | null;
    buyPricingMode: string | null;
    sellPricingMode: string | null;
    currentSupplierName: string | null;
    currentProductName: string | null;
    monthlySupplierFeeCzk: number | null;
    fixedBuyPriceCzkKwh: number | null;
    fixedSellPriceCzkKwh: number | null;
    spotBuyFeeCzkKwh: number | null;
    spotSellFeeCzkKwh: number | null;
    fixedPriceValidUntil: string | null;
    hdoStatus: string | null;
  };
};

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(form: FormData, name: string) {
  const value = text(form, name);
  if (value == null) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function EnergyInvoiceReviewForm({ row }: { row: Row }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const profile = row.profile;
  const ai = row.aiDraft?.values ?? {};
  const proposed = (
    field: string,
    fallback: string | number | null | undefined,
  ): string | number | null | undefined =>
    ai[field] == null ? fallback : (ai[field] as string | number);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const validUntil = text(form, "fixedPriceValidUntil");
    const response = await fetch(`/api/admin/energy-invoices/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: text(form, "status"),
        notes: text(form, "notes"),
        documentId: text(form, "documentId"),
        billingPeriodFrom: text(form, "billingPeriodFrom"),
        billingPeriodTo: text(form, "billingPeriodTo"),
        extracted: {
          ean: text(form, "ean"),
          address: text(form, "address"),
          distributorCode: text(form, "distributorCode"),
          distributionTariffCode: text(form, "distributionTariffCode"),
          phases: number(form, "phases"),
          mainFuseA: number(form, "mainFuseA"),
          buyPricingMode: text(form, "buyPricingMode"),
          sellPricingMode: text(form, "sellPricingMode"),
          currentSupplierName: text(form, "currentSupplierName"),
          currentProductName: text(form, "currentProductName"),
          monthlySupplierFeeCzk: number(form, "monthlySupplierFeeCzk"),
          fixedBuyPriceCzkKwh: number(form, "fixedBuyPriceCzkKwh"),
          fixedSellPriceCzkKwh: number(form, "fixedSellPriceCzkKwh"),
          spotBuyFeeCzkKwh: number(form, "spotBuyFeeCzkKwh"),
          spotSellFeeCzkKwh: number(form, "spotSellFeeCzkKwh"),
          fixedPriceValidUntil: validUntil
            ? new Date(`${validUntil}T12:00:00Z`).toISOString()
            : null,
          hdoStatus: text(form, "hdoStatus"),
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok)
      setMessage(
        body.error === "INVALID_INPUT"
          ? "Zkontrolujte formát zadaných hodnot."
          : "Zpracování se nepodařilo uložit.",
      );
    else {
      setMessage("Zpracování bylo uložené a dotčené analýzy byly zneplatněné.");
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <form
      onSubmit={submit}
      className="mt-5 space-y-4 border-t border-slate-100 pt-5"
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Citlivé dokumenty · poslední vytěžení{" "}
          {row.latestExtractionVersion
            ? `v${row.latestExtractionVersion}`
            : "zatím žádné"}
        </p>
        {row.documents.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">
              Zpracovávaný dokument
              <select
                name="documentId"
                className="app-input mt-1.5"
                defaultValue={row.documents[0]?.id || ""}
              >
                <option value="">Bez souboru (přišlo e-mailem)</option>
                {row.documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.originalFileName}
                  </option>
                ))}
              </select>
            </label>
            <Field
              name="billingPeriodFrom"
              label="Období od"
              value={row.documents[0]?.billingPeriodFrom?.slice(0, 10)}
              type="date"
            />
            <Field
              name="billingPeriodTo"
              label="Období do"
              value={row.documents[0]?.billingPeriodTo?.slice(0, 10)}
              type="date"
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Soubor nebyl nahrán; údaje lze přepsat z faktury přijaté e-mailem.
          </p>
        )}
        {row.documents.length ? (
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {row.documents.map((document) => (
              <li key={document.id}>
                <a
                  className="font-semibold text-brand-700 hover:underline"
                  href={`/api/app/energy/invoice-documents/${document.id}`}
                >
                  {document.originalFileName}
                </a>{" "}
                ·{" "}
                {(document.sizeBytes / 1024).toLocaleString("cs-CZ", {
                  maximumFractionDigits: 0,
                })}{" "}
                kB · {document.extractionVersion || "nevytěženo"} · retence do{" "}
                {new Date(document.retainedUntil).toLocaleDateString("cs-CZ")}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {row.aiDraft && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-xs leading-5 text-violet-950">
          <p className="font-semibold">
            AI návrh – vždy porovnejte s originálem
          </p>
          <p>
            Automatický parser nic nezapsal do profilu. Níže pouze předvyplnil
            návrhy; změna nastane až po vašem ručním uložení.
          </p>
          {row.aiDraft.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {row.aiDraft.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer font-semibold">
              Důkazy a jistota polí
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans">
              {JSON.stringify(row.aiDraft.fieldEvidence, null, 2)}
            </pre>
          </details>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field name="ean" label="EAN" value={proposed("ean", row.site.ean)} />
        <Field
          name="address"
          label="Adresa"
          value={proposed("address", row.site.address)}
        />
        <Field
          name="distributorCode"
          label="Distributor"
          value={proposed("distributorCode", profile?.distributorCode)}
        />
        <Field
          name="distributionTariffCode"
          label="Distribuční sazba"
          value={proposed(
            "distributionTariffCode",
            profile?.distributionTariffCode,
          )}
        />
        <Field
          name="phases"
          label="Počet fází"
          value={proposed("phases", profile?.phases)}
          type="number"
        />
        <Field
          name="mainFuseA"
          label="Hlavní jistič (A)"
          value={proposed("mainFuseA", profile?.mainFuseA)}
          type="number"
        />
        <Select
          name="buyPricingMode"
          label="Nákup"
          value={String(
            proposed("buyPricingMode", profile?.buyPricingMode) ?? "",
          )}
          options={["", "FIX", "SPOT", "OTHER"]}
        />
        <Select
          name="sellPricingMode"
          label="Výkup"
          value={String(
            proposed("sellPricingMode", profile?.sellPricingMode) ?? "",
          )}
          options={["", "FIX", "SPOT", "OTHER"]}
        />
        <Field
          name="currentSupplierName"
          label="Dodavatel"
          value={proposed("currentSupplierName", profile?.currentSupplierName)}
        />
        <Field
          name="currentProductName"
          label="Produkt"
          value={proposed("currentProductName", profile?.currentProductName)}
        />
        <Field
          name="monthlySupplierFeeCzk"
          label="Stálý plat dodavateli vč. DPH (Kč/měsíc)"
          value={proposed(
            "monthlySupplierFeeCzk",
            profile?.monthlySupplierFeeCzk,
          )}
          type="number"
        />
        <Field
          name="fixedBuyPriceCzkKwh"
          label="Fix nákup (Kč/kWh)"
          value={proposed("fixedBuyPriceCzkKwh", profile?.fixedBuyPriceCzkKwh)}
          type="number"
        />
        <Field
          name="fixedSellPriceCzkKwh"
          label="Fix výkup (Kč/kWh)"
          value={proposed(
            "fixedSellPriceCzkKwh",
            profile?.fixedSellPriceCzkKwh,
          )}
          type="number"
        />
        <Field
          name="spotBuyFeeCzkKwh"
          label="Spot přirážka nákup"
          value={proposed("spotBuyFeeCzkKwh", profile?.spotBuyFeeCzkKwh)}
          type="number"
        />
        <Field
          name="spotSellFeeCzkKwh"
          label="Spot poplatek výkup"
          value={proposed("spotSellFeeCzkKwh", profile?.spotSellFeeCzkKwh)}
          type="number"
        />
        <Field
          name="fixedPriceValidUntil"
          label="Fix platí do"
          value={String(
            proposed(
              "fixedPriceValidUntil",
              profile?.fixedPriceValidUntil?.slice(0, 10),
            ) ?? "",
          ).slice(0, 10)}
          type="date"
        />
        <Select
          name="hdoStatus"
          label="HDO"
          value={String(proposed("hdoStatus", profile?.hdoStatus ?? "MISSING"))}
          options={["MISSING", "MODELED", "USER_CONFIRMED", "EXACT"]}
        />
        <Select
          name="status"
          label="Stav zpracování"
          value={row.status}
          options={[
            "RECEIVED",
            "PROCESSING",
            "NEEDS_INPUT",
            "CONFIRMED",
            "CANCELED",
          ]}
        />
      </div>
      <label className="block text-xs font-medium text-slate-600">
        Interní poznámka
        <textarea
          name="notes"
          defaultValue={row.notes ?? ""}
          rows={3}
          className="app-input mt-1.5"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-amber-800">
          Potvrzením se údaje uloží se zdrojem „faktura“. Uživatel je musí znovu
          potvrdit před analýzou a řízením.
        </p>
        <button type="submit" disabled={busy} className="app-button">
          {busy ? "Ukládám…" : "Uložit zpracování"}
        </button>
      </div>
      {message && (
        <p role="status" className="text-sm text-slate-700">
          {message}
        </p>
      )}
    </form>
  );
}

function Field({
  name,
  label,
  value,
  type = "text",
}: {
  name: string;
  label: string;
  value?: string | number | null;
  type?: string;
}) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <input
        name={name}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={value ?? ""}
        className="app-input mt-1.5"
      />
    </label>
  );
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string | null;
  options: string[];
}) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="app-input mt-1.5"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option || "Nevíme"}
          </option>
        ))}
      </select>
    </label>
  );
}
