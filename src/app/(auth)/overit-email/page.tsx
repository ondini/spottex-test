import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import VerifyEmailForm from "./VerifyEmailForm";

export const metadata: Metadata = {
  title: "Ověření e-mailu",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const query = await searchParams;
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  const validToken = typeof token === "string" && token.length > 0 && token.length <= 200;

  return (
    <AuthShell>
      <div className="w-full text-center">
        <span className="mx-auto mb-6 grid size-16 place-items-center rounded-full bg-brand-50 text-brand-700">
          <MailCheck className="size-8" />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {validToken ? "Potvrďte aktivaci účtu" : "Odkaz není úplný"}
        </h1>
        <p className="mt-3 leading-7 text-slate-500">
          {validToken
            ? "Kliknutím na tlačítko ověříte svůj e-mail a aktivujete účet Spottex."
            : "Otevřete prosím celý ověřovací odkaz, který jsme vám poslali e-mailem."}
        </p>
        {validToken ? (
          <VerifyEmailForm token={token} />
        ) : (
          <Link href="/prihlaseni" className="app-button mt-8 w-full">Přejít na přihlášení</Link>
        )}
      </div>
    </AuthShell>
  );
}
