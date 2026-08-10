import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Obnova hesla", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <AuthShell><Suspense fallback={<p className="text-slate-500">Načítám…</p>}><ResetPasswordForm /></Suspense></AuthShell>;
}

