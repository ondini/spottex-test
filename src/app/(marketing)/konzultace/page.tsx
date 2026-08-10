import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarCheck2, Clock3, ShieldCheck, Video } from "lucide-react";

import { Footer, Nav } from "@/App";
import { auth } from "@/auth";
import BookingWidget from "@/components/consultation/BookingWidget";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Nezávazná konzultace",
  description: "Rezervujte si online konzultaci o chytrém řízení fotovoltaiky se Spottexem.",
};
export const dynamic = "force-dynamic";

export default async function ConsultationPage() {
  const [settings, session] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: 1 }, select: { consultationLead: true } }),
    auth(),
  ]);
  const isAuthenticated = Boolean(session?.user?.id);

  return (
    <>
      <Nav isAuthenticated={isAuthenticated} />
      <main className="consultation-page">
        <section className="consultation-hero">
          <div className="consultation-hero-inner">
            <div className="consultation-hero-copy">
              <span>30 minut online · zdarma</span>
              <h1>Probereme potenciál vaší elektrárny.</h1>
              <p>
                {settings?.consultationLead || "Ukážeme vám, jak chytré řízení reaguje na ceny, výrobu, baterii i vaši spotřebu. Bez závazků a bez složité přípravy."}
              </p>
              <div className="consultation-hero-points" aria-label="Co konzultace nabízí">
                <div><Clock3 aria-hidden="true" /><span><strong>30 minut</strong>Konkrétně a bez zbytečné omáčky</span></div>
                <div><Video aria-hidden="true" /><span><strong>Online</strong>Odkaz na schůzku dostanete e-mailem</span></div>
                <div><ShieldCheck aria-hidden="true" /><span><strong>Bez závazku</strong>Řízení se bez vašeho pokynu nezapne</span></div>
              </div>
            </div>
            <aside className="consultation-hero-card" aria-label="Průběh konzultace">
              <span className="consultation-hero-card-icon"><CalendarCheck2 aria-hidden="true" /></span>
              <p className="consultation-hero-card-kicker">Co společně projdeme</p>
              <h2>Vaše data, vaše možnosti, jasný další krok.</h2>
              <ol>
                <li><span>1</span>Současný stav fotovoltaiky a baterie</li>
                <li><span>2</span>Možnosti připojení SolaX bez dalšího hardwaru</li>
                <li><span>3</span>Výpočet úspor a vhodný způsob řízení</li>
              </ol>
            </aside>
          </div>
        </section>

        <section className="consultation-booking" aria-labelledby="consultation-booking-title">
          <header className="consultation-booking-heading">
            <div className="badge"><span className="badge-dot" />Rezervace</div>
            <h2 id="consultation-booking-title">Vyberte si termín</h2>
            <p>Nejprve zvolte volný čas, potom doplňte kontakt. Termín definitivně potvrdíte odkazem v e-mailu.</p>
          </header>
          <Suspense fallback={<div className="booking-loading">Načítám rezervační kalendář…</div>}>
            <BookingWidget />
          </Suspense>
        </section>
      </main>
      <Footer />
    </>
  );
}
