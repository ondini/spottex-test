"use client";

import { BarChart3, Building2, CalendarDays, CheckCircle2, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";

export type SiteSettingsRecord = {
  id: number;
  metaPixelId: string | null;
  metaPixelEnabled: boolean;
  analyticsEnabled: boolean;
  consultationLead: string | null;
  contactEmail: string | null;
  sellerCompanyName: string;
  sellerCompanyId: string | null;
  sellerVatId: string | null;
  sellerAddress: string | null;
};

type EditableSettings = Omit<SiteSettingsRecord, "id">;

function optional(value: string) {
  return value.trim() || null;
}

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs font-normal text-slate-400">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function SectionHeading({ icon: Icon, title, description }: { icon: typeof BarChart3; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="size-5" /></span>
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

export default function SiteSettingsForm({ initialSettings }: { initialSettings: SiteSettingsRecord }) {
  const [settings, setSettings] = useState<EditableSettings>({
    metaPixelId: initialSettings.metaPixelId,
    metaPixelEnabled: initialSettings.metaPixelEnabled,
    analyticsEnabled: initialSettings.analyticsEnabled,
    consultationLead: initialSettings.consultationLead,
    contactEmail: initialSettings.contactEmail,
    sellerCompanyName: initialSettings.sellerCompanyName,
    sellerCompanyId: initialSettings.sellerCompanyId,
    sellerVatId: initialSettings.sellerVatId,
    sellerAddress: initialSettings.sellerAddress,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function update<K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (settings.metaPixelEnabled && !settings.metaPixelId?.trim()) {
      setMessage({ tone: "error", text: "Pro aktivaci Meta Pixelu nejprve vyplňte Pixel ID." });
      return;
    }

    setBusy(true);
    try {
      const payload = {
        metaPixelId: optional(settings.metaPixelId || ""),
        metaPixelEnabled: settings.metaPixelEnabled,
        analyticsEnabled: settings.analyticsEnabled,
        consultationLead: optional(settings.consultationLead || ""),
        contactEmail: optional(settings.contactEmail || ""),
        sellerCompanyName: settings.sellerCompanyName.trim(),
        sellerCompanyId: optional(settings.sellerCompanyId || ""),
        sellerVatId: optional(settings.sellerVatId || ""),
        sellerAddress: optional(settings.sellerAddress || ""),
      };
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as { settings?: SiteSettingsRecord; error?: string } | null;
      if (!response.ok || !data?.settings) {
        throw new Error(response.status === 400 ? "Zkontrolujte zadané e-mailové adresy a firemní údaje." : data?.error || "Nastavení se nepodařilo uložit.");
      }
      setSettings({
        metaPixelId: data.settings.metaPixelId,
        metaPixelEnabled: data.settings.metaPixelEnabled,
        analyticsEnabled: data.settings.analyticsEnabled,
        consultationLead: data.settings.consultationLead,
        contactEmail: data.settings.contactEmail,
        sellerCompanyName: data.settings.sellerCompanyName,
        sellerCompanyId: data.settings.sellerCompanyId,
        sellerVatId: data.settings.sellerVatId,
        sellerAddress: data.settings.sellerAddress,
      });
      setMessage({ tone: "success", text: "Nastavení webu bylo uloženo." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Nastavení se nepodařilo uložit." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      {message && (
        <div role="status" className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${message.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.tone === "success" && <CheckCircle2 className="size-4" />} {message.text}
        </div>
      )}

      <section className="app-card overflow-hidden">
        <SectionHeading icon={BarChart3} title="Analytika a Meta Pixel" description="Nastavte interní měření a připravte marketingové kampaně. Pixel se načte pouze po udělení marketingového souhlasu." />
        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <input type="checkbox" checked={settings.analyticsEnabled} onChange={(event) => update("analyticsEnabled", event.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Interní Spottex metriky</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Sběr anonymizovaných page view a aplikačních událostí po souhlasu.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <input type="checkbox" checked={settings.metaPixelEnabled} onChange={(event) => update("metaPixelEnabled", event.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Meta Pixel</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">Marketingové měření návštěv a konverzí se souhlasem návštěvníka.</span>
            </span>
          </label>
          <Field label="Meta Pixel ID" hint="pouze číselné ID" className="sm:col-span-2">
            <input value={settings.metaPixelId || ""} onChange={(event) => update("metaPixelId", event.target.value)} className="app-input font-mono" inputMode="numeric" maxLength={40} placeholder="123456789012345" />
          </Field>
          <div className="flex gap-3 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-5 text-blue-800 sm:col-span-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>Meta Pixel se nespouští automaticky. Veřejný web jej aktivuje až poté, co návštěvník povolí marketingové cookies.</p>
          </div>
        </div>
      </section>

      <section className="app-card overflow-hidden">
        <SectionHeading icon={CalendarDays} title="Veřejný web a konzultace" description="Kontaktní údaje a doprovodný text používaný v rezervačním procesu." />
        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <Field label="Kontaktní e-mail">
            <input value={settings.contactEmail || ""} onChange={(event) => update("contactEmail", event.target.value)} className="app-input" type="email" placeholder="info@spottex.cz" />
          </Field>
          <div className="hidden sm:block" />
          <Field label="Úvodní text konzultací" hint="max. 1 000 znaků" className="sm:col-span-2">
            <textarea value={settings.consultationLead || ""} onChange={(event) => update("consultationLead", event.target.value)} className="app-input min-h-28 resize-y" maxLength={1000} placeholder="Na nezávazné konzultaci společně projdeme…" />
          </Field>
        </div>
      </section>

      <section className="app-card overflow-hidden">
        <SectionHeading icon={Building2} title="Údaje provozovatele" description="Firemní údaje používané na webu a připravené pro obchodní dokumenty." />
        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <Field label="Název společnosti" className="sm:col-span-2">
            <input value={settings.sellerCompanyName} onChange={(event) => update("sellerCompanyName", event.target.value)} className="app-input" required minLength={2} maxLength={200} />
          </Field>
          <Field label="IČO">
            <input value={settings.sellerCompanyId || ""} onChange={(event) => update("sellerCompanyId", event.target.value)} className="app-input" maxLength={30} />
          </Field>
          <Field label="DIČ">
            <input value={settings.sellerVatId || ""} onChange={(event) => update("sellerVatId", event.target.value)} className="app-input" maxLength={30} />
          </Field>
          <Field label="Sídlo společnosti" className="sm:col-span-2">
            <textarea value={settings.sellerAddress || ""} onChange={(event) => update("sellerAddress", event.target.value)} className="app-input min-h-20 resize-y" maxLength={500} />
          </Field>
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex justify-end rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg shadow-slate-900/10 backdrop-blur">
        <button type="submit" disabled={busy} className="app-button min-w-40 disabled:cursor-wait disabled:opacity-60"><Save className="size-4" /> {busy ? "Ukládám…" : "Uložit nastavení"}</button>
      </div>
    </form>
  );
}
