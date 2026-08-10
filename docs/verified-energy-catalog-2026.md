# Ověřený energetický katalog 2026

Stav k 3. 8. 2026: vyřešeno pro základní analýzu úspor.

Do zákaznického výpočtu se smějí dostat pouze verze, které mají v Costs i ve
Spottexu stav `PUBLISHED`, archivovaný zdroj a `verificationStatus=VERIFIED`.
Starý ukázkový bootstrap je ve výchozím stavu zablokovaný a jeho produkty jsou
v databázi neaktivní/archivované.

## Ověřené obchodní ceníky

- E.ON Elektřina výhodně PRO na 3 roky 6/26: fixní nákup, sazby D01d, D02d,
  D25d, D26d a D27d, oficiální PDF platné od 17. 6. 2026.
- PRE PROUD EKO 08/2026: fixní nákup pro stejné sazby, oficiální PDF platné
  od 1. 8. 2026.
- Enerspot Základní dodávka: spotový nákup OTE + 300 Kč/MWh + DPH,
  178 Kč/měsíc s DPH.
- Enerspot Základní výkup: spotový prodej OTE − 300 Kč/MWh, bez měsíčního
  poplatku.
- ČEZ výkup v tržním režimu 2026: OTE × kurz ČNB − 350 Kč/MWh.
- E.ON výkup výrobny bez licence: aktuální fixní výkup 200 Kč/MWh bez DPH.

Zvýhodněných 250 Kč/MWh u Enerspotu se nepoužívá, protože je podmíněno
konkrétním seznamem podporovaných řízení a Spottex na něm zatím není.

## Ověřené distribuční sazby

Pro území ČEZ Distribuce jsou zdrojově ověřené D01d, D02d, D25d, D26d a D27d,
včetně VT/NT, systémových služeb, daně z elektřiny, měsíčního poplatku a tabulky
jističů 3×10 A až 3×63 A. Zdroj je archivovaný ceník PRE, který obsahuje
regulované ceny ČEZ Distribuce pro rok 2026.

## Automatický tok dat

1. Costs archivuje zdroj a drží hodnotu s původem konkrétního pole.
2. Ruční publikace ověří povinné textové důkazy a označí dokument i verzi jako
   `VERIFIED`.
3. `npm run sync:catalog` ve Spottexu importuje pouze takto ověřené záznamy.
4. Spottex rozepíše nabídkové ceníky pro pět sazeb a vytvoří 30 publikovaných
   obchodních variant plus 5 distribučních variant.
5. Každý import zapíše audit `COSTS_VERIFIED_ENERGY_CATALOG_SYNCED`.

Aktuálně zůstává 18 starších nebo neúplných publikovaných položek Costs mimo
výpočet. Nejsou označené jako ověřené a synchronizace je záměrně přeskočí.
Spotové časové ceny nejsou součástí těchto ceníků; přicházejí automaticky z
backendové databáze OTE v Kč po převodu kurzem ČNB.
