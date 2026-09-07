# Co platforma Spottex potřebuje od katalogu Costs pro energetické tarify

Datum 2026-09-07. Sepsáno po prvním úplném srovnání tarifů v produkci
(FVE Saffronela, domácnost) a po pokusu spočítat totéž pro dvě mateřské školy
(MŠ Větrník, MŠ Pohádka), které jsou firemní odběr na sazbě C02d s jističem
3×100 A. Domácnost srovnání dostala, školky ne. Tento dokument říká přesně proč
a co má katalog indexovat, aby to šlo.

Kontrakt na straně platformy: `src/lib/costs/catalog-sync.ts` čte
`api/v1/catalog/products` (kinds `ENERGY_SUPPLY`, `ENERGY_DISTRIBUTION`) a
`api/v1/documents?id=…`, bere jen položky se stavem VERIFIED a přepočítává ceny
bez DPH na ceny včetně DPH (×1,21). Platforma nikdy nedoplňuje chybějící fakta
odhadem: co v katalogu není, do srovnání nevstoupí.

## Na co se zaměřit (pořadí podle dopadu)

1. **Vrátit energetické tarify do scope** (kap. 1). Bez toho platforma nedostane
   nic, ať je katalog jakkoli úplný.
2. **Distribuční sazby kompletně**: všechny D i C sazby pro ČEZ Distribuce,
   EG.D a PREdistribuce, každá s úplnou tabulkou jističů do 3×160 A a
   s **počtem hodin nízkého tarifu za den** (kap. 3 a 4). Distribuční sazba
   dělá u řízení baterie největší rozdíl, protože určuje okna nízkého tarifu;
   bez počtu hodin NT platforma nemůže dvoutarifovou sazbu nasimulovat.
3. **Dodavatelské produkty pro podnikatele** (kap. 2) a u všech produktů
   seznam sazeb, se kterými lze produkt sjednat.
4. **POZE podle jističe** (kap. 4), aby roční náklady nebyly podhodnocené.
5. Ověřený zdrojový dokument u každé položky; jeden průchod XLSX z ERÚ
   pokryje všechny distribuční sazby roku 2026 (kap. 5).

Stav na straně platformy k 7. 9.: C02d a dalších devět C-sazeb ČEZ (C01d,
C03d, C25d, C26d, C27d, C35d, C45d, C46d, C56d) je doplněno ručně z výměru
ERÚ 14/2025 jako ověřené verze, protože školky jinak neměly co porovnávat.
Očekávaný cílový stav je, že totéž přijde z Costs a ruční verze se nahradí.

## 1. Energetické tarify jsou od 28. 8. mimo scope

V Costs DB mají všechny položky `ENERGY_SUPPLY` (226) a 65 z 66 položek
`ENERGY_DISTRIBUTION` `scopeStatus = OUT_OF_SCOPE` (scope policy release
catalog-ideal-v37). API v1 proto vrací 0 položek a platforma drží katalog
z 24. 8. (25 produktů, 5 distribučních sazeb).

Požadavek: energetické tarify (dodávka i distribuce) vrátit do scope a nechat
je tam. Pro platformu jsou to nejdůležitější položky celého katalogu.

## 2. Chybí firemní odběr (kategorie C)

Katalog obsahuje jen domácnostní produkty a sazby D01d, D02d, D25d, D26d,
D27d (`customerSegment = HOUSEHOLD`). Firemní zákazníci (školky, obce, malé
firmy) mají sazby C01d–C62d a jiné dodavatelské produkty; nic z toho v katalogu
není, takže pro ně platforma neumí říct „nejvýhodnější dodavatel a sazba“.

Požadavek, distribuce: pro ČEZ Distribuce, EG.D a PREdistribuce indexovat
sazby C01d, C02d, C03d, C25d, C26d, C27d, C35d, C45d, C46d, C55d, C56d, C62d
(a případně C60d) se všemi složkami z cenového výměru ERÚ č. 14/2025
(viz zdroje). `customerSegment = BUSINESS`.

Požadavek, dodávka: produkty pro podnikatele (nákup FIX i SPOT, výkup FIX i
SPOT) alespoň od ČEZ Prodej, E.ON, PRE, Centropol, innogy, Tedom, Enerspot,
bezDodavatele, Nano Energies. U každého: cena silové elektřiny VT/NT nebo
formule spot + přirážka, stálý měsíční plat, seznam sazeb, se kterými lze
produkt sjednat, platnost, zdrojový dokument.

## 3. Tabulky jističů končí u 3×63 A

Domácnostní sazby mají v `specValues.breakerFees` klíče `3x10` … `3x63`.
Cenový výměr ERÚ jde do `3x160` a nad to stanoví cenu za každý 1 A. Pro
odběrné místo s jističem 3×100 A (obě školky) proto každá kombinace tarifů
selže na chybějící platbě za jistič a srovnání nevznikne.

