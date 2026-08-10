"use client";

import { CheckCircle2, LoaderCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { PasswordField } from "@/components/auth/PasswordField";
import { trackEvent } from "@/lib/client-analytics";

export function RegistrationForm({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const passwordAgain = String(form.get("passwordAgain") || "");
    if (password !== passwordAgain) {
      setError("Zadaná hesla se neshodují.");
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") || "").trim(),
          email,
          password,
          consent: form.get("consent") === "on",
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; autoVerified?: boolean } | null;
      if (!response.ok) {
        setError(body?.error || "Registraci se nepodařilo dokončit.");
        return;
      }
      void trackEvent("SIGNUP_COMPLETED", "/registrace");
      window.localStorage.setItem("spottex_has_account", "1");

      if (body?.autoVerified) {
        const result = await signIn("credentials", { email, password, redirect: false });
        if (!result?.error) {
          window.location.assign(callbackUrl);
          return;
        }
      }
      setRegisteredEmail(email);
    } catch {
      setError("Registraci se nepodařilo dokončit. Zkuste to prosím znovu.");
    } finally {
      setPending(false);
    }
  }

  if (registeredEmail) {
    return (
      <div className="w-full text-center">
        <span className="mx-auto mb-6 grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-8" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Zkontrolujte svůj e-mail</h1>
        <p className="mt-3 leading-7 text-slate-500">
          Pokud jde o nový účet, na adresu <strong className="font-semibold text-slate-700">{registeredEmail}</strong> jsme poslali odkaz pro aktivaci.
          Jestli už účet existoval, přihlaste se nebo si obnovte heslo.
        </p>
        <Link href="/prihlaseni" className="app-button mt-8 w-full">
          Přejít na přihlášení
        </Link>
        <Link href="/zapomenute-heslo" className="mt-4 block text-sm font-semibold text-brand-700 hover:underline">
          Obnovit zapomenuté heslo
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <UserPlus className="size-6" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Vytvořit účet</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Začněte spravovat svoji elektrárnu se Spottexem.</p>
      </div>

      <form method="post" onSubmit={handleSubmit} className="space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Jméno a příjmení</span>
          <input className="app-input" name="name" autoComplete="name" placeholder="Jan Novák" minLength={2} maxLength={100} required autoFocus />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">E-mail</span>
          <input className="app-input" type="email" name="email" autoComplete="email" placeholder="vas@email.cz" required />
        </label>
        <PasswordField
          label="Heslo"
          name="password"
          autoComplete="new-password"
          placeholder="Minimálně 10 znaků"
          minLength={10}
          maxLength={72}
          required
        />
        <PasswordField
          label="Heslo znovu"
          name="passwordAgain"
          autoComplete="new-password"
          placeholder="Zopakujte heslo"
          minLength={10}
          maxLength={72}
          required
        />
        <p className="-mt-2 text-xs leading-5 text-slate-500">Použijte alespoň 10 znaků, velké písmeno a číslici.</p>

        <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-slate-600">
          <input name="consent" type="checkbox" className="mt-1 size-4 rounded border-slate-300 accent-brand-500" required />
          <span>
            Souhlasím se zpracováním údajů nezbytných pro provoz účtu a s{" "}
            <Link href="/obchodni-podminky" className="font-medium text-brand-700 hover:underline">obchodními podmínkami</Link>.
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-600">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className="app-button w-full disabled:cursor-wait disabled:opacity-70">
          {pending && <LoaderCircle className="size-5 animate-spin" />}
          {pending ? "Vytvářím účet…" : "Zaregistrovat se"}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-slate-500">
        Už účet máte?{" "}
        <Link href={`/prihlaseni?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="font-semibold text-brand-700 hover:text-brand-600">
          Přihlásit se
        </Link>
      </p>
    </div>
  );
}
