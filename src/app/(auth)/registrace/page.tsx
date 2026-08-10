import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import { safeInternalPath } from "@/lib/security/redirect";

export const metadata: Metadata = { title: "Registrace" };

export default async function RegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeInternalPath(Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl);
  const session = await auth();
  if (session?.user?.id) redirect(session.user.role === "ADMIN" ? "/admin" : callbackUrl);

  return (
    <AuthShell>
      <RegistrationForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
