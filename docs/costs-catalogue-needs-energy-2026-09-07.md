# Specifikace: energetické tarify v katalogu Costs pro platformu Spottex

Verze 2026-09-08. Nahrazuje verzi ze 7. 9. (ta chybně uváděla ceny bez DPH).
Toto je přesný kontrakt, který čte `src/lib/costs/catalog-sync.ts` přes
`GET api/v1/catalog/products?kind=ENERGY_SUPPLY|ENERGY_DISTRIBUTION` a
`GET api/v1/documents?id=…`. Co v katalogu chybí nebo neodpovídá, platforma
tiše přeskočí (počítá jako `skippedIncomplete`); nic nedoplňuje odhadem.

## 0. Na co si dát pozor (shrnutí)

1. **Scope.** Položky `ENERGY_SUPPLY` a `ENERGY_DISTRIBUTION` musí být
   `IN_SCOPE`; od 28. 8. jsou všechny `OUT_OF_SCOPE` a API v1 vrací nulu.
2. **Ceny včetně DPH v Kč/kWh** a specValue `vatIncluded = true`. Platforma
   hodnoty nepřepočítává; verze bez `vatIncluded = true` se přeskočí.
3. **Ověření.** Verze musí mít `verificationStatus = "VERIFIED"` a její
   `sourceDocumentId` musí ukazovat na dokument se stavem `PUBLISHED`
   (PDF/XLSX ceníku s `contentSha256`). Bez toho se položka nepoužije.
4. **Kódy sazeb přesně podle ERÚ** (`D02D`, `C25D`, …, velkými písmeny, „D“
   na konci). Platforma z kódu odvozuje segment (D = domácnost, C = firma)
   a počet hodin nízkého tarifu; neznámý kód se přeskočí.
5. **Dodavatelský produkt = jeden směr.** `direction` je `BUY` nebo `SELL`;
   produkt, který je zároveň nákup i výkup, se zadává jako dvě položky.
6. **`distributionCodes` u dodavatelského produktu** je povinný seznam sazeb,
   se kterými lze produkt sjednat (platforma tvoří kombinaci produkt × sazba).
7. **Tabulka jističů úplná** (`3x10` … `3x160` + `1x25`), Kč/měsíc vč. DPH,
   klíč = horní mez pásma. Chybí‑li pásmo zákazníka, kombinace se nespočítá.
8. **Firemní odběr.** Sazby `C…` a dodavatelské produkty pro podnikatele dnes
   v katalogu nejsou; bez nich mají školky prázdné řádky Fix→spot a Spot→spot.

## 1. Společná pravidla

- Položka má `id`, `name`, `brand` (název dodavatele/distributora; platforma z
  něj tvoří firmu, „ČEZ Distribuce“ → `CEZ_DISTRIBUCE`, „E.ON“ → `EON`,
  „PRE“ → `PRE`), volitelně `metadata.supplier` / `metadata.distributor`.
- Bere se **první verze** položky (`versions[0]`): musí mít `validFrom`
  (ISO datum), volitelně `validTo`, `sourceDocumentId`, pole `specValues`.
- `specValues[]` = `{ key, valueNumber | valueText | valueBoolean | valueJson,
  unit, analysisAllowed }`. Hodnota s `analysisAllowed = false` se ignoruje.
- Dokument (`api/v1/documents?id=`): `id`, `title`, `sourceUrl` (https),
  `finalUrl`, `contentSha256` (64 hex), `fetchedAt`, `validFrom`, `validTo`,
  `status = PUBLISHED`. Platforma si ho archivuje pod
  `api/documents/{id}/download`; stejný `sourceUrl` + `contentSha256` = táž
  verze (nic se nezakládá znovu).

## 2. ENERGY_SUPPLY (dodavatelské produkty)

Povinné specValues:

| key | typ | hodnoty / jednotka | poznámka |
|---|---|---|---|
| `direction` | text | `BUY` / `SELL` | jeden směr na položku |
| `buyMode` | text | `FIX` / `SPOT` / `TIME_CURVE` | u `SELL` položky uveď režim, jakým dodavatel nakupuje (typicky shodný) |
| `sellMode` | text | `FIX` / `SPOT` / `TIME_CURVE` | u `BUY` položky analogicky |
| `distributionCodes` | json | `["D02D","D25D"]` | sazby, se kterými lze sjednat; platforma tvoří produkt pro každou |
| `vatIncluded` | boolean | `true` | jinak přeskočeno |
| `verificationStatus` | text | `VERIFIED` | jinak přeskočeno |
| `customerSegment` | text | `HOUSEHOLD` / `BUSINESS` | nový; když chybí, odvodí se z písmene sazby |

Cenové specValues (Kč/kWh vč. DPH, `valueNumber`):

| key | kdy | význam |
|---|---|---|
| `singleTariffBuyCzkKwh` | BUY, jednotarif (D01D/D02D/C01D…C03D) | cena silové elektřiny |
| `fixedBuyVtCzkKwh`, `fixedBuyNtCzkKwh` | BUY, `buyMode = FIX`, dvoutarif | VT / NT |
| `spotBuyFeeCzkKwh` | BUY, `buyMode = SPOT` | přirážka k ceně OTE (kladná) |
| `fixedSellVtCzkKwh`, `fixedSellNtCzkKwh` | SELL, `sellMode = FIX` | výkupní cena |
| `spotSellFeeCzkKwh` | SELL, `sellMode = SPOT` | srážka z ceny OTE (kladná) |
| `monthlyFeeCzk` | vždy | stálý měsíční plat, Kč/měs vč. DPH (0 pokud není) |

