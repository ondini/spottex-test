import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireUser(callbackUrl = "/app/dashboard") {
  const session = await auth();
  if (!session?.user?.id) redirect(`/prihlaseni?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return session;
}

export async function requireAdmin(callbackUrl = "/admin") {
  const session = await requireUser(callbackUrl);
  if (session.user.role !== "ADMIN") redirect("/app/dashboard");
  return session;
}

export async function apiUser() {
  const session = await auth();
  return session?.user?.id ? session : null;
}

export async function apiAdmin() {
  const session = await apiUser();
  return session?.user.role === "ADMIN" ? session : null;
}
