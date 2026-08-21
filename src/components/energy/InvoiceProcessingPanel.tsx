"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileUp,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type InvoiceValue = string | number | null;
type InvoiceDocumentState = "QUEUED" | "PARSING" | "READY" | "FAILED" | "SAVED";

type InvoiceDraft = {
  schemaVersion: string;
  billingPeriodFrom: string | null;
  billingPeriodTo: string | null;
  values: Record<string, InvoiceValue>;
  fieldEvidence: Array<{ field: string; confidence: string; evidence: string }>;
  warnings: string[];
};

export type InvoiceRequestView = {
  referenceCode: string;
  contactEmail: string;
  status: string;
  createdAt: string;
  maxDocuments: number;
  documents: Array<{
    id: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    retainedUntil: string;
    createdAt: string;
    state: InvoiceDocumentState;
    draft: InvoiceDraft | null;
  }>;
  combined: {
    values: Record<string, InvoiceValue>;
    fieldEvidence: Array<{
      field: string;
      confidence: string;
      evidence: string;
      documentId: string;
      documentName: string;
    }>;
    warnings: string[];
    conflicts: string[];
    sourceDocumentIds: string[];
  };
};

type Activity = {
  stage: "UPLOADING" | "PARSING" | "COMPLETE" | "ERROR";
  percent: number;
  text: string;
};

const fieldLabels: Record<string, string> = {
  ean: "EAN odběrného místa",
  address: "Adresa odběrného místa",
  distributorCode: "Distributor",
  distributionTariffCode: "Distribuční sazba",
  phases: "Počet fází",
  mainFuseA: "Hlavní jistič (A)",
  buyPricingMode: "Způsob nákupu",
  sellPricingMode: "Způsob výkupu",
  currentSupplierName: "Současný dodavatel",
  currentProductName: "Název produktu",
  monthlySupplierFeeCzk: "Stálý plat vč. DPH (Kč/měsíc)",
  fixedBuyPriceCzkKwh: "Cena silové elektřiny vč. DPH (Kč/kWh)",
  fixedSellPriceCzkKwh: "Výkupní cena vč. DPH (Kč/kWh)",
  spotBuyFeeCzkKwh: "Přirážka za spotový nákup (Kč/kWh)",
  spotSellFeeCzkKwh: "Poplatek za spotový výkup (Kč/kWh)",
  fixedPriceValidUntil: "Fixní cena platí do",
  hdoStatus: "Časy HDO",
};

const stateLabels: Record<InvoiceDocumentState, string> = {
  QUEUED: "Čeká na zpracování",
  PARSING: "Vytěžujeme údaje",
  READY: "Připraveno ke kontrole",
  FAILED: "Automatické vytěžení se nepodařilo",
  SAVED: "Uloženo do odběrného místa",
};

function errorLabel(code: string | undefined) {
  const labels: Record<string, string> = {
    DOCUMENT_TOO_LARGE: "Jedna faktura může mít nejvýše 10 MB.",
    UNSUPPORTED_DOCUMENT: "Nahrajte PDF, JPG nebo PNG fakturu.",
    DOCUMENT_TYPE_MISMATCH: "Přípona souboru neodpovídá jeho skutečnému typu.",
    DUPLICATE_DOCUMENT: "Tuto fakturu už u odběrného místa evidujeme.",
    DOCUMENT_LIMIT_REACHED: "K jednomu zpracování lze přidat nejvýše tři faktury.",
    RATE_LIMITED: "Požadavků je příliš mnoho. Chvíli počkejte a zkuste to znovu.",
  };
  return labels[code ?? ""] ?? "Fakturu se nepodařilo bezpečně uložit.";
}

