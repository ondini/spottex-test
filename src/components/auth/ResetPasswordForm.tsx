"use client";

import { CheckCircle2, KeyRound, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { PasswordField } from "@/components/auth/PasswordField";

export default function ResetPasswordForm() {
  const searchToken = useSearchParams().get("token") || "";
  const [token] = useState(searchToken);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchToken) window.history.replaceState(null, "", window.location.pathname);
  }, [searchToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password !== String(form.get("again") || "")) { setError("Hesla se neshodují."); return; }
    setBusy(true);
    const response = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (!response.ok) { setError("Odkaz není platný, vypršel nebo heslo nesplňuje požadavky."); return; }
    setComplete(true);
  }

  if (complete) return <div className="w-full text-center"><span className="mx-auto grid size-16 place-items-center rounded-full bg-success-50 text-success-600"><CheckCircle2 className="size-8" /></span><h1 className="mt-6 text-3xl font-semibold text-slate-900">Heslo bylo změněno</h1><Link href="/prihlaseni" className="app-button mt-8 w-full">Přihlásit se</Link></div>;
  return <div className="w-full"><span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700"><KeyRound className="size-6" /></span><h1 className="text-3xl font-semibold text-slate-900">Nastavit nové heslo</h1><p className="mt-2 text-sm text-slate-500">Použijte 10–72 znaků, velké písmeno a číslici.</p><form onSubmit={submit} className="mt-8 space-y-5"><PasswordField label="Nové heslo" name="password" autoComplete="new-password" minLength={10} maxLength={72} required /><PasswordField label="Nové heslo znovu" name="again" autoComplete="new-password" minLength={10} maxLength={72} required />{error && <p className="rounded-xl bg-error-50 p-3 text-sm text-error-600">{error}</p>}<button className="app-button w-full" disabled={busy || !token}>{busy && <LoaderCircle className="size-5 animate-spin" />}{busy ? "Ukládám…" : "Uložit nové heslo"}</button></form></div>;
}
