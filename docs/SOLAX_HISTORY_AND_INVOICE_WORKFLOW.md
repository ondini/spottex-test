# Historie SolaX a zpracování vstupních faktur

Tento dokument popisuje zákaznický průchod, provozní stavy a diagnostiku dvou
asynchronních procesů: roční historie SolaX a vytěžení údajů z faktur.

## SolaX: od připojení k automatické analýze

Po výběru elektrárny vznikne pro každý její střídač jeden import. Roční okno je
rozdělené na 20denní bloky, tedy obvykle 19 bloků na střídač. Dashboard sčítá
bloky všech střídačů stejné elektrárny; více střídačů se proto nesmí tvářit jako
jeden ani se jejich výroba nesmí duplikovat.

Stavy importu:

| Stav | Význam pro uživatele |
| --- | --- |
| `QUEUED` / `RUNNING` | Bloky čekají nebo se stahují; dashboard obnovuje stav každých 8 sekund. |
| `COMPLETED` | Všechny bloky skončily bez chyby. Dostatečnost naměřených intervalů pro analýzu se vyhodnocuje zvlášť. |
| `PARTIAL` | Část historie je použitelná, část bloků selhala. |
| `FAILED` | Není k dispozici žádný použitelný blok; UI musí ukázat chybu, ne nekonečné 0 %. |

Platforma volá šifrovaný a autentizovaný endpoint `/history_intervals`.
Produkční Compose předává `SPOTTEX_LEGACY_HISTORY_PATH`, přičemž bezpečný
výchozí path je přímo v klientovi. Tím se import nerozbije pouhým vynecháním
volitelného řádku v hostitelském `.env.production`.

Obnovený access/refresh token se ukládá i tehdy, když SolaX cache ještě
nepřipravila požadovaný historický interval. Rotující refresh token se tím
neztratí mezi opakovanými pokusy a import nevyžaduje nové připojení účtu.
Prázdný starší blok se považuje za skutečně prázdný bez dalších odkladů, jakmile
už některý pozdější blok stejného měniče prokazatelně obsahuje naměřená data.
Producent historie má omezený connect/read timeout a jeho periodický updater
uzavírá databázovou transakci před každým pomalejším SolaX HTTP voláním. Rotace
tokenu z paralelního Celery úkolu tak nečeká na zámek řádku předchozího měniče.

Po uzavření celé dávky se automaticky vytvoří základní analýza, pokud je
historie dostatečná a profil obsahuje výkon FVE a kapacitu baterie. Odklad nebo
chyba se zapisuje do auditu jako `ENERGY_BASE_ANALYSIS_AUTO_DEFERRED`; úspěšné
zařazení jako `ENERGY_BASE_ANALYSIS_AUTO_QUEUED`.

U elektrárny s více střídači se kvalita počítá pouze z 15minutových okamžiků,
ve kterých mají všechny střídače zároveň výrobu i spotřebu. První orientační
odhad vyžaduje nejméně sedm ekvivalentních dní, alespoň 75% pokrytí časového
rozsahu a validní energetickou bilanci. Dokončený download proto nemusí znamenat
spuštěnou analýzu: skutečné mezery v cloudu se nevyplňují vymyšlenými hodnotami
a přesný důvod odkladu zůstane v auditu.

### Diagnostika SolaX

1. Ověřit agregovaný stav `energy_history_import` a jednotlivé
   `energy_history_import_chunk`, zejména `lastError`, `attempts` a navázaný
   `scheduled_job`.
2. Ověřit, že kontejner aplikace skutečně obsahuje
   `SPOTTEX_LEGACY_HISTORY_PATH=/history_intervals`.
3. HTTP 503 s informací o přípravě historie je dočasný stav backendového
   backfillu a má exponenciální retry. Chybějící konfigurace endpointu není
   dočasný stav a nesmí se skrývat jako nekonečný progress.
