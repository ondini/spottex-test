import type { Metadata } from "next";

import { ProductMarketingPage } from "@/App";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "Řízení fotovoltaiky SolaX",
  description:
    "Propojte SolaX Cloud bez dalšího hardwaru, stáhněte historii a nechte si zdarma spočítat možné úspory, tarif i optimální velikost baterie.",
};

export const dynamic = "force-dynamic";

export default async function ControlMarketingPage() {
  const session = await auth();
  return <ProductMarketingPage isAuthenticated={Boolean(session?.user?.id)} />;
}
