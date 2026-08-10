import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Zapomenuté heslo", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <AuthShell><ForgotPasswordForm /></AuthShell>;
}