Požadavek: u každé distribuční sazby (D i C) uvést všechna pásma z výměru:
`1x25`, `3x10`, `3x16`, `3x20`, `3x25`, `3x32`, `3x40`, `3x50`, `3x63`,
`3x80`, `3x100`, `3x125`, `3x160` v Kč/měsíc bez DPH, plus dvě hodnoty pro
odběr nad pásma: `perAmpereAbove3x160` a `perAmpereAbove1x25` v Kč/A/měsíc.
Klíč je horní mez pásma (tak to platforma už čte).

U dvoutarifových sazeb navíc uvést `lowTariffHoursPerDay` (počet hodin
nízkého tarifu denně podle výměru: D25d/D26d/D27d/C25d/C26d/C27d 8 h,
D35d/C35d, D45d/C45d/C46d, D56d/D57d/C56d 20 h pro rok 2026) a stručnou
podmínku způsobilosti (akumulace, přímotop, tepelné čerpadlo, elektromobil),
aby platforma věděla, které sazby může nabídnout jen po potvrzení zákazníkem.

## 4. Regulované složky, které se nemění se sazbou

Platforma je čte z distribuční verze. Očekává (Kč/kWh bez DPH, platforma
násobí 1,21):

- `systemServicesCzkKwh`: cena za systémové služby (výměr 13/2025 bod 3.1.1,
  pro 2026 164,24 Kč/MWh),
- `electricityTaxCzkKwh`: daň z elektřiny 28,30 Kč/MWh (zákon č. 261/2007 Sb.),
- `monthlyMeterFeeCzk`: cena za provoz nesíťové infrastruktury, tj. činnosti
  OTE + datové centrum + poplatek ERÚ (výměr 13/2025 bod 6.2), Kč/OM/měsíc,
- `pozeCzkKwh` a nově `pozeCzkPerAmpereMonth`: složka na podporu POZE je pro
  NN 8,32 Kč/A/měsíc podle jističe (výměr 13/2025 bod 5.1.2, trojfázově
  trojnásobek, strop podle zákona). Dnes je v katalogu 0 a platforma ji
  nemodeluje; potřebujeme ji indexovat, aby roční náklady nebyly podhodnocené.

## 5. Zdroje, které stačí na celý rok 2026

- Cenový výměr ERÚ č. 14/2025 (ceny za související službu v elektroenergetice
  odběratelům ze sítí NN), Energetický regulační věstník 18/2025:
  https://eru.gov.cz/sites/default/files/obsah/prilohy/erv182025.pdf
  (SHA-256 5c8364a4630ac5d40bd3e7fca7d2b9a7cda39557633581f3a1bc401032b205a0).
  Strojově čitelná příloha se všemi NN sazbami a distributory:
  https://eru.gov.cz/sites/default/files/obsah/prilohy/ceny-nn26-1.xlsx
  (SHA-256 ca2948ae156708fa5a340000577b912e10cc92de973de10deb8a215bd46af480).
- Cenový výměr ERÚ č. 13/2025 (systémové služby, POZE, nesíťová
  infrastruktura), věstník 17/2025:
  https://eru.gov.cz/sites/default/files/obsah/prilohy/erv172025.pdf
  (SHA-256 a69125ea10b727d1fae87efd154e4f52ea6a8d8b47b57bf74bc95b0370603160).
- Změnový výměr č. 1/2026 (věstník 2/2026):
  https://eru.gov.cz/sites/default/files/obsah/prilohy/erv022026.pdf.

Jeden průchod XLSX dá všechny distribuční sazby (D i C) pro ČEZ, EG.D, PRE,
UCED a SV včetně kompletních tabulek jističů. Platforma si dnes musela C02d
ČEZ doplnit ručně z PDF (verze 66 v `tariff.distribution_tariff_version`);
očekávaný stav je, že totéž přijde z Costs jako VERIFIED položka.

## 6. Kontrakt API, na kterém platforma závisí

- `api/v1/documents` vyžaduje `?id=`; platforma ho už nevolá bez id, ale
  odpověď musí vracet stejný `contentSha256` a `sourceUrl`, jinak se verze
  založí znovu.
- Položka je použitelná jen jako VERIFIED s přiloženým zdrojovým dokumentem
  (PDF nebo XLSX), s `validFrom` a ideálně `validTo`.
- U dodavatelských produktů potřebuje platforma pole `supportedDistributionCodes`
  (se kterými sazbami lze produkt sjednat) a `customerSegment`; bez nich se
  produkt páruje jen na domácnostní D-sazby.
- Ceny vždy bez DPH v Kč/kWh nebo Kč/MWh s uvedenou jednotkou; platforma
  přepočítává sama.

## 7. Co se po splnění změní v platformě

Bez zásahu do kódu: sync katalogu položky převezme, materializace vytvoří
kombinace nákup × výkup × sazba i pro firemní odběr a školky dostanou stejné
srovnání jako domácnost. Jediná změna v kódu bude čtení `customerSegment`
zákazníka při výběru katalogových kombinací (dnes je srovnávací sada
napevno domácnostní).
