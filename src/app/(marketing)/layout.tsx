import type { Metadata } from "next";
import "../../index.css";

// What search engines and link previews show for spottex.cz. The landing
// page title is absolute so the root template does not append a second
// "Spottex"; subpages keep the template.
const LANDING_TITLE = "Spottex | Začněte opravdu šetřit s vaší fotovoltaikou";
const LANDING_DESCRIPTION =
  "Využijte potenciál své fotovoltaiky naplno bez nákladů na další hardware. Zajistíme optimální práci s vyrobenou energií: chytré řízení baterie, spotřeby a prodeje elektřiny přes váš SolaX Cloud.";

export const metadata: Metadata = {
  title: {
    absolute: LANDING_TITLE,
    template: "%s | Spottex",
  },
  description: LANDING_DESCRIPTION,
  openGraph: {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    siteName: "Spottex",
    locale: "cs_CZ",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: LANDING_TITLE, description: LANDING_DESCRIPTION },
};

export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
