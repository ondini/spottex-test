"use client";

import { Building2, CheckCircle2, LoaderCircle, Mail, MapPin, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Profile = {
  email: string;
  name: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  companyName: string | null;
  companyIdNumber: string | null;
  vatId: string | null;
  createdAt: string;
};

function Field({ label, name, defaultValue, placeholder, type = "text", autoComplete }: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <input className="app-input" name={name} defaultValue={defaultValue || ""} placeholder={placeholder} type={type} autoComplete={autoComplete} />
    </label>
  );
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Profil se nepodařilo uložit.");
      setMessage({ type: "success", text: "Profil byl uložen." });
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Profil se nepodařilo uložit." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="app-card h-fit p-6 text-center">
        <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-[#09121f] text-2xl font-bold text-white">
          {(profile.name || profile.email).trim().charAt(0).toUpperCase()}
        </span>
        <h3 className="mt-4 font-semibold text-slate-900">{profile.name || "Uživatel Spottex"}</h3>
        <p className="mt-1 break-all text-sm text-slate-500">{profile.email}</p>
        <div className="mt-5 border-t border-slate-100 pt-5 text-left text-xs leading-5 text-slate-500">
          Účet vytvořen {new Intl.DateTimeFormat("cs-CZ", { dateStyle: "long" }).format(new Date(profile.createdAt))}
        </div>
      </aside>

      <form onSubmit={submit} className="space-y-6">
        <section className="app-card p-5 sm:p-6">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><UserRound className="size-5" /></span>
            <div><h3 className="font-semibold text-slate-900">Osobní údaje</h3><p className="text-sm text-slate-500">Kontaktní údaje pro váš účet.</p></div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Jméno a příjmení" name="name" defaultValue={profile.name} autoComplete="name" />
            <Field label="Telefon" name="phone" defaultValue={profile.phone} placeholder="+420 777 123 456" type="tel" autoComplete="tel" />
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-slate-700">Přihlašovací e-mail</span>
              <span className="relative block">
                <Mail className="absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-slate-400" />
                <input className="app-input bg-slate-50 pl-11 text-slate-500" value={profile.email} readOnly aria-readonly="true" />
              </span>
              <span className="mt-2 block text-xs text-slate-400">Pro změnu přihlašovacího e-mailu kontaktujte podporu.</span>
            </label>
          </div>
        </section>

        <section className="app-card p-5 sm:p-6">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-600"><MapPin className="size-5" /></span>
            <div><h3 className="font-semibold text-slate-900">Adresa</h3><p className="text-sm text-slate-500">Použije se také pro fakturační údaje.</p></div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Ulice a číslo" name="street" defaultValue={profile.street} autoComplete="street-address" /></div>
            <Field label="Město" name="city" defaultValue={profile.city} autoComplete="address-level2" />
            <Field label="PSČ" name="postalCode" defaultValue={profile.postalCode} autoComplete="postal-code" />
            <Field label="Země (kód)" name="country" defaultValue={profile.country} placeholder="CZ" autoComplete="country" />
          </div>
        </section>

        <section className="app-card p-5 sm:p-6">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-600"><Building2 className="size-5" /></span>
            <div><h3 className="font-semibold text-slate-900">Firemní údaje</h3><p className="text-sm text-slate-500">Volitelné údaje pro firemní fakturaci.</p></div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="Název firmy" name="companyName" defaultValue={profile.companyName} autoComplete="organization" /></div>
            <Field label="IČO" name="companyIdNumber" defaultValue={profile.companyIdNumber} />
            <Field label="DIČ" name="vatId" defaultValue={profile.vatId} />
          </div>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {message && (
            <p role={message.type === "error" ? "alert" : "status"} className={`mr-auto inline-flex items-center gap-2 text-sm ${message.type === "success" ? "text-emerald-700" : "text-error-600"}`}>
              {message.type === "success" && <CheckCircle2 className="size-4" />}{message.text}
            </p>
          )}
          <button type="submit" disabled={pending} className="app-button min-w-40 disabled:cursor-wait disabled:opacity-70">
            {pending && <LoaderCircle className="size-5 animate-spin" />}{pending ? "Ukládám…" : "Uložit změny"}
          </button>
        </div>
      </form>
    </div>
  );
}
