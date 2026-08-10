import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeInternalPath } from "@/lib/security/redirect";

export const metadata: Metadata = { title: "Přihlášení" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeInternalPath(Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl);
  const session = await auth();
  if (session?.user?.id) redirect(session.user.role === "ADMIN" && callbackUrl === "/app/dashboard" ? "/admin" : callbackUrl);

  return (
    <AuthShell>
      <LoginForm
        callbackUrl={callbackUrl}
        emailVerified={params.overeno === "1"}
        verificationError={typeof params.chyba === "string" ? params.chyba : undefined}
      />
    </AuthShell>
  );
}
