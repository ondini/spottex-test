import type { Metadata } from "next";
import { Inter } from "next/font/google";
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

// The stylesheets only ever declared 'Inter' and 'Poppins' by name, with no
// @font-face and no font files, so every visitor without them installed locally
// fell back to a system sans and the page never matched the design. next/font
// self-hosts the files under /_next, which the `font-src 'self'` CSP allows;
// an external font host would not be.
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "900"],
  display: "swap",
  variable: "--font-inter",
});

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [settings, cookieStore] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: 1 }, select: { metaPixelEnabled: true, metaPixelId: true } }).catch(() => null),
    cookies(),
  ]);
  const stored = verifyConsentCookie(cookieStore.get("spottex_consent")?.value);
  const initialConsent = stored?.v === "2026-07" ? { analytics: stored.a, marketing: stored.m } : null;
  return (
    <html lang="cs" className={inter.variable}>
      <body><ConsentAndAnalytics initialConsent={initialConsent} metaPixelId={settings?.metaPixelEnabled ? settings.metaPixelId : null}>{children}</ConsentAndAnalytics></body>
    </html>
  );
}
