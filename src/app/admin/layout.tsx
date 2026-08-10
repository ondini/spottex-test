import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell/AppShell";
import { requireAdmin } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: { default: "Administrace", template: "%s | Spottex administrace" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin("/admin");
  return (
    <AppShell
      mode="admin"
      user={{ email: session.user.email, name: session.user.name, role: session.user.role }}
    >
      {children}
    </AppShell>
  );
}