`TIME_CURVE` vyžaduje navíc `formula` (pravidla v čase); dnes ho nepoužíváme,
raději FIX/SPOT.

Příklad (výkup na spotu pro podnikatele):

```json
{"key":"direction","valueText":"SELL"},
{"key":"buyMode","valueText":"SPOT"},
{"key":"sellMode","valueText":"SPOT"},
{"key":"distributionCodes","valueJson":["C01D","C02D","C03D","C25D","C26D","C27D","C35D","C45D","C46D","C56D"]},
{"key":"customerSegment","valueText":"BUSINESS"},
{"key":"spotSellFeeCzkKwh","valueNumber":0.363,"unit":"CZK/kWh"},
{"key":"monthlyFeeCzk","valueNumber":0,"unit":"CZK/month"},
{"key":"vatIncluded","valueBoolean":true},
{"key":"verificationStatus","valueText":"VERIFIED"}
```

Priorita dodavatelů pro firemní odběr: ČEZ Prodej, E.ON, PRE, Centropol,
innogy, Tedom, Enerspot, bezDodavatele, Nano Energies — vždy nákup FIX i SPOT
a výkup FIX i SPOT, pokud je dodavatel nabízí.

## 3. ENERGY_DISTRIBUTION (distribuční sazby)

Jedna položka = jedna sazba jednoho distributora (`brand` = distributor).
Povinné specValues (Kč/kWh resp. Kč/měs vč. DPH):

| key | typ | poznámka |
|---|---|---|
| `distributionCode` | text | přesný kód ERÚ, např. `C25D` |
| `distributionVtCzkKwh` | number | cena za distribuované množství ve VT |
| `distributionNtCzkKwh` | number | v NT; u jednotarifu stejná hodnota jako VT |
| `systemServicesCzkKwh` | number | systémové služby (výměr 13/2025 bod 3.1.1: 164,24 Kč/MWh bez DPH → 0,19873 vč. DPH) |
| `electricityTaxCzkKwh` | number | daň z elektřiny 28,30 Kč/MWh → 0,03424 vč. DPH |
| `pozeCzkKwh` | number | dnes 0; složka POZE je podle jističe, viz níže |
| `monthlyMeterFeeCzk` | number | činnosti OTE + datové centrum + poplatek ERÚ, Kč/OM/měs vč. DPH (2026: 15,57) |
| `breakerFees` | json | `{"1x25":174.24,"3x10":174.24,"3x16":279.51,…,"3x160":2793.89,"perAmpereAbove3x160":17.46,"perAmpereAbove1x25":5.82}` Kč/měs vč. DPH |
| `vatIncluded` | boolean | `true` |
| `verificationStatus` | text | `VERIFIED` |

Doporučené navíc: `pozeCzkPerAmpereMonth` (8,32 Kč/A/měs bez DPH podle výměru
13/2025 bod 5.1.2; platforma ho zatím nečte, ale připraví se na něj).

Rozsah: pro ČEZ Distribuce, EG.D a PREdistribuce všechny sazby D01D, D02D,
D25D, D26D, D27D, D35D, D45D, D56D, D57D, D61D a C01D, C02D, C03D, C25D, C26D,
C27D, C35D, C45D, C46D, C56D, C62D s platností od 1. 1. 2026.

## 4. Zdroje pro rok 2026

- Cenový výměr ERÚ č. 14/2025 (sazby NN), věstník 18/2025:
  https://eru.gov.cz/sites/default/files/obsah/prilohy/erv182025.pdf
  (SHA-256 5c8364a4630ac5d40bd3e7fca7d2b9a7cda39557633581f3a1bc401032b205a0).
  Strojově čitelná příloha se všemi sazbami a distributory:
  https://eru.gov.cz/sites/default/files/obsah/prilohy/ceny-nn26-1.xlsx
  (SHA-256 ca2948ae156708fa5a340000577b912e10cc92de973de10deb8a215bd46af480).
- Cenový výměr ERÚ č. 13/2025 (systémové služby, POZE, nesíťová infrastruktura),
  věstník 17/2025: https://eru.gov.cz/sites/default/files/obsah/prilohy/erv172025.pdf
  (SHA-256 a69125ea10b727d1fae87efd154e4f52ea6a8d8b47b57bf74bc95b0370603160).
- Změnový výměr č. 1/2026: https://eru.gov.cz/sites/default/files/obsah/prilohy/erv022026.pdf.
- Dodavatelské ceníky: oficiální PDF dodavatele s datem platnosti; u spotu
  přirážka/srážka a stálý plat z ceníku, ne z marketingové stránky.

## 5. Co se stane po splnění

Sync běží každých 30 minut. Ověřené položky se objeví jako publikované verze
(`tariff.energy_product_version`, `tariff.distribution_tariff_version`),
srovnání se přepočítá při dalším běhu analýzy. Ručně doplněné C‑sazby ČEZ
(verze 66–75, zdroj ERÚ 14/2025) zůstanou vedle importovaných, dokud je
Costs nenahradí; pak je deaktivujeme.
