import type { Metadata } from "next";
import { cookies } from "next/headers";

import ConsentAndAnalytics from "@/components/analytics/ConsentAndAnalytics";
import { verifyConsentCookie } from "@/lib/analytics/consent";
import { prisma } from "@/lib/prisma";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Spottex", template: "%s | Spottex" },
  description: "Chytré řízení fotovoltaiky, spotřeby a prodeje energie.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [settings, cookieStore] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: 1 }, select: { metaPixelEnabled: true, metaPixelId: true } }).catch(() => null),
    cookies(),
  ]);
  const stored = verifyConsentCookie(cookieStore.get("spottex_consent")?.value);
  const initialConsent = stored?.v === "2026-07" ? { analytics: stored.a, marketing: stored.m } : null;
  return (
    <html lang="cs">
      <body><ConsentAndAnalytics initialConsent={initialConsent} metaPixelId={settings?.metaPixelEnabled ? settings.metaPixelId : null}>{children}</ConsentAndAnalytics></body>
    </html>
  );
}
