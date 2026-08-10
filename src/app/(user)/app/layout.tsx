import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell/AppShell";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: { default: "Můj účet", template: "%s | Spottex" },
  robots: { index: false, follow: false },
};

export default async function UserAppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser("/app/dashboard");
  const sites = await prisma.energySite.findMany({
    where: { userId: Number(session.user.id) },
    orderBy: [{ status: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      optimizationOn: true,
      requiredInfo: true,
    },
  });
  return (
    <AppShell
      mode="user"
      user={{ email: session.user.email, name: session.user.name, role: session.user.role }}
      sites={sites}
    >
      {children}
    </AppShell>
  );
}