function uploadDocument(
  siteId: number,
  file: File,
  onProgress: (ratio: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/app/energy/sites/${siteId}/invoice-document`);
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      const payload = (xhr.response ?? {}) as { error?: string };
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(errorLabel(payload.error)));
    });
    xhr.addEventListener("error", () => reject(new Error("Síťové spojení při nahrávání selhalo.")));
    const form = new FormData();
    form.set("file", file);
    xhr.send(form);
  });
}

export function InvoiceProcessingPanel({
  siteId,
  initialRequest,
  onProfileSaved,
}: {
  siteId: number;
  initialRequest: InvoiceRequestView | null;
  onProfileSaved: () => Promise<void>;
}) {
  const [invoice, setInvoice] = useState(initialRequest);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const openedSignature = useRef<string | null>(null);

  useEffect(() => setInvoice(initialRequest), [initialRequest]);

  const refreshInvoice = useCallback(async () => {
    const response = await fetch(`/api/app/energy/sites/${siteId}/invoice-review`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as {
      invoiceRequest?: InvoiceRequestView | null;
      error?: string;
    };
    if (!response.ok || !("invoiceRequest" in payload)) {
      throw new Error(payload.error || "Stav faktury se nepodařilo načíst.");
    }
    setInvoice(payload.invoiceRequest ?? null);
    return payload.invoiceRequest ?? null;
  }, [siteId]);

  const { pendingDocuments, readyDocuments, failedDocuments } = useMemo(() => ({
    pendingDocuments: invoice?.documents.filter((document) =>
      document.state === "QUEUED" || document.state === "PARSING",
    ) ?? [],
    readyDocuments: invoice?.documents.filter((document) =>
      document.state === "READY" || document.state === "SAVED",
    ) ?? [],
    failedDocuments: invoice?.documents.filter((document) => document.state === "FAILED") ?? [],
  }), [invoice?.documents]);

  useEffect(() => {
    if (!pendingDocuments.length) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshInvoice();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [pendingDocuments.length, refreshInvoice]);

  useEffect(() => {
    if (!invoice || activity?.stage === "UPLOADING" || pendingDocuments.length || !readyDocuments.length || invoice.status === "CONFIRMED") return;
    const signature = readyDocuments.map((document) => document.id).sort().join(":");
    if (openedSignature.current === signature) return;
    openedSignature.current = signature;
    setReviewOpen(true);
  }, [activity?.stage, invoice, pendingDocuments.length, readyDocuments]);

  useEffect(() => {
    if (activity?.stage !== "PARSING" || !invoice) return;
    const total = invoice.documents.length;
    const done = total - pendingDocuments.length;
    if (pendingDocuments.length) {
      setActivity({
        stage: "PARSING",
        percent: total ? Math.round((done / total) * 100) : 0,
        text: `Vytěžujeme údaje · hotovo ${done} z ${total} faktur`,
      });
    } else if (readyDocuments.length) {
      setActivity({ stage: "COMPLETE", percent: 100, text: "Údaje jsou připravené ke kontrole." });
    } else if (failedDocuments.length) {
      setActivity({ stage: "ERROR", percent: 100, text: "Automatické vytěžení se nepodařilo. Zkuste čitelnější dokument." });
    }
  }, [activity?.stage, failedDocuments.length, invoice, pendingDocuments.length, readyDocuments.length]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    const documentsInOpenRequest = invoice?.status === "CONFIRMED" ? 0 : invoice?.documents.length ?? 0;
    const remaining = 3 - documentsInOpenRequest;
    if (selected.length > remaining) {
      setActivity({
        stage: "ERROR",
        percent: 0,
        text: `Můžete přidat ještě ${remaining} ${remaining === 1 ? "fakturu" : "faktury"}; maximum jsou tři.`,
      });
      return;
    }
    setActivity({ stage: "UPLOADING", percent: 0, text: "Nahráváme faktury bezpečně na server…" });
    try {
      const requestResponse = await fetch(`/api/app/energy/sites/${siteId}/invoice-request`, { method: "POST" });
      const requestPayload = await requestResponse.json().catch(() => ({})) as { error?: string };
      if (!requestResponse.ok) throw new Error(requestPayload.error || "Požadavek se nepodařilo vytvořit.");
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index]!;
        await uploadDocument(siteId, file, (ratio) => {
          setActivity({
            stage: "UPLOADING",
            percent: Math.round(((index + ratio) / selected.length) * 100),
            text: `Nahráváme ${file.name} · ${index + 1} z ${selected.length}`,
          });
        });
        await refreshInvoice();
      }
      setActivity({ stage: "PARSING", percent: 0, text: `Vytěžujeme údaje · hotovo 0 z ${selected.length} faktur` });
      await refreshInvoice();
    } catch (error) {
      setActivity({
        stage: "ERROR",
        percent: 0,
        text: error instanceof Error ? error.message : "Fakturu se nepodařilo uložit.",
      });
    }
  }

  const canUpload = activity?.stage !== "UPLOADING" && (invoice?.status === "CONFIRMED" || (invoice?.documents.length ?? 0) < 3);
  const shownActivity = activity ?? (pendingDocuments.length
    ? {
        stage: "PARSING" as const,
        percent: invoice?.documents.length ? Math.round(((invoice.documents.length - pendingDocuments.length) / invoice.documents.length) * 100) : 0,
        text: `Vytěžujeme údaje · hotovo ${(invoice?.documents.length ?? 0) - pendingDocuments.length} z ${invoice?.documents.length ?? 0} faktur`,
      }
    : null);

  return (
    <>
      <section id="vlastni-tarif" className="app-card scroll-mt-24 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900">Doplnit údaje z faktury</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Nahrajte jednu až tři faktury v PDF, JPG nebo PNG. Každou bezpečně uložíme, vytěžíme a společný návrh vám ukážeme před zápisem do odběrného místa.
            </p>

            {shownActivity && (
              <div className={`mt-4 rounded-2xl border p-4 ${shownActivity.stage === "ERROR" ? "border-red-200 bg-red-50" : "border-brand-200 bg-brand-50/60"}`} role="status">
                <div className="flex items-center justify-between gap-3 text-sm font-medium text-slate-800">
                  <span className="flex items-center gap-2">
                    {shownActivity.stage === "ERROR"
                      ? <AlertTriangle className="size-4 text-red-600" />
                      : shownActivity.stage === "COMPLETE"
                        ? <CheckCircle2 className="size-4 text-brand-700" />
                        : <LoaderCircle className="size-4 animate-spin text-brand-700" />}
                    {shownActivity.text}
                  </span>
                  <span>{shownActivity.percent} %</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div className={`h-full rounded-full transition-all duration-500 ${shownActivity.stage === "ERROR" ? "bg-red-500" : "bg-brand-600"}`} style={{ width: `${shownActivity.percent}%` }} />
                </div>
              </div>
            )}

            {invoice?.documents.length ? (
              <ul className="mt-4 space-y-2">
                {invoice.documents.map((document) => (
                  <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="size-4 shrink-0 text-slate-400" />
                      <a className="truncate font-medium text-brand-700 hover:underline" href={`/api/app/energy/invoice-documents/${document.id}`}>{document.originalFileName}</a>
                      <span className="shrink-0 text-xs text-slate-400">{(document.sizeBytes / 1024).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} kB</span>
                    </span>
                    <span className={`text-xs font-medium ${document.state === "FAILED" ? "text-red-700" : document.state === "READY" || document.state === "SAVED" ? "text-brand-700" : "text-amber-700"}`}>
                      {stateLabels[document.state]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {readyDocuments.length > 0 && !pendingDocuments.length && invoice?.status !== "CONFIRMED" && (
              <button type="button" className="app-button app-button-secondary mt-4" onClick={() => setReviewOpen(true)}>
                <Sparkles className="size-4" /> Zkontrolovat vytěžené údaje
              </button>
            )}
          </div>
          <label className={`app-button shrink-0 ${canUpload ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
            <FileUp className="size-4" />
            {invoice?.status === "CONFIRMED" ? "Nahrát nové faktury" : "Nahrát faktury (max. 3)"}
            <input
              className="sr-only"
              type="file"
              aria-label="Nahrát fakturu"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              disabled={!canUpload}
              onChange={(event) => void upload(event)}
            />
          </label>
        </div>
      </section>

      {reviewOpen && invoice && (
        <InvoiceReviewDialog
          invoice={invoice}
          onClose={() => setReviewOpen(false)}
          onSaved={async (updated) => {
            setInvoice(updated);
            setReviewOpen(false);
            setActivity({ stage: "COMPLETE", percent: 100, text: "Potvrzené údaje jsou uložené v odběrném místě." });
            await onProfileSaved();
          }}
          siteId={siteId}
        />
      )}
    </>
  );
}

function InvoiceReviewDialog({
  invoice,
  siteId,
  onClose,
  onSaved,
}: {
  invoice: InvoiceRequestView;
  siteId: number;
  onClose: () => void;
  onSaved: (invoice: InvoiceRequestView) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const values = invoice.combined.values;
  const populated = useMemo(() => Object.entries(values).filter(([, value]) => value != null && value !== ""), [values]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const extracted: Record<string, string | number> = {};
    for (const field of Object.keys(fieldLabels)) {
      const raw = form.get(field);
      if (typeof raw !== "string" || !raw.trim()) continue;
      if (["phases", "mainFuseA", "monthlySupplierFeeCzk", "fixedBuyPriceCzkKwh", "fixedSellPriceCzkKwh", "spotBuyFeeCzkKwh", "spotSellFeeCzkKwh"].includes(field)) {
        const number = Number(raw.replace(",", "."));
        if (Number.isFinite(number)) extracted[field] = number;
      } else if (field === "fixedPriceValidUntil") {
        extracted[field] = new Date(`${raw}T12:00:00.000Z`).toISOString();
      } else {
        extracted[field] = raw.trim();
      }
    }
    const response = await fetch(`/api/app/energy/sites/${siteId}/invoice-review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extracted, sourceDocumentIds: invoice.combined.sourceDocumentIds }),
    });
    const payload = await response.json().catch(() => ({})) as { invoiceRequest?: InvoiceRequestView; error?: string };
    if (!response.ok || !payload.invoiceRequest) {
      setMessage(payload.error === "INVALID_INPUT" ? "Zkontrolujte formát vybraných hodnot." : "Údaje se nepodařilo uložit.");
      setBusy(false);
      return;
    }
    await onSaved(payload.invoiceRequest);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="invoice-review-title">
      <div className="mx-auto my-4 w-full max-w-5xl rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Automatické vytěžení dokončeno</p>
            <h2 id="invoice-review-title" className="mt-1 text-xl font-semibold text-slate-950">Zkontrolujte údaje před uložením</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Sloučili jsme neprázdné údaje ze všech zpracovaných faktur. Hodnoty můžete opravit; do odběrného místa se zapíšou až po potvrzení.</p>
          </div>
          <button type="button" className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Zavřít kontrolu faktury" onClick={onClose}><X className="size-5" /></button>
        </div>

        {invoice.combined.conflicts.length > 0 && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Faktury se v některých údajích liší.</p>
            <p className="mt-1">Zkontrolujte: {invoice.combined.conflicts.map((field) => fieldLabels[field] ?? field).join(", ")}. Předvyplněná je hodnota z nejnovější faktury.</p>
          </div>
        )}

        <form className="mt-5" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReviewField name="ean" value={values.ean} />
            <ReviewField name="address" value={values.address} wide />
            <ReviewField name="distributorCode" value={values.distributorCode} />
            <ReviewField name="distributionTariffCode" value={values.distributionTariffCode} />
            <ReviewField name="phases" value={values.phases} type="number" />
            <ReviewField name="mainFuseA" value={values.mainFuseA} type="number" />
            <ReviewSelect name="buyPricingMode" value={values.buyPricingMode} options={[["", "Neuvedeno"], ["FIX", "Fixní cena"], ["SPOT", "Spotová cena"], ["OTHER", "Jiný produkt"]]} />
            <ReviewSelect name="sellPricingMode" value={values.sellPricingMode} options={[["", "Neuvedeno"], ["FIX", "Fixní výkup"], ["SPOT", "Spotový výkup"], ["OTHER", "Jiný produkt"]]} />
            <ReviewField name="currentSupplierName" value={values.currentSupplierName} />
            <ReviewField name="currentProductName" value={values.currentProductName} />
            <ReviewField name="monthlySupplierFeeCzk" value={values.monthlySupplierFeeCzk} type="number" />
            <ReviewField name="fixedBuyPriceCzkKwh" value={values.fixedBuyPriceCzkKwh} type="number" />
            <ReviewField name="fixedSellPriceCzkKwh" value={values.fixedSellPriceCzkKwh} type="number" />
            <ReviewField name="spotBuyFeeCzkKwh" value={values.spotBuyFeeCzkKwh} type="number" />
            <ReviewField name="spotSellFeeCzkKwh" value={values.spotSellFeeCzkKwh} type="number" />
            <ReviewField name="fixedPriceValidUntil" value={typeof values.fixedPriceValidUntil === "string" ? values.fixedPriceValidUntil.slice(0, 10) : null} type="date" />
            <ReviewSelect name="hdoStatus" value={values.hdoStatus} options={[["", "Neuvedeno"], ["MISSING", "Časy nejsou na faktuře"], ["EXACT", "Přesné časy z faktury"]]} />
          </div>

          {invoice.combined.warnings.length > 0 && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">Co parser nemohl bezpečně určit</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">{invoice.combined.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          )}

          <details className="mt-5 rounded-2xl border border-slate-200 p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-slate-800">Zobrazit zdroje a jistotu vytěžených údajů</summary>
            <ul className="mt-3 space-y-3">
              {invoice.combined.fieldEvidence.map((evidence, index) => (
                <li key={`${evidence.documentId}-${evidence.field}-${index}`} className="rounded-xl bg-slate-50 p-3">
                  <p className="font-medium text-slate-800">{fieldLabels[evidence.field] ?? evidence.field} · {evidence.confidence} · {evidence.documentName}</p>
                  <p className="mt-1 text-slate-600">{evidence.evidence}</p>
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="text-sm text-slate-500">Připraveno {populated.length} neprázdných údajů z {invoice.combined.sourceDocumentIds.length} {invoice.combined.sourceDocumentIds.length === 1 ? "faktury" : "faktur"}.</p>
            <div className="flex gap-2">
              <button type="button" className="app-button app-button-secondary" onClick={onClose}>Zrušit</button>
              <button type="submit" className="app-button" disabled={busy || !populated.length}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Uložit do odběrného místa</button>
            </div>
          </div>
          {message && <p role="status" className="mt-3 text-sm text-red-700">{message}</p>}
        </form>
      </div>
    </div>
  );
}

function ReviewField({ name, value, type = "text", wide = false }: { name: string; value: InvoiceValue | undefined; type?: string; wide?: boolean }) {
  return <label className={`text-sm font-medium text-slate-700 ${wide ? "sm:col-span-2" : ""}`}>{fieldLabels[name] ?? name}<input className="app-input mt-1.5" name={name} type={type} step={type === "number" ? "0.000001" : undefined} defaultValue={value ?? ""} /></label>;
}

function ReviewSelect({ name, value, options }: { name: string; value: InvoiceValue | undefined; options: Array<[string, string]> }) {
  return <label className="text-sm font-medium text-slate-700">{fieldLabels[name] ?? name}<select className="app-input mt-1.5" name={name} defaultValue={String(value ?? "")}>{options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}</select></label>;
}
