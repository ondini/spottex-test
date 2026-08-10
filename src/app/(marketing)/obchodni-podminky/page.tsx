import type { Metadata } from "next";

import { LegalPage, type LegalNavigationItem } from "@/components/marketing/LegalPage";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Obchodní podmínky",
  description:
    "Pravidla používání aplikace Spottex, výpočtu úspor, chytrého řízení fotovoltaiky, předplatného a konzultací.",
};

export const dynamic = "force-dynamic";

const navigation: LegalNavigationItem[] = [
  { id: "uvod", label: "Poskytovatel a působnost" },
  { id: "sluzba", label: "Co služba Spottex umí" },
  { id: "smlouva", label: "Účet a uzavření smlouvy" },
  { id: "cena", label: "Cena a zkušební období" },
  { id: "rizeni", label: "Připojení a řízení" },
  { id: "dostupnost", label: "Dostupnost a třetí strany" },
  { id: "ukonceni", label: "Odstoupení a ukončení" },
  { id: "vady", label: "Vady a reklamace" },
  { id: "odpovednost", label: "Odpovědnost a spory" },
  { id: "zaver", label: "Doručování a závěr" },
];

export default async function TermsPage() {
  const settings = await prisma.siteSettings
    .findUnique({
      where: { id: 1 },
      select: {
        contactEmail: true,
        sellerCompanyName: true,
        sellerCompanyId: true,
        sellerVatId: true,
        sellerAddress: true,
      },
    })
    .catch(() => null);

  const company = settings?.sellerCompanyName || "Spottex Energy, s.r.o.";
  const companyId = settings?.sellerCompanyId || "23191627";
  const vatId = settings?.sellerVatId;
  const address = settings?.sellerAddress || "Volutová 2523/14, Stodůlky, 158 00 Praha 5";
  const email = settings?.contactEmail || "info@spottex.cz";

  return (
    <LegalPage
      eyebrow="Podmínky služby"
      title="Obchodní podmínky"
      description="Pravidla pro účet Spottex, bezplatný výpočet úspor, propojení se SolaX Cloudem, chytré řízení, předplatné a konzultace na jednom místě."
      effectiveDate="14. 7. 2026"
      navigation={navigation}
      contactEmail={email}
    >
      <section id="uvod">
        <p className="legal-section-number">01</p>
        <h2>Poskytovatel a působnost podmínek</h2>
        <p>
          Tyto obchodní podmínky upravují práva a povinnosti při používání webu a digitální
          služby Spottex provozované společností <strong>{company}</strong>, IČO {companyId}
          {vatId ? `, DIČ ${vatId}` : ""}, se sídlem {address} (dále jen „Spottex“ nebo
          „poskytovatel“).
        </p>
        <div className="legal-contact-card">
          <div><span>Kontaktní e-mail</span><a href={`mailto:${email}`}>{email}</a></div>
          <div><span>Web a aplikace</span><a href="https://spottex.cz">spottex.cz</a></div>
        </div>
        <p>
          Podmínky se použijí pro spotřebitele i podnikatele. Ustanovení určená zákonem pouze
          spotřebitelům se použijí jen na uživatele, který jedná mimo rámec své podnikatelské
          činnosti. Individuální písemná dohoda má před těmito podmínkami přednost.
        </p>
        <p>
          Smlouvu lze uzavřít v českém jazyce. Tyto podmínky tvoří její nedílnou součást.
          Ochranu osobních údajů upravují samostatné
          {" "}<a href="/ochrana-osobnich-udaju">Zásady zpracování osobních údajů</a>.
        </p>
      </section>

      <section id="sluzba">
        <p className="legal-section-number">02</p>
        <h2>Co služba Spottex zahrnuje</h2>
        <p>Podle zvolené části služby může Spottex uživateli umožnit zejména:</p>
        <ul>
          <li>založit a spravovat uživatelský účet, profil, objednávky, platby a faktury,</li>
          <li>propojit podporovanou fotovoltaickou elektrárnu se SolaX Cloudem bez instalace dalšího hardwaru,</li>
          <li>načíst historická a průběžná data o výrobě, spotřebě, baterii a toku energie,</li>
          <li>zobrazit energetický přehled a odhadnout úspory na základě dostupných dat,</li>
          <li>porovnat varianty distribuční sazby, velikosti baterie, výkonu FVE a způsobu řízení,</li>
          <li>po samostatném výslovném zapnutí vytvářet a provádět plány chytrého řízení podporovaného střídače,</li>
          <li>rezervovat odbornou online konzultaci v dostupném termínu.</li>
        </ul>
        <div className="legal-callout">
          <strong>Výpočet je informativní, řízení je samostatný krok.</strong>
          <p>
            Výsledek simulace není energetický audit, příslib konkrétní úspory ani pokyn k zásahu
            do elektroinstalace. Propojením dat se řízení samo nezapne.
          </p>
        </div>
        <p>
          Aktuálně podporované značky, funkce a technické požadavky jsou uvedeny na webu nebo
          přímo v aplikaci. Není-li výslovně uvedeno jinak, současná verze aktivního řízení je
          určena pro kompatibilní systémy SolaX.
        </p>
      </section>

      <section id="smlouva">
        <p className="legal-section-number">03</p>
        <h2>Účet, objednávka a uzavření smlouvy</h2>
        <p>
          Uživatel při registraci uvádí pravdivé a aktuální údaje, chrání své heslo a bez
          zbytečného odkladu oznámí podezření na zneužití účtu. Účet je určen jedné osobě;
          uživatel nesmí obcházet zabezpečení, narušovat službu ani ji využívat v rozporu s právem.
        </p>
        <p>
          Prezentace služby na webu je informativní. Objednávku uživatel vytvoří výběrem nabídky
          v aplikaci a jejím závazným potvrzením. Před odesláním může zkontrolovat a opravit údaje,
          cenu, délku období a zvolený způsob platby. Smlouva vzniká potvrzením objednávky
          Spottexem nebo zpřístupněním objednané služby, podle toho, co nastane dříve.
        </p>
        <p>
          Potvrzení objednávky zasíláme na e-mail spojený s účtem a údaje o službě uchováváme
          v elektronické podobě. Doklady a stav předplatného jsou dostupné také v uživatelském účtu.
          Spottex může objednávku odmítnout při zjevné chybě ceny, nedostupnosti kompatibilní služby,
          podezření na zneužití nebo nesplnění technických podmínek.
        </p>
        <p>
          Bezplatný výpočet úspor nebo nezávazná konzultace samy o sobě nezakládají povinnost
          objednat placené řízení.
        </p>
      </section>

      <section id="cena">
        <p className="legal-section-number">04</p>
        <h2>Cena, úspora a zkušební období</h2>
        <p>
          První aktivace chytrého řízení pro nový účet může zahrnovat <strong>30denní zkušební
          období zdarma</strong>. Není-li v objednávce výslovně uvedeno jinak, bezplatné období se
          samo nepřemění v placenou službu; pokračování uživatel potvrdí samostatně.
        </p>
        <div className="legal-table-wrap">
          <table>
            <thead><tr><th>Varianta</th><th>Cena</th><th>Horní limit</th><th>Vyhodnocení</th></tr></thead>
            <tbody>
              <tr><td><strong>Vyzkoušení</strong></td><td>0 Kč</td><td>—</td><td>30 dní</td></tr>
              <tr><td><strong>Měsíční</strong></td><td>15 % z dosažené úspory</td><td>99 Kč</td><td>za měsíc</td></tr>
              <tr><td><strong>Roční</strong></td><td>12,5 % z dosažené úspory</td><td>999 Kč</td><td>za rok</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Dosaženou úsporou se rozumí kladný rozdíl mezi náklady vyhodnocenými podle skutečného
          provozu se Spottexem a srovnávacím provozem bez jeho řídicích zásahů, vypočtený metodou
          popsanou u objednávky nebo v aplikaci. Zohledňují se dostupná měření, ceny energie,
          sjednaná sazba a technické parametry elektrárny. Je-li vypočtená úspora nulová nebo
          záporná, procentní cena za dané vyhodnocované období je 0 Kč.
        </p>
        <p>
          Přesná cena, období, případné daně a způsob platby jsou vždy zobrazeny před závazným
          potvrzením objednávky. Placená služba se automaticky obnovuje pouze tehdy, pokud je to
          v objednávce výslovně uvedeno a uživatel opakovanou platbu samostatně odsouhlasí.
        </p>
      </section>

      <section id="rizeni">
        <p className="legal-section-number">05</p>
        <h2>Připojení elektrárny a bezpečné řízení</h2>
        <p>
          Uživatel smí připojit pouze elektrárnu a účet SolaX Cloud, k nimž má oprávněný přístup.
          Odpovídá za správnost technických parametrů a za to, že provoz zařízení odpovídá
          dokumentaci výrobce, podmínkám distributora a pokynům odborně způsobilé osoby.
        </p>
        <p>
          Načtení dat, výpočet simulace a zapnutí aktivního řízení jsou oddělené kroky. Aktivní
          řízení začne až po výslovném potvrzení uživatele, platném oprávnění ke službě a úspěšné
          technické kontrole podporovaného připojení. Uživatel může stav řízení sledovat v aplikaci
          a může požádat o jeho vypnutí.
        </p>
        <div className="legal-callout">
          <strong>Při podezření na nebezpečný stav nečekejte na aplikaci.</strong>
          <p>
            Postupujte podle bezpečnostních pokynů výrobce, instalační firmy a provozovatele
            distribuční soustavy. Spottex nenahrazuje havarijní ochrany střídače ani odborný servis.
          </p>
        </div>
        <p>
          Uživatel nesmí Spottexu posílat hesla e-mailem. Přihlašovací údaje k SolaX Cloudu se
          zadávají pouze v zabezpečeném formuláři aplikace; způsob jejich zpracování popisují
          zásady ochrany osobních údajů.
        </p>
      </section>

      <section id="dostupnost">
        <p className="legal-section-number">06</p>
        <h2>Dostupnost, údržba a služby třetích stran</h2>
        <p>
          Spottex vyvíjí přiměřené úsilí k bezpečné a spolehlivé dostupnosti služby. Krátkodobé
          omezení může nastat zejména při údržbě, aktualizaci, výpadku internetu, cloudové služby,
          platební brány, energetického datového zdroje nebo rozhraní výrobce.
        </p>
        <p>
          Funkce závislé na SolaX Cloudu, cenových datech, e-mailu, kalendáři nebo platební bráně
          mohou být dočasně nedostupné z důvodu na straně jejich provozovatele. Spottex takové
          rozhraní může změnit nebo nahradit, pokud zachová podstatný účel služby. O plánované
          podstatné změně nebo odstávce informuje uživatele přiměřeným způsobem.
        </p>
        <p>
          Aktualizace nutné pro zachování bezpečnosti a funkčnosti poskytujeme po dobu trvání
          smlouvy. Uživatel je povinen udržovat aktuální svůj prohlížeč, kontaktní údaje a firmware
          zařízení, pokud jej k tomu vyzve výrobce nebo Spottex s vysvětlením následků neprovedení.
        </p>
      </section>

      <section id="ukonceni">
        <p className="legal-section-number">07</p>
        <h2>Odstoupení spotřebitele a ukončení služby</h2>
        <p>
          Spotřebitel může od smlouvy uzavřené na dálku odstoupit ve lhůtě 14 dnů od jejího
          uzavření, pokud zákon nestanoví výjimku. Oznámení může zaslat jednoznačným prohlášením
          na <a href={`mailto:${email}`}>{email}</a>; uvede e-mail účtu a objednanou službu.
        </p>
        <p>
          Požádá-li spotřebitel výslovně o zahájení placené služby před uplynutím této lhůty,
          může při odstoupení hradit poměrnou část již poskytnutého plnění, dovoluje-li to zákon.
          O případné ztrátě práva na odstoupení v zákonem stanovené situaci bude před objednávkou
          zvlášť poučen a jeho výslovný souhlas zaznamenáme.
        </p>
        <p>
          Uživatel může předplatné ukončit v účtu nebo e-mailem. Není-li u objednávky uvedeno
          jinak, ukončení působí ke konci již uhrazeného nebo probíhajícího vyhodnocovaného období.
          Tím nejsou dotčena zákonná práva z vadného plnění ani právo na vrácení částky, vyžaduje-li je zákon.
        </p>
        <p>
          Spottex může službu omezit nebo ukončit při závažném porušení podmínek, ohrožení
          bezpečnosti, neoprávněném připojení elektrárny nebo dlouhodobém neuhrazení splatné ceny.
          Není-li nutný okamžitý zásah, poskytne uživateli přiměřenou lhůtu k nápravě.
        </p>
      </section>

      <section id="vady">
        <p className="legal-section-number">08</p>
        <h2>Práva z vad a reklamace</h2>
        <p>
          Služba je vadná zejména tehdy, pokud neodpovídá dohodnutému popisu, rozsahu,
          funkčnosti, kompatibilitě nebo bezpečnostním aktualizacím. Za vadu Spottexu se nepovažuje
          problém způsobený nekompatibilním či vadným zařízením, chybnými vstupy uživatele,
          výpadkem služby třetí strany nebo neprovedenou aktualizací, na jejíž nutnost a následky
          byl uživatel řádně upozorněn.
        </p>
        <p>
          Reklamaci lze uplatnit na <a href={`mailto:${email}`}>{email}</a>. Uživatel uvede e-mail
          účtu, popis projevu, přibližný čas, dotčenou elektrárnu a podle povahy věci číslo platby
          nebo faktury. Vhodné je přiložit snímek obrazovky; nikdy se neposílá heslo ani přístupový token.
        </p>
        <p>
          Přijetí reklamace potvrdíme a můžeme požádat o přiměřenou diagnostickou součinnost.
          Vadu digitální služby odstraníme v přiměřené době s ohledem na její povahu a účel.
          Tam, kde právní předpis stanoví jinou závaznou lhůtu, postupujeme podle ní. Spotřebitele
          informujeme o výsledku, způsobu vyřízení a případném odůvodnění zamítnutí.
        </p>
        <p>
          Je-li reklamace oprávněná, uvedeme službu do souladu bezplatně a bez značných obtíží.
          Není-li to možné, Spottex nápravu odmítne, vada se opakuje nebo jde o podstatnou vadu,
          může spotřebitel za zákonných podmínek požadovat přiměřenou slevu nebo od smlouvy odstoupit.
        </p>
        <p>
          Rezervovanou konzultaci lze změnit nebo zrušit odkazem v potvrzovacím e-mailu,
          zpravidla nejpozději dvě hodiny před začátkem. Výhradu k platbě nebo průběhu konzultace
          lze uplatnit stejným kontaktním postupem.
        </p>
      </section>

      <section id="odpovednost">
        <p className="legal-section-number">09</p>
        <h2>Odpovědnost, stížnosti a řešení sporů</h2>
        <p>
          Spottex neodpovídá za rozhodnutí učiněná pouze na základě informativní simulace ani za
          zásah do zařízení provedený uživatelem nebo třetí osobou v rozporu s dokumentací.
          Zákonnou odpovědnost za škodu způsobenou porušením povinností Spottexu ani práva
          spotřebitele nelze těmito podmínkami vyloučit nebo omezit v rozporu s právem.
        </p>
        <p>
          Podnikateli Spottex v maximálním rozsahu dovoleném zákonem nehradí nepřímou nebo
          následnou škodu, ušlý zisk či přerušení provozu způsobené okolností mimo rozumnou kontrolu
          Spottexu. Toto omezení se nepoužije při úmyslu, hrubé nedbalosti ani tam, kde jej zákon nepřipouští.
        </p>
        <p>
          Stížnost se zasílá na <a href={`mailto:${email}`}>{email}</a>. Vznikne-li mezi Spottexem
          a spotřebitelem spor z této digitální služby, který se nepodaří vyřešit dohodou, může
          spotřebitel podat návrh na mimosoudní řešení u České obchodní inspekce, Ústřední
          inspektorát – oddělení ADR, Gorazdova 1969/24, 120 00 Praha 2, e-mail adr@coi.gov.cz,
          web <a href="https://coi.gov.cz/informace-o-adr/" target="_blank" rel="noreferrer">coi.gov.cz/informace-o-adr</a>.
        </p>
        <p>
          Evropská platforma ODR byla ukončena, a proto na ni tyto podmínky neodkazují.
          Dozorové a rozhodovací pravomoci jiných orgánů, zejména Úřadu pro ochranu osobních
          údajů nebo Energetického regulačního úřadu v rozsahu jejich zákonné působnosti, tím nejsou dotčeny.
        </p>
      </section>

      <section id="zaver">
        <p className="legal-section-number">10</p>
        <h2>Doručování a závěrečná ustanovení</h2>
        <p>
          Oznámení související s účtem, objednávkou, platbou, bezpečností nebo změnou služby
          doručujeme na e-mail uvedený v účtu a případně také přímo v aplikaci. Uživatel odpovídá
          za aktuálnost kontaktní adresy.
        </p>
        <p>
          Právní vztahy se řídí právem České republiky. Spotřebitel tím není zbaven ochrany,
          kterou mu poskytují kogentní ustanovení práva státu jeho obvyklého bydliště.
          Neplatnost nebo neúčinnost jednotlivého ustanovení nemá vliv na ostatní části podmínek.
        </p>
        <p>
          Spottex může podmínky přiměřeně změnit při rozšíření služby, změně cenového modelu,
          technologií nebo právních požadavků. Nové znění se použije na smlouvy a období uzavřené
          po dni jeho účinnosti; u trvající služby oznámíme podstatnou změnu předem a sdělíme možnost ukončení.
        </p>
        <p>
          Aktuální znění je dostupné na této stránce. Dotazy k podmínkám posílejte na
          {" "}<a href={`mailto:${email}`}>{email}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
