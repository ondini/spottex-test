import type { Metadata } from "next";

import { LegalPage, type LegalNavigationItem } from "@/components/marketing/LegalPage";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Zásady zpracování osobních údajů (GDPR)",
  description:
    "Jak Spottex Energy, s.r.o. zpracovává osobní údaje při provozu webu, aplikace a chytrého řízení fotovoltaiky.",
};

export const dynamic = "force-dynamic";

const navigation: LegalNavigationItem[] = [
  { id: "spravce", label: "Správce a kontakt" },
  { id: "udaje", label: "Jaké údaje zpracováváme" },
  { id: "ucely", label: "Účely a právní základy" },
  { id: "energie", label: "SolaX a energetická data" },
  { id: "cookies", label: "Cookies a měření" },
  { id: "prijemci", label: "Příjemci a předávání" },
  { id: "uchovani", label: "Doba uchování" },
  { id: "zabezpeceni", label: "Zabezpečení" },
  { id: "prava", label: "Vaše práva" },
  { id: "zaver", label: "Závěrečná ustanovení" },
];

export default async function PrivacyPage() {
  const settings = await prisma.siteSettings
    .findUnique({
      where: { id: 1 },
      select: {
        contactEmail: true,
        sellerCompanyName: true,
        sellerCompanyId: true,
        sellerAddress: true,
      },
    })
    .catch(() => null);

  const company = settings?.sellerCompanyName || "Spottex Energy, s.r.o.";
  const companyId = settings?.sellerCompanyId || "23191627";
  const address = settings?.sellerAddress || "Volutová 2523/14, Stodůlky, 158 00 Praha 5";
  const email = settings?.contactEmail || "info@spottex.cz";

  return (
    <LegalPage
      eyebrow="Soukromí a bezpečnost"
      title="Zásady zpracování osobních údajů"
      description="Srozumitelně vysvětlujeme, jaká data potřebujeme pro provoz Spottexu, výpočet úspor a bezpečné propojení se SolaX Cloudem — a co se s nimi děje."
      effectiveDate="14. 7. 2026"
      navigation={navigation}
      contactEmail={email}
    >
      <section id="spravce">
        <p className="legal-section-number">01</p>
        <h2>Správce a kontaktní údaje</h2>
        <p>
          Správcem osobních údajů ve smyslu čl. 4 bodu 7 nařízení Evropského parlamentu
          a Rady (EU) 2016/679 (GDPR) je <strong>{company}</strong>, IČO {companyId}, se
          sídlem {address} (dále jen „Spottex“ nebo „správce“).
        </p>
        <div className="legal-contact-card">
          <div><span>E-mail pro ochranu údajů</span><a href={`mailto:${email}`}>{email}</a></div>
          <div><span>Web a aplikace</span><a href="https://spottex.cz">spottex.cz</a></div>
        </div>
        <p>Správce nejmenoval pověřence pro ochranu osobních údajů.</p>
      </section>

      <section id="udaje">
        <p className="legal-section-number">02</p>
        <h2>Jaké údaje zpracováváme</h2>
        <p>Zpracováváme pouze údaje potřebné pro konkrétní funkce, které používáte:</p>
        <ul>
          <li><strong>Účet a identita:</strong> jméno, e-mail, bezpečně zahashované heslo, stav a role účtu, historie přihlášení.</li>
          <li><strong>Kontaktní a smluvní údaje:</strong> telefon, komunikace s podporou, souhlasy, objednávky a zvolená služba.</li>
          <li><strong>Fakturační a platební údaje:</strong> fakturační adresa, IČO, DIČ, identifikátor platby a stav transakce. Úplné údaje platební karty neukládáme.</li>
          <li><strong>Údaje elektrárny:</strong> identifikátory elektrárny a střídače, model zařízení, výkon FVE, kapacita baterie a technický stav.</li>
          <li><strong>Energetická měření:</strong> výroba, spotřeba, stav a tok baterie, odběr a přetok do sítě, časové řady a odvozené přehledy úspor.</li>
          <li><strong>Nahrané faktury za energie:</strong> dokument, zúčtovací období a verzované ručně ověřené údaje. Dokument je citlivý, ukládáme jej šifrovaně, přístup auditujeme a jeho obsah standardně odstraníme nejpozději po 180 dnech.</li>
          <li><strong>Simulace a doporučení:</strong> vstupní parametry, porovnávané varianty, distribuční sazby, průběh výpočtu a jeho výsledky.</li>
          <li><strong>Technické údaje:</strong> IP adresa, typ prohlížeče, bezpečnostní a auditní záznamy, informace o chybách a nastavení cookies.</li>
          <li><strong>Konzultace:</strong> zvolený termín, jméno, e-mail, telefon a zpráva, kterou nám dobrovolně odešlete.</li>
        </ul>
        <p>
          Údaje získáváme přímo od vás, z používání aplikace a — po vašem propojení —
          z vašeho účtu SolaX Cloud. Nezískáváme údaje o elektrárně bez vašeho aktivního kroku.
        </p>
      </section>

      <section id="ucely">
        <p className="legal-section-number">03</p>
        <h2>Účely a právní základy zpracování</h2>
        <div className="legal-purpose-grid">
          <article><span>Plnění smlouvy</span><h3>Účet a služba</h3><p>Registrace, přihlášení, energetický přehled, simulace, objednávky, platby, faktury a uživatelská podpora.</p></article>
          <article><span>Oprávněný zájem</span><h3>Bezpečnost a rozvoj</h3><p>Prevence zneužití, auditní logy, řešení incidentů, agregované vyhodnocování kvality a zlepšování služby.</p></article>
          <article><span>Právní povinnost</span><h3>Účetnictví</h3><p>Uchování účetních a daňových dokladů a plnění dalších zákonných povinností.</p></article>
          <article><span>Váš souhlas</span><h3>Analytika a marketing</h3><p>Nepovinné měření návštěvnosti, marketingové vyhodnocení a obchodní sdělení mimo zákonné výjimky.</p></article>
        </div>
        <p>
          Výsledky simulací a doporučení mají informační charakter. Spottex neprovádí
          automatizované individuální rozhodování s právními nebo obdobně významnými účinky
          podle čl. 22 GDPR. Řízení střídače se aktivuje až po vašem výslovném potvrzení.
        </p>
      </section>

      <section id="energie">
        <p className="legal-section-number">04</p>
        <h2>SolaX Cloud a energetická data</h2>
        <p>
          Spottex v současnosti podporuje elektrárny se střídačem SolaX. Po zadání přístupu
          ověříme váš účet vůči SolaX Cloud, načteme dostupné elektrárny a stáhneme historická
          i průběžná měření. Díky tomu lze bez dalšího hardwaru zobrazit energetický přehled,
          vypočítat varianty úspor a — teprve po samostatné aktivaci — zapnout chytré řízení.
        </p>
        <div className="legal-callout">
          <strong>Heslo k SolaX Cloudu dlouhodobě neukládáme.</strong>
          <p>Použijeme jej pro navázání spojení. Následné přístupové tokeny ukládáme na serveru v šifrované podobě a neposíláme je do prohlížeče.</p>
        </div>
        <p>
          Historická data používáme pro výpočet referenčního provozu, porovnání distribučních
          sazeb, velikosti baterie a výkonu FVE. Příkazy pro řízení jsou technicky i oprávněními
          oddělené od pouhého načítání dat.
        </p>
      </section>

      <section id="cookies">
        <p className="legal-section-number">05</p>
        <h2>Cookies, analytika a marketing</h2>
        <p>
          Nezbytné cookies zajišťují přihlášení, ochranu formulářů, bezpečné uložení vaší volby
          soukromí a další funkce, bez kterých by účet nebo web nefungoval spolehlivě. Tyto cookies
          nepoužíváme k reklamnímu profilování.
        </p>
        <div className="legal-table-wrap">
          <table>
            <thead><tr><th>Kategorie</th><th>K čemu slouží</th><th>Aktivace</th></tr></thead>
            <tbody>
              <tr><td><strong>Nezbytné</strong></td><td>Přihlášení, zabezpečení, ochrana proti zneužití a uložení cookie volby.</td><td>Vždy</td></tr>
              <tr><td><strong>Analytické</strong></td><td>Agregované návštěvy stránek a události, které pomáhají zlepšovat Spottex.</td><td>Po souhlasu</td></tr>
              <tr><td><strong>Marketingové</strong></td><td>Meta Pixel a vyhodnocení kampaní, pokud je správce v administraci aktivuje.</td><td>Po souhlasu</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Volbu můžete kdykoli změnit přes odkaz <strong>Nastavení cookies</strong> v patičce
          webu. Odvolání souhlasu nemá vliv na zákonnost předchozího zpracování.
        </p>
      </section>

      <section id="prijemci">
        <p className="legal-section-number">06</p>
        <h2>Příjemci údajů a předávání</h2>
        <p>V nezbytném rozsahu mohou údaje zpracovávat naši smluvní partneři:</p>
        <ul>
          <li>poskytovatelé hostingu, databází, zálohování, monitoringu a zabezpečení,</li>
          <li>provozovatel e-mailové infrastruktury a nástrojů zákaznické komunikace,</li>
          <li>SolaX Cloud při propojení elektrárny,</li>
          <li>Google při propojení kalendáře a vytvoření online konzultace,</li>
          <li>GoPay nebo jiný zvolený poskytovatel platebních služeb,</li>
          <li>Meta Platforms pouze po udělení marketingového souhlasu a aktivaci Pixelu,</li>
          <li>účetní, právní a IT dodavatelé v rozsahu potřebném pro jejich práci.</li>
        </ul>
        <p>
          Pokud by zpracovatel předával údaje mimo EU/EHP, vyžadujeme odpovídající ochranu,
          zejména rozhodnutí o odpovídající ochraně nebo standardní smluvní doložky podle GDPR.
        </p>
      </section>

      <section id="uchovani">
        <p className="legal-section-number">07</p>
        <h2>Doba uchování</h2>
        <ul>
          <li><strong>Účet, energetická data a výsledky simulací:</strong> po dobu poskytování služby a standardně nejvýše 3 roky po jejím ukončení kvůli ochraně právních nároků.</li>
          <li><strong>Účetní a daňové doklady:</strong> zpravidla 10 let podle příslušných právních předpisů.</li>
          <li><strong>Rezervace konzultací:</strong> nejvýše 2 roky od termínu, není-li další uchování nutné pro navazující smluvní vztah.</li>
          <li><strong>Bezpečnostní a auditní záznamy:</strong> standardně 2 roky.</li>
          <li><strong>Analytické události:</strong> standardně 395 dní; záznam uděleného či odvolaného souhlasu nejvýše 5 let.</li>
          <li><strong>E-mailový outbox:</strong> úspěšně odeslané zprávy standardně 7 dní, chybové záznamy nejvýše 30 dní.</li>
        </ul>
        <p>Po uplynutí doby údaje odstraníme nebo nevratně anonymizujeme, pokud další uchování nevyžaduje zákon.</p>
      </section>

      <section id="zabezpeceni">
        <p className="legal-section-number">08</p>
        <h2>Jak data zabezpečujeme</h2>
        <p>
          Používáme řízení přístupových práv, oddělení rolí uživatele a administrátora,
          šifrovaný přenos, šifrování přístupových tokenů, bezpečné hashování hesel, omezení
          počtu pokusů o přihlášení, auditní záznamy a pravidelné zálohování. Citlivé serverové
          klíče nejsou součástí klientského JavaScriptu ani veřejného repozitáře.
        </p>
        <p>
          Přesto žádný systém nelze označit za absolutně bezpečný. Máte-li podezření na incident,
          kontaktujte nás bezodkladně na <a href={`mailto:${email}`}>{email}</a> a neposílejte nám hesla.
        </p>
      </section>

      <section id="prava">
        <p className="legal-section-number">09</p>
        <h2>Vaše práva</h2>
        <p>Za podmínek stanovených GDPR máte zejména právo:</p>
        <ul>
          <li>získat potvrzení a přístup ke zpracovávaným údajům,</li>
          <li>požadovat opravu nepřesných nebo doplnění neúplných údajů,</li>
          <li>požadovat výmaz nebo omezení zpracování,</li>
          <li>získat údaje ve strukturovaném formátu a využít právo na přenositelnost,</li>
          <li>vznést námitku proti zpracování založenému na oprávněném zájmu,</li>
          <li>kdykoli odvolat souhlas s analytikou, marketingem nebo obchodní komunikací.</li>
        </ul>
        <p>
          Žádost pošlete na <a href={`mailto:${email}`}>{email}</a>. Můžeme potřebovat přiměřeně
          ověřit vaši totožnost. Máte také právo podat stížnost u
          {" "}<a href="https://uoou.gov.cz" target="_blank" rel="noreferrer">Úřadu pro ochranu osobních údajů</a>,
          Pplk. Sochora 27, 170 00 Praha 7.
        </p>
      </section>

      <section id="zaver">
        <p className="legal-section-number">10</p>
        <h2>Závěrečná ustanovení</h2>
        <p>
          Tyto zásady můžeme aktualizovat, pokud se změní služba, zapojené technologie nebo
          právní požadavky. Aktuální znění vždy zveřejníme na této stránce; na podstatné změny
          upozorníme vhodným způsobem v aplikaci nebo e-mailem.
        </p>
        <p>
          Dotazy k těmto zásadám a ke zpracování osobních údajů posílejte na
          {" "}<a href={`mailto:${email}`}>{email}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
