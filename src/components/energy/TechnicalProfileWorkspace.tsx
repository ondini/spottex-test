"use client";

import { BarChart3, CheckCircle2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { InvoiceProcessingPanel, type InvoiceRequestView } from "@/components/energy/InvoiceProcessingPanel";

type Source = "SOLAX" | "LEGACY_API" | "EAN_LOOKUP" | "INVOICE" | "USER" | "CATALOG" | "MODEL" | "ADMIN";
type Evidence = Record<string, { source: Source; observedAt: string; confirmedAt: string | null }>;
type ProfileValues = {
  ean: string | null;
  address: string | null;
  distributorCode: string | null;
  distributionTariffCode: string | null;
  phases: number | null;
  mainFuseA: number | null;
  maxGridInputKw: number | null;
  maxGridOutputKw: number | null;
  exportAllowed: boolean | null;
  pvCapacityKwp: number | null;
  batteryCapacityKwh: number | null;
  batteryMaxChargeKw: number | null;
  batteryMaxDischargeKw: number | null;
  batteryMinSocPct: number | null;
  batteryMaxSocPct: number | null;
  batteryRoundtripEfficiencyPct: number | null;
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
type HistoryImport = { id: string; status: string; requestedFrom: string; requestedTo: string; totalChunks: number; succeededChunks: number; failedChunks: number; importedPoints: number; lastError: string | null };
type PvArray = {
  id?: number;
  name: string;
  panelCount: number | null;
  panelRatedWp: number | null;
  nominalDcCapacityKwp: number | null;
  active: boolean;
  source?: Source;
  observedAt?: string;
  confirmedAt?: string | null;
};
type ControlledAppliance = {
  id?: number;
  name: string;
  type: "HEAT_PUMP" | "WATER_HEATER" | "EV_CHARGER" | "HVAC" | "POOL" | "OTHER";
  status: "DECLARED" | "READY" | "CONNECTED" | "DISABLED";
  ratedPowerKw: number | null;
  controllable: boolean;
  minRuntimeMinutes: number | null;
  maxRuntimeMinutes: number | null;
  source?: Source;
};
type SiteProfile = {
  site: { id: number; name: string; provider: string; status: string };
  values: ProfileValues;
  evidence: Evidence;
  readiness: {
    analysisReady: boolean;
    controlReady: boolean;
    analysisMissing: string[];
    analysisAssumptions: string[];
    controlMissing: string[];
  };
  confirmations: { analysisAt: string | null; controlAt: string | null };
  invoiceRequest: InvoiceRequestView | null;
  historyImport: HistoryImport | null;
  pvArrays: PvArray[];
  controlledAppliances: ControlledAppliance[];
  warning: string | null;
};
type Workspace = {
  sites: Array<{ id: number; name: string; status: string }>;
  selectedSiteId: number;
  profile: SiteProfile;
};

const sourceLabels: Record<Source, string> = {
  SOLAX: "SolaX Cloud",
  LEGACY_API: "původní systém",
  EAN_LOOKUP: "podle EAN",
  INVOICE: "z faktury",
  USER: "potvrzeno vámi",
  CATALOG: "ceník",
  MODEL: "modelový předpoklad",
  ADMIN: "ověřeno Spottexem",
};

const fieldLabels: Record<string, string> = {
  pvCapacityKwp: "výkon FVE",
  distributorCode: "distributor",
  distributionTariffCode: "distribuční sazba",
  mainFuseA: "hlavní jistič",
  buyPricingMode: "nákupní produkt",
  sellPricingMode: "výkupní produkt",
  maxGridInputKw: "maximální odběr",
  maxGridOutputKw: "maximální přetok",
  batteryCapacityKwh: "kapacita baterie",
  batteryMaxChargeKw: "maximální nabíjení",
  batteryMaxDischargeKw: "maximální vybíjení",
  batteryMinSocPct: "minimální SoC",
  batteryMaxSocPct: "maximální SoC",
  exportAllowed: "povolení přetoků",
};

function numberValue(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formPayload(form: FormData) {
  return {
    ean: textValue(form.get("ean")),
    address: textValue(form.get("address")),
    distributorCode: textValue(form.get("distributorCode")),
    distributionTariffCode: textValue(form.get("distributionTariffCode")),
    phases: numberValue(form.get("phases")),
    mainFuseA: numberValue(form.get("mainFuseA")),
    maxGridInputKw: numberValue(form.get("maxGridInputKw")),
    maxGridOutputKw: numberValue(form.get("maxGridOutputKw")),
    exportAllowed: form.get("exportAllowed") === "" ? null : form.get("exportAllowed") === "true",
    pvCapacityKwp: numberValue(form.get("pvCapacityKwp")),
    batteryCapacityKwh: numberValue(form.get("batteryCapacityKwh")),
    batteryMaxChargeKw: numberValue(form.get("batteryMaxChargeKw")),
    batteryMaxDischargeKw: numberValue(form.get("batteryMaxDischargeKw")),
    batteryMinSocPct: numberValue(form.get("batteryMinSocPct")),
    batteryMaxSocPct: numberValue(form.get("batteryMaxSocPct")),
    batteryRoundtripEfficiencyPct: numberValue(form.get("batteryRoundtripEfficiencyPct")),
    buyPricingMode: textValue(form.get("buyPricingMode")),
    sellPricingMode: textValue(form.get("sellPricingMode")),
    currentSupplierName: textValue(form.get("currentSupplierName")),
    currentProductName: textValue(form.get("currentProductName")),
    monthlySupplierFeeCzk: numberValue(form.get("monthlySupplierFeeCzk")),
    fixedBuyPriceCzkKwh: numberValue(form.get("fixedBuyPriceCzkKwh")),
    fixedSellPriceCzkKwh: numberValue(form.get("fixedSellPriceCzkKwh")),
    spotBuyFeeCzkKwh: numberValue(form.get("spotBuyFeeCzkKwh")),
    spotSellFeeCzkKwh: numberValue(form.get("spotSellFeeCzkKwh")),
    fixedPriceValidUntil: textValue(form.get("fixedPriceValidUntil"))
      ? new Date(String(form.get("fixedPriceValidUntil"))).toISOString()
      : null,
    hdoStatus: textValue(form.get("hdoStatus")),
  };
}

export function TechnicalProfileWorkspace({ initialWorkspace }: { initialWorkspace: Workspace }) {
  const searchParams = useSearchParams();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSequenceRef = useRef(0);
  const profile = workspace.profile;
  const values = profile.values;
  const requestedForControl = searchParams.get("intent") === "control";
  const requestedForTariff = searchParams.get("intent") === "tariff";

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  async function saveProfile(form: HTMLFormElement) {
    const sequence = ++saveSequenceRef.current;
    setPending(true);
    try {
      const response = await fetch(`/api/app/energy/sites/${profile.site.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formPayload(new FormData(form)),
          confirmForAnalysis: false,
          confirmForControl: false,
        }),
      });
      const payload = await response.json() as { profile?: SiteProfile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Údaje se nepodařilo uložit.");
      if (sequence === saveSequenceRef.current) {
        setWorkspace((current) => ({ ...current, profile: payload.profile! }));
        setMessage("Uloženo automaticky.");
      }
    } catch (error) {
      if (sequence === saveSequenceRef.current) {
        setMessage(error instanceof Error ? error.message : "Údaje se nepodařilo uložit.");
      }
    } finally {
      if (sequence === saveSequenceRef.current) setPending(false);
    }
  }

  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setMessage("Ukládám změny…");
    saveTimerRef.current = setTimeout(() => {
      if (formRef.current) void saveProfile(formRef.current);
    }, 800);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void saveProfile(event.currentTarget);
  }

  async function refreshProfile() {
    const response = await fetch(`/api/app/energy/sites/${profile.site.id}/profile`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { workspace?: Workspace; error?: string };
    if (!response.ok || !payload.workspace) throw new Error(payload.error || "Profil se nepodařilo znovu načíst.");
    setWorkspace(payload.workspace);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moje elektrárna"
        description="Údaje odběrného místa, současných cen, fotovoltaiky a baterie."
        action={
          <Link
            href={`/app/analyza?siteId=${profile.site.id}&data=1`}
            className="app-button app-button-secondary"
          >
            <BarChart3 className="size-4" />
            Prohlédnout historická data
          </Link>
        }
      />

      {profile.warning && <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{profile.warning}</p>}
      {message && (
        <div role="status" className="flex items-center gap-2 text-sm text-slate-600">
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4 text-brand-600" />}
          <p>{message}</p>
        </div>
      )}

      {(requestedForControl && profile.readiness.controlMissing.length > 0) || requestedForTariff ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {requestedForTariff
            ? "Pro výpočet podle vašeho tarifu potřebujeme skutečné ceny. Nahrajte fakturu a připravené údaje před uložením zkontrolujte."
            : `Pro přesný výpočet a nastavení řízení doplníme: ${profile.readiness.controlMissing.map((field) => fieldLabels[field] || field).join(", ")}.`}
        </p>
      ) : null}

      <InvoiceProcessingPanel
        siteId={profile.site.id}
        initialRequest={profile.invoiceRequest}
        onProfileSaved={refreshProfile}
      />

      <form
        ref={formRef}
        key={profile.site.id}
        onSubmit={submit}
        onChange={scheduleSave}
        className="space-y-6"
      >
        <ProfileSection title="Odběrné místo" description="Údaje ze smlouvy, faktury nebo distributora.">
          <TextField name="ean" label="EAN" value={values.ean} evidence={profile.evidence.ean} />
          <TextField name="address" label="Adresa odběrného místa" value={values.address} evidence={profile.evidence.address} wide />
          <TextField name="distributorCode" label="Distributor" value={values.distributorCode} evidence={profile.evidence.distributorCode} placeholder="např. CEZ_DISTRIBUCE" />
          <TextField name="distributionTariffCode" label="Distribuční sazba" value={values.distributionTariffCode} evidence={profile.evidence.distributionTariffCode} placeholder="např. D25d" />
          <NumberField name="phases" label="Počet fází" value={values.phases} evidence={profile.evidence.phases} step="1" />
          <NumberField name="mainFuseA" label="Hlavní jistič" value={values.mainFuseA} evidence={profile.evidence.mainFuseA} unit="A" />
          <NumberField name="maxGridInputKw" label="Maximální odběr ze sítě" value={values.maxGridInputKw} evidence={profile.evidence.maxGridInputKw} unit="kW" />
          <NumberField name="maxGridOutputKw" label="Maximální přetok" value={values.maxGridOutputKw} evidence={profile.evidence.maxGridOutputKw} unit="kW" />
          <SelectField name="exportAllowed" label="Přetoky do sítě" value={values.exportAllowed === null ? "" : String(values.exportAllowed)} evidence={profile.evidence.exportAllowed} options={[['', 'Nevíme'], ['true', 'Povolené'], ['false', 'Zakázané']]} />
          <SelectField name="hdoStatus" label="Časy HDO" value={values.hdoStatus || "MISSING"} evidence={profile.evidence.hdoStatus} options={[["MISSING", "Nejsou známé"], ["MODELED", "Modelový odhad"], ["USER_CONFIRMED", "Potvrzené uživatelem"], ["EXACT", "Přesně načtené"]]} />
        </ProfileSection>

        <ProfileSection title="Současné ceny" description="Pokud ceny neznáte, analýza použije označený veřejný ceník. Změna cen znovu spustí chytrou optimalizaci.">
          <TextField name="currentSupplierName" label="Současný dodavatel" value={values.currentSupplierName} evidence={profile.evidence.currentSupplierName} />
          <TextField name="currentProductName" label="Název produktu" value={values.currentProductName} evidence={profile.evidence.currentProductName} />
          <SelectField name="buyPricingMode" label="Nákup elektřiny" value={values.buyPricingMode || ""} evidence={profile.evidence.buyPricingMode} options={[["", "Nevíme"], ["FIX", "FIX"], ["SPOT", "SPOT"], ["OTHER", "Jiný produkt"]]} />
          <SelectField name="sellPricingMode" label="Výkup elektřiny" value={values.sellPricingMode || ""} evidence={profile.evidence.sellPricingMode} options={[["", "Nevíme"], ["FIX", "FIX"], ["SPOT", "SPOT"], ["OTHER", "Jiný produkt"]]} />
          <NumberField name="monthlySupplierFeeCzk" label="Stálý plat dodavateli vč. DPH" value={values.monthlySupplierFeeCzk} evidence={profile.evidence.monthlySupplierFeeCzk} unit="Kč/měsíc" />
          <NumberField name="fixedBuyPriceCzkKwh" label="Fixní cena silové elektřiny vč. DPH" value={values.fixedBuyPriceCzkKwh} evidence={profile.evidence.fixedBuyPriceCzkKwh} unit="Kč/kWh" />
          <NumberField name="fixedSellPriceCzkKwh" label="Fixní výkupní cena vč. DPH" value={values.fixedSellPriceCzkKwh} evidence={profile.evidence.fixedSellPriceCzkKwh} unit="Kč/kWh" />
          <NumberField name="spotBuyFeeCzkKwh" label="Poplatek za spotový nákup" value={values.spotBuyFeeCzkKwh} evidence={profile.evidence.spotBuyFeeCzkKwh} unit="Kč/kWh" />
          <NumberField name="spotSellFeeCzkKwh" label="Poplatek za spotový výkup" value={values.spotSellFeeCzkKwh} evidence={profile.evidence.spotSellFeeCzkKwh} unit="Kč/kWh" />
          <TextField name="fixedPriceValidUntil" type="date" label="Fixní cena platí do" value={values.fixedPriceValidUntil?.slice(0, 10) ?? null} evidence={profile.evidence.fixedPriceValidUntil} />
        </ProfileSection>

        <ProfileSection title="FVE a baterie" description="Technické limity načtené ze střídače; modelové hodnoty můžete zpřesnit. Maximální přetok nepřebíráme z faktury.">
          <NumberField name="pvCapacityKwp" label="Instalovaný výkon FVE" value={values.pvCapacityKwp} evidence={profile.evidence.pvCapacityKwp} unit="kWp" />
          <NumberField name="batteryCapacityKwh" label="Kapacita baterie" value={values.batteryCapacityKwh} evidence={profile.evidence.batteryCapacityKwh} unit="kWh" />
          <NumberField name="batteryMaxChargeKw" label="Maximální nabíjecí výkon" value={values.batteryMaxChargeKw} evidence={profile.evidence.batteryMaxChargeKw} unit="kW" />
          <NumberField name="batteryMaxDischargeKw" label="Maximální vybíjecí výkon" value={values.batteryMaxDischargeKw} evidence={profile.evidence.batteryMaxDischargeKw} unit="kW" />
          <NumberField name="batteryMinSocPct" label="Minimální SoC" value={values.batteryMinSocPct} evidence={profile.evidence.batteryMinSocPct} unit="%" />
          <NumberField name="batteryMaxSocPct" label="Maximální SoC" value={values.batteryMaxSocPct} evidence={profile.evidence.batteryMaxSocPct} unit="%" />
          <NumberField name="batteryRoundtripEfficiencyPct" label="Účinnost cyklu" value={values.batteryRoundtripEfficiencyPct} evidence={profile.evidence.batteryRoundtripEfficiencyPct} unit="%" />
        </ProfileSection>
      </form>
    </div>
  );
}

function ProfileSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="app-card p-5 sm:p-6"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div></section>;
}

function EvidenceHint({ evidence }: { evidence?: Evidence[string] }) {
  if (!evidence) return <span className="text-[11px] text-amber-600">nezadaný údaj</span>;
  return <span className="text-[11px] text-slate-400">Zdroj: {sourceLabels[evidence.source]}{evidence.confirmedAt ? " · potvrzeno" : ""}</span>;
}

function TextField({ name, label, value, evidence, placeholder, wide = false, type = "text" }: { name: string; label: string; value: string | null; evidence?: Evidence[string]; placeholder?: string; wide?: boolean; type?: string }) {
  return <label className={`text-sm font-medium text-slate-700 ${wide ? "sm:col-span-2" : ""}`}>{label}<input className="app-input mt-1.5" type={type} name={name} defaultValue={value ?? ""} placeholder={placeholder} /><EvidenceHint evidence={evidence} /></label>;
}

function NumberField({ name, label, value, evidence, unit, step = "0.01" }: { name: string; label: string; value: number | null; evidence?: Evidence[string]; unit?: string; step?: string }) {
  return <label className="text-sm font-medium text-slate-700">{label}<span className="relative mt-1.5 block"><input className="app-input pr-20" inputMode="decimal" type="number" step={step} name={name} defaultValue={value ?? ""} />{unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">{unit}</span>}</span><EvidenceHint evidence={evidence} /></label>;
}

function SelectField({ name, label, value, evidence, options }: { name: string; label: string; value: string; evidence?: Evidence[string]; options: Array<[string, string]> }) {
  return <label className="text-sm font-medium text-slate-700">{label}<select className="app-input mt-1.5" name={name} defaultValue={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select><EvidenceHint evidence={evidence} /></label>;
}