4. Pokud download stojí po obnově autorizace, ověřit čekající databázové zámky
   nad řádkem `general.inverters`; updater nesmí držet transakci během síťového
   volání. Každé historické HTTP volání musí mít konečný timeout.
5. Po prvním úspěšném bloku ověřit růst `succeededChunks`, `importedPoints` a
   počet měřených intervalů. Po dokončení ověřit vznik `EnergyAnalysisRun` nebo
   konkrétní důvod odkladu v auditu.

## Faktury: upload, parser, kontrola a uložení

Zákazník může v jednom zpracování vybrat jednu až tři faktury (PDF, JPG nebo
PNG, nejvýše 10 MB každý soubor). Limit je vynucený transakčně na serveru, ne
jen atributem ve formuláři.

Zákaznický průchod:

1. **Nahrávání:** prohlížeč zobrazuje skutečný přenesený počet bajtů a procenta.
2. **Vytěžování:** každý dokument má samostatný stav `QUEUED`, `PARSING`,
   `READY` nebo `FAILED`; stránka stav načítá každé dvě sekundy a ukazuje počet
   hotových dokumentů.
3. **Sloučení:** neprázdná pole ze všech úspěšných dokumentů se spojí. Novější
   faktura doplní nebo nahradí starší hodnotu; odlišné neprázdné hodnoty se
   označí jako konflikt.
4. **Kontrola:** dialog ukáže hodnoty, fakturační období, varování a pro každé
   pole důkaz, jistotu a zdrojový soubor. Nic se v této fázi nezapisuje do
   profilu.
5. **Potvrzení:** zákazník může hodnoty opravit a tlačítkem „Uložit do odběrného
   místa“ vytvoří manuálně potvrzenou verzi. Evidence dostane zdroj `INVOICE`,
   čas potvrzení a ID potvrzujícího vlastníka.

Pole zahrnují EAN, adresu, distributora, sazbu, jistič, dodavatele, produkt,
způsob nákupu/výkupu, stálý měsíční plat, fixní nebo spotové ceny a platnost
fixace. Cena silové elektřiny je normalizovaná na Kč/kWh včetně DPH pouze z
jednoznačně doložených údajů. Průměrná celková cena včetně distribuce nesmí být
zaměněna za cenu silové elektřiny.

### Stavové a bezpečnostní záruky

- Dokument je v databázi šifrovaný a číst jej smí jen vlastník nebo administrátor.
- Parser dostane vždy jen jeden dešifrovaný dokument, bez databázového přístupu.
- Koordinátor pokračuje druhým a třetím dokumentem i po dokončení prvního.
- Selhání parseru má marker konkrétní verze a nezpůsobí nekonečnou placenou smyčku.
- Nová revize schématu může znovu zpracovat starší návrh bez mazání auditní historie.
- Potvrzovací API vždy kontroluje vlastnictví odběrného místa a přijme jen ID
  dokumentů, které patří k aktuálnímu požadavku a mají validní návrh.

### Diagnostika faktur

1. `RECEIVED` znamená bezpečně uložený soubor; `PROCESSING` aktivní parser;
   `NEEDS_INPUT` připravenou kontrolu nebo bezpečně zachycené selhání.
2. U každého dokumentu ověřit `extractionVersion` a odpovídající
   `energy_invoice_extraction`. Nečíst obsah dokumentu do aplikačních logů.
3. Auditní posloupnost pro úspěch je `ENERGY_INVOICE_DOCUMENT_UPLOADED`,
   `ENERGY_INVOICE_AI_CLAIMED`, `ENERGY_INVOICE_AI_DRAFT_CREATED` a po potvrzení
   `ENERGY_INVOICE_CUSTOMER_CONFIRMED`.
4. Po potvrzení ověřit pole technického profilu a evidence se zdrojem `INVOICE`;
   změna cen musí zneplatnit starou cenovou křivku a staré výsledky analýzy.
