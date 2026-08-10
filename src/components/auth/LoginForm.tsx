"use client";

import { LoaderCircle, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { PasswordField } from "@/components/auth/PasswordField";
import { trackEvent } from "@/lib/client-analytics";

type LoginFormProps = {
  callbackUrl: string;
  emailVerified?: boolean;
  verificationError?: string;
};

export function LoginForm({ callbackUrl, emailVerified, verificationError }: LoginFormProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEmail, setLastEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "pending" | "sent" | "failed">("idle");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    setLastEmail(email);
    setResendState("idle");
    try {
      const result = await signIn("credentials", {
        email,
        password: String(form.get("password") || ""),
        redirect: false,
      });
      if (result?.error) {
        setError("E-mail nebo heslo není správné, případně účet ještě nebyl ověřen.");
        return;
      }
      const session = await fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()).catch(() => null);
      void trackEvent("LOGIN", "/prihlaseni");
      window.localStorage.setItem("spottex_has_account", "1");
      const destination = callbackUrl === "/app/dashboard" && session?.user?.role === "ADMIN" ? "/admin" : callbackUrl;
      window.location.assign(destination);
    } catch {
      setError("Přihlášení se nepodařilo. Zkuste to prosím znovu.");
    } finally {
      setPending(false);
    }
  }

  async function resendVerification() {
    if (!lastEmail || !["idle", "failed"].includes(resendState)) return;
    setResendState("pending");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lastEmail }),
      });
      setResendState(response.ok ? "sent" : "failed");
    } catch {
      setResendState("failed");
    }
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <LockKeyhole className="size-6" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Přihlášení</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Přihlaste se do svého účtu Spottex.</p>
      </div>

      {emailVerified && (
        <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          E-mail je ověřený. Nyní se můžete přihlásit.
        </div>
      )}
      {verificationError && (
        <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {verificationError === "odkaz-vyprsel"
            ? "Ověřovací odkaz už vypršel. Kontaktujte nás prosím pro zaslání nového."
            : "Ověřovací odkaz není platný."}
        </div>
      )}

      <form method="post" onSubmit={handleSubmit} className="space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">E-mail</span>
          <input
            className="app-input"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="vas@email.cz"
            required
            autoFocus
          />
        </label>
        <PasswordField
          label="Heslo"
          name="password"
          autoComplete="current-password"
          placeholder="Vaše heslo"
          required
        />
        <div className="-mt-2 text-right">
          <Link href="/zapomenute-heslo" className="text-sm font-semibold text-brand-700 hover:underline">Zapomněli jste heslo?</Link>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-600">
            <p>{error}</p>
            <p className="mt-2 text-slate-600">
              Pokud už je účet ověřený a heslem si nejste jistí, použijte{" "}
              <Link href="/zapomenute-heslo" className="font-semibold text-brand-700 underline underline-offset-2">
                obnovu hesla
              </Link>.
            </p>
            <button type="button" onClick={resendVerification} disabled={["pending", "sent"].includes(resendState)} className="mt-2 font-semibold underline underline-offset-2 disabled:opacity-70">
              {resendState === "pending" ? "Odesílám…" : resendState === "sent" ? "Pokud účet čeká na ověření, odkaz jsme odeslali." : resendState === "failed" ? "Odeslání selhalo – zkusit znovu" : "Poslat ověřovací e-mail znovu"}
            </button>
          </div>
        )}

        <button type="submit" disabled={pending} className="app-button w-full disabled:cursor-wait disabled:opacity-70">
          {pending && <LoaderCircle className="size-5 animate-spin" />}
          {pending ? "Přihlašuji…" : "Přihlásit se"}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-slate-500">
        Ještě nemáte účet?{" "}
        <Link href={`/registrace?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="font-semibold text-brand-700 hover:text-brand-600">
          Zaregistrovat se
        </Link>
      </p>
    </div>
  );
}
