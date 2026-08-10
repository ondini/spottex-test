"use client";

import { CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    await fetch("/api/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    }).catch(() => undefined);
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return <div className="w-full text-center"><span className="mx-auto grid size-16 place-items-center rounded-full bg-success-50 text-success-600"><CheckCircle2 className="size-8" /></span><h1 className="mt-6 text-3xl font-semibold text-slate-900">Zkontrolujte e-mail</h1><p className="mt-3 leading-7 text-slate-500">Pokud účet existuje, poslali jsme odkaz platný 60 minut.</p><Link href="/prihlaseni" className="app-button mt-8 w-full">Zpět na přihlášení</Link></div>;
  }

  return <div className="w-full"><span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700"><Mail className="size-6" /></span><h1 className="text-3xl font-semibold text-slate-900">Zapomenuté heslo</h1><p className="mt-2 text-sm leading-6 text-slate-500">Pošleme vám bezpečný odkaz pro nastavení nového hesla.</p><form onSubmit={submit} className="mt-8 space-y-5"><label className="block text-sm font-medium text-slate-700">E-mail<input className="app-input mt-2" name="email" type="email" autoComplete="email" required autoFocus /></label><button className="app-button w-full" disabled={busy}>{busy && <LoaderCircle className="size-5 animate-spin" />}{busy ? "Odesílám…" : "Poslat odkaz"}</button></form><Link href="/prihlaseni" className="mt-6 block text-center text-sm font-semibold text-brand-700 hover:underline">Zpět na přihlášení</Link></div>;
}

