# Sdílená datová platforma `costs` – specifikace ke schválení

Stav dokumentu: **návrh, bez realizace**  
Datum: 24. 7. 2026  
Budoucí umístění: `/home/shared/projects/costs`  
První spotřebitel: Spottex, následně další energetické a návrhové aplikace

Schválení rozsahu: **24. 7. 2026**  
Schválená realizace: samostatná interní platforma `costs` a oddělené napojení
Spottexu přes API.

## 1. Rozhodnutí, které se nyní schvaluje

Tento dokument určuje:

- co budeme automaticky dohledávat na internetu;
- jaké parametry budeme ukládat;
- jak oddělíme výrobek, nabídku, cenu, dostupnost a technickou kompatibilitu;
- jak budeme modelovat tarify, dotace a pravidla, která nejsou prostou tabulkou;
- jak často se mají zdroje kontrolovat;
- jak zajistíme dohledatelnost, kvalitu a opakovatelnost výpočtu;
- jak budou Spottex a další projekty data odebírat.

Tento krok **nezakládá repozitář, nespouští crawler a nemění Spottex**. Realizace
začne až po schválení rozsahu.

## 2. Cíl

Platforma má odpovědět na čtyři typy otázek:

1. **Kolik opatření dnes stojí?**
   Cena materiálu, zařízení, dopravy a nezbytného příslušenství, vždy s DPH i
   bez DPH a s datem pozorování.
2. **Lze opatření technicky navrhnout?**
   Například zda počet panelů ve stringu vyhoví napěťovému a proudovému rozsahu
   střídače, zda je baterie se střídačem kompatibilní nebo zda montážní systém
   odpovídá krytině a zatížení.
3. **Kolik opatření ušetří?**
   Výpočet z měření, cen energií, účinností a provozních omezení.
4. **Na jakou podporu má zákazník nárok?**
   Strojově vyhodnotitelné podmínky programu, výše podpory, kombinovatelnost a
   požadované doklady.

Výstupem nebude pouze vyhledávač produktů. Bude to verzovaný datový základ pro:

- jednoklikovou analýzu úspor;
- technický návrh;
- položkový rozpočet materiálu;
- porovnání variant;
- dotační rozhodovací strom;
- audit, z jakých cen a předpokladů výpočet vznikl.

`costs` není součást Spottex webu. Má vlastní databázi, archiv, plánovač úloh,
interní API a lokální administrační web. Spottex, Apollon, Life Reno a další
projekty jsou samostatní klienti a nečtou databázi `costs` přímo.

Lokální web `costs` musí umožnit procházet katalogy i provoz platformy:

- naplánované a poslední běhy jednotlivých zdrojů;
- datum posledního úspěšného načtení a očekávané další spuštění;
- čerstvost, úplnost a spolehlivost dat;
- originální dokument, jeho hash a umístění v archivu;
- URL, stránku/tabulku/buňku nebo selektor zdrojového údaje;
- všechny extrakce, transformace, dedukce a použité modely;
- rozdíl mezi verzemi;
- frontu záznamů čekajících na lidské potvrzení;
- historii rozhodnutí uživatele a publikace.

## 3. Co do služby nyní nepatří

- ceny práce získávané z historických realizací;
- samostatný servis pro dotazování měst a získávání položkových rozpočtů;
- projektování nahrazující autorizovaného projektanta nebo statika;
- automatické tvrzení, že zákazník má právní nárok na dotaci;
- obcházení přihlášení, robots.txt, podmínek služeb nebo ochrany proti botům;
- osobní údaje zákazníků, přihlašovací údaje a tokeny externích služeb;
- živé řízení elektrárny.

Ceny práce bude možné v budoucnu připojit jako další, oddělený zdroj. Datový
model s tím má počítat, ale první služba je nebude sbírat.

## 4. Zásadní pravidlo: fakt, odvození a předpoklad nejsou totéž

Každá hodnota musí mít jeden z původů:

| Původ | Význam | Příklad |
|---|---|---|
| `MEASURED` | změřeno na konkrétní instalaci | čtvrthodinový odběr |
| `SOURCE_FACT` | uvedeno v primárním zdroji | baterie 23 kWh ze SolaX |
| `CATALOG_FACT` | uvedeno v katalogovém listu modelu | max. proud MPPT |
| `DERIVED` | vypočteno z doložených hodnot | počet panelů ve stringu |
| `USER_CONFIRMED` | zákazník údaj potvrdil | hlavní jistič 3×25 A |
| `MODEL_ASSUMPTION` | dočasný scénářový předpoklad | 3×25 A, pokud jistič neznáme |

U každé hodnoty se uloží:

- hodnota, jednotka a případné toleranční pásmo;
- původ a zdroj;
- okamžik zjištění;
- období platnosti;
- metoda odvození;
- míra jistoty;
- příznak, zda je hodnota dovolena pro informativní analýzu, nebo i pro řízení.

Chybějící fakt se nesmí tiše přepsat defaultem. API vrátí fakt a modelový
předpoklad odděleně.

## 5. Rozsah katalogů a pořadí realizace

### P0 – nutné pro Spottex a výpočet úspor

1. obchodní ceníky elektřiny a výkupu;
2. regulované distribuční ceny, sazby a podmínky;
3. spotové a referenční tržní ceny;
4. fotovoltaické panely;
5. střídače;
6. baterie a bateriové systémy;
7. dotační a zvýhodněné finanční programy;
8. verze modelových předpokladů pro výpočty.

### P1 – nutné pro technický návrh a materiálový rozpočet

1. montážní systémy pro FVE;
2. elektroinstalační „balance of system“;
3. tepelná čerpadla;
4. elektrokotle, kotle a lokální zdroje tepla;
5. zateplení a certifikované ETICS skladby;
6. okna, dveře a další výplně otvorů;
7. řízené větrání a rekuperace;
8. osvětlení;
9. stínicí technika;
10. příprava teplé vody;
11. měření, regulace a energetický management.

### P2 – rozšíření úplného energetického posouzení

- solární termika;
- akumulace tepla;
- chlazení;
- nabíjení elektromobilů;
- kogenerace;
- malé větrné a vodní zdroje;
- využití dešťové a odpadní vody, pokud je součástí dotačního balíčku;
- stavební materiály související s dílčími energetickými opatřeními.

## 6. Katalogy a povinná data

### 6.1 Obchodní produkty elektřiny

#### Identifikace

- dodavatel, produkt, varianta a zákaznický segment;
- domácnost, podnikatel, obec, SVJ/BD a velkoodběr;
- distribuční území a podporované distribuční sazby;
- fixace, datum počátku a konce platnosti;
- podmínky uzavření, výpověď, sankce a automatické prodloužení;
- zdrojový dokument a přesné místo v dokumentu.

#### Cena odběru

- cena silové elektřiny ve VT a NT;
- spotová formule, index, časová granularita a přirážka;
- stálý měsíční plat;
- jednorázové poplatky;
- bonusy, slevy, podmíněné slevy a délka jejich platnosti;
- DPH, měna a jednotka;
- minimální odběr, pásma spotřeby a nelineární pravidla.

#### Výkup a přetok

- pevný nebo spotový výkup;
- odečet poplatku obchodníka;
- strop, zápočet proti odběru, virtuální baterie;
- povinný odběr u stejného dodavatele;
- limity ročního přetoku;
- odpovědnost za odchylku;
- licenční a výrobní omezení.

Nelineární produkt bude uložen jako pravidlo/formule, nikoliv zkreslen jako
jedna cena za kWh.

### 6.2 Regulovaná distribuce

- distributor a území;
- kategorie zákazníka;
- distribuční sazba a podmínky jejího přiznání;
- platba za VT a NT;
- stálá platba za jistič podle počtu fází a proudu;
- platby za rezervovaný příkon nebo maximální výkon;
- systémové služby, nesíťová infrastruktura, daň a POZE;
- pravidla pro výrobnu, přetok, sdílení a bezdodávkový režim;
- počet hodin NT a pravidla HDO;
- datum účinnosti a všechny následné změnové výměry.

Čas HDO není vlastnost sazby typu „vždy 22–05“. Skutečný čas je vlastnost
konkrétního odběrného místa/povelu a může se měnit. Katalog proto ukládá:

- nárokovaný počet hodin NT podle sazby;
- oficiální rozvrh, pokud jej lze získat pro konkrétní HDO;
- samostatný modelový rozvrh pro citlivostní analýzu.

### 6.3 Tržní a referenční ceny

- OTE denní a vnitrodenní trh;
- časový interval, časová zóna a pravidla změny času;
- původní cena v EUR/MWh a používaná cena v CZK/MWh;
- použitý kurz a jeho zdroj;
- záporné ceny a cenové limity;
- verze opravy dat;
- indikativní nabídkové ceny ERÚ;
- volitelně dlouhodobé kontrakty, pokud je dovoleno jejich licenční užití.

Časová řada musí zachovat 23hodinové a 25hodinové dny. Výpočet nesmí slepovat
duplicitní lokální čas při přechodu na zimní čas.

### 6.4 Fotovoltaické moduly

#### Elektrické parametry

- výkon při STC a tolerance výkonu;
- `Voc`, `Isc`, `Vmp`, `Imp`;
- teplotní koeficienty výkonu, napětí a proudu;
- NOCT/NMOT a parametry při NMOT;
- maximální systémové napětí;
- maximální sériová pojistka;
- účinnost modulu;
- bifacialita a bifaciální faktor;
- degradační křivka.

#### Mechanické a provozní parametry

- rozměry, tloušťka, hmotnost;
- typ článku, počet článků, sklo/fólie/sklo-sklo;
- rám a povolené upínací zóny;
- konektory a délky kabelů;
- statické zatížení sněhem a větrem;
- požární třída, IP a certifikace;
- provozní teploty;
- produktová a výkonová záruka.

#### Nabídka

- prodejce, cena s DPH/bez DPH, doprava;
- měrná cena Kč/Wp;
- skladová dostupnost, počet kusů, minimální odběr;
- stav produktu: nový, doprodej, ukončený;
- datum pozorování a odkaz na konkrétní nabídku.

### 6.5 Střídače

#### DC vstup

- maximální doporučený výkon pole;
- maximální DC napětí;
- startovací, jmenovité a MPPT napětí;
- počet MPPT a počet vstupů/stringů na MPPT;
- maximální provozní a zkratový proud pro každý MPPT/vstup;
- povolený poměr DC/AC;
- AFCI, DC vypínač a přepěťové ochrany.

#### AC výstup

- počet fází;
- jmenovitý a maximální činný/zdánlivý výkon;
- jmenovitý a maximální proud;
- nesymetrie fází;
- účiník, THD, podporované síťové normy;
- možnost nastavit export limit/zero export;
- účinnost: maximální, evropská a relevantní dílčí křivky.

#### Hybridní a záložní funkce

- hybridní/nehybridní provedení;
- rozsah napětí baterie;
- maximální nabíjecí a vybíjecí proud a výkon;
- podporované chemie a přesné kompatibilní bateriové řady;
- EPS/backup výkon, špičkový výkon a doba přepnutí;
- ostrovní provoz a paralelní řazení;
- API, Modbus, řízení výkonu a podporované měřiče;
- klidová/noční spotřeba.

#### Ostatní

- modelová řada a přesná varianta;
- firmware a hardwarová revize, pokud mění funkce;
- rozměry, hmotnost, IP, teploty, chlazení a hluk;
- certifikace, záruka, cena a dostupnost.

### 6.6 Baterie a úložiště

- chemie článků;
- jmenovitá a využitelná kapacita;
- napěťový rozsah;
- trvalý a špičkový nabíjecí/vybíjecí proud a výkon;
- C-rate, DoD a deklarovaná round-trip účinnost;
- počet cyklů, podmínky záruky a zbytková kapacita;
- modulární skladba, minimální a maximální počet modulů;
- BMS, komunikační protokol a firmware;
- úplný seznam kompatibilních střídačů;
- provozní teplota, IP, rozměry a hmotnost;
- požární a přepravní certifikace;
- cena za systém a Kč/kWh využitelné kapacity;
- nutné řídicí a propojovací příslušenství.

### 6.7 Kompatibilita FVE

Platforma musí umět vyhodnotit a vysvětlit:

- minimální a maximální počet panelů ve stringu při návrhových teplotách;
- zda `Voc` za mrazu nepřekročí maximum střídače;
- zda `Vmp` zůstane v MPPT rozsahu i za tepla;
- zda pracovní a zkratový proud nepřekročí limit vstupu;
- dovolené paralelní stringy;
- poměr DC/AC;
- kompatibilitu baterie, BMS, firmware a střídače;
- výkon nabíjení/vybíjení omezený nejslabším prvkem;
- kompatibilitu modul–svorka–lišta–střešní prvek;
- seznam chybějících položek pro úplný BOM.

Každý výsledek bude `PASS`, `WARN`, `FAIL` nebo `UNKNOWN` a bude obsahovat
vstupní hodnoty, vzorec, bezpečnostní rezervu a zdroje.

### 6.8 Dotace a zvýhodněné financování

#### Program a verze výzvy

- poskytovatel, program, podprogram, výzva a verze pokynů;
- stav: připravovaná, otevřená, pozastavená, vyčerpaná, uzavřená;
- období podávání, realizace a udržitelnosti;
- územní platnost a rozpočet výzvy;
- právní režim veřejné podpory;
- možnost kombinace s jinými tituly.

#### Žadatel a objekt

- fyzická osoba, domácnost s omezením příjmů, SVJ/BD, obec, firma, škola;
- vlastnictví, trvalý pobyt, počet nemovitostí a další osobní podmínky;
- rodinný/bytový dům, veřejná budova, provozovna;
- stáří, stav a využití budovy;
- velikost podniku, CZ-NACE a lokalita;
- energetický stav před a po realizaci.

#### Opatření a technické podmínky

- zateplení jednotlivých konstrukcí;
- okna a dveře;
- FVE, baterie, sdílení a chytré řízení;
- tepelné čerpadlo, zdroj tepla, ohřev vody;
- rekuperace, stínění a zelené střechy;
- požadované parametry výrobku nebo celého systému;
- minimální rozsah, dosažená úspora a emisní požadavky;
- návazné bonusy a kombinace opatření.

#### Výpočet podpory

- pevná částka, Kč/m², Kč/kWp, Kč/kWh nebo procento;
- uznatelné a neuznatelné náklady;
- minimum, maximum a strop podle nákladů;
- regionální, kombinační a sociální bonusy;
- zálohová platba, úvěr, úrok, RPSN a poplatky;
- deklarativní a auditovatelný výpočetní vzorec.

Výsledek nebude pouze „ano/ne“, ale:

- `ELIGIBLE`;
- `LIKELY_ELIGIBLE`;
- `MISSING_EVIDENCE`;
- `NOT_ELIGIBLE`;
- `PROGRAM_CLOSED`.

Součástí odpovědi bude seznam splněných a nesplněných pravidel, chybějící
doklady, maximální vypočtená podpora a verze výzvy.

### 6.9 Montážní technologie FVE

Klasifikace střech a povrchů:

- šikmá/rovná/fasáda/zem;
- taška, bobrovka, břidlice, falcovaný plech, trapézový plech;
- asfaltový pás, EPDM/TPO/PVC fólie;
- beton, vláknocement a sendvičový panel;
- flexibilní panel a lepená instalace.

Data montážního prvku/systému:

- výrobce, řada, přesný díl a jeho funkce;
- kompatibilní krytina, sklon, modul a orientace;
- materiál a korozní třída;
- rozměry, únosnost a certifikace;
- střešní hák, šroub, svorka, lišta, spojka, ballast, podložka;
- dovolené rozteče a návrhové tabulky;
- množství na panel/m² nebo parametrický výpočet;
- nutné doplňky a kompatibilní díly;
- cena, dostupnost a balení.

U lepidel a membrán navíc:

- kompatibilní podklady a požadovaná příprava;
- spotřeba na m², tloušťka vrstvy a vydatnost balení;
- pevnost, pružnost, UV a teplotní odolnost;
- doba zpracování, vytvrzení a aplikační teplota;
- certifikovaný systém a omezení záruky.

„Pět nejlevnějších“ znamená pět **technicky vyhovujících** kompletních variant,
nikoliv pět nejlevnějších jednotlivých dílů.

### 6.10 Elektroinstalační materiál FVE

- DC/AC kabely a průřezy;
- konektory a kompatibilita konektorových rodin;
- pojistky, odpínače, jističe, RCD;
- přepěťové ochrany;
- rozvaděče, skříně a krytí;
- měření, CT, smart meter a HDO/řízení;
- uzemnění, pospojování a ochrana před bleskem;
- kabelové trasy, žlaby a průchodky;
- požadované počty, délky, ztráty a proudové zatížení;
- norma/certifikace, cena a dostupnost.

### 6.11 Zateplení a ETICS

#### Izolant

- EPS, XPS, minerální vata, PIR/PUR, fenolická a přírodní izolace;
- deklarovaná lambda, tepelný odpor a tloušťka;
- objemová hmotnost, pevnost, nasákavost a difuzní odpor;
- reakce na oheň;
- rozměr desky, plocha/balení;
- oblast použití a systémová kompatibilita.

#### Celá skladba

- penetrace;
- lepicí a stěrková hmota;
- kotvy;
- armovací síť/perlinka;
- profily a detaily;
- omítka a finální ochranná vrstva;
- spotřeba každé vrstvy na m²;
- prořez a doporučená rezerva;
- klimatická omezení a technologické přestávky;
- cena na balení i přepočet na m².

Upřednostní se certifikované skladby jednoho systému. Náhodná kombinace
nejlevnějších vrstev se nesmí automaticky označit za technicky vyhovující ETICS.

### 6.12 Tepelná čerpadla

- vzduch–voda, země–voda, voda–voda a vzduch–vzduch;
- monoblok/split, počet fází a chladivo;
- topný výkon a příkon v normalizovaných pracovních bodech;
- COP, SCOP, energetická třída a bivalentní bod;
- výkonové křivky podle venkovní a výstupní teploty;
- minimální/maximální výstupní teplota;
- modulace, minimální výkon a odmrazování;
- vnitřní/venkovní akustický výkon;
- záložní elektrický dohřev;
- příprava TUV, zásobník a hydraulické příslušenství;
- řízení, SG Ready/API a možnost využití přebytků FVE;
- rozměry, hmotnost, provozní rozsah a záruka;
- sestava nutná k instalaci, cena a dostupnost.

### 6.13 Kotle, lokální zdroje a ohřev vody

- elektrokotle, plynové kondenzační kotle, biomasa a pelety;
- přímotopy, akumulační zdroje a topné patrony;
- bojlery a tepelná čerpadla pro TUV;
- jmenovitý a modulační výkon;
- účinnost, sezónní účinnost a emisní třída;
- palivo, spotřeba, zásobník a automatizace;
- teplotní rozsah, hydraulické požadavky a komín;
- elektrické parametry, HDO a řízení;
- cena sestavy a povinného příslušenství.

### 6.14 Osvětlení

- typ svítidla a světelného zdroje;
- příkon, světelný tok a lm/W;
- CCT, CRI, MacAdam/SDCM;
- vyzařovací úhel, UGR a fotometrická data;
- IP/IK, teploty a životnost;
- stmívání a řízení: DALI, 0–10 V, KNX, Zigbee apod.;
- účiník, náběhový proud a nouzová funkce;
- rozměry, způsob montáže, záruka;
- cena, dostupnost a náklady na příslušenství.

Databáze EPREL je vhodný základ pro energetické parametry, nikoliv sama o sobě
pro českou cenu a skladovou dostupnost.

### 6.15 Stínicí technika

- venkovní žaluzie, rolety, screeny, markýzy a vnitřní stínění;
- podporované rozměry a plocha;
- materiál, barva a optické/solární vlastnosti;
- deklarovaný solární činitel nebo vliv na `g`, je-li doložen;
- třída odolnosti větru;
- motor, příkon, nouzové ovládání a řídicí protokol;
- čidla slunce, větru a teploty;
- způsob montáže;
- cena za kus/m² a povinné příslušenství.

### 6.16 Okna, dveře, větrání, regulace

#### Výplně otvorů

- `Uw`, `Ug`, `Uf`, `g`, vzduchotěsnost a akustika;
- rozměrová omezení, rám, sklo, distanční rámeček;
- způsob montáže a cena standardního rozměru/m².

#### Rekuperace

- průtokové rozsahy, externí tlak;
- tepelná a vlhkostní účinnost;
- SFP/příkon, filtrace a hlučnost;
- protimrazová ochrana, bypass a řízení;
- rozvody a nezbytné příslušenství.

#### Měření a řízení

- smart meter, elektroměr, CT a podružné měření;
- Modbus, MQTT, REST a jiná rozhraní;
- podporovaná zařízení a datové body;
- lokální/cloud provoz, periodicita a omezení API;
- kybernetická podpora, aktualizace a ukončení cloudové služby.

## 7. Zdrojová strategie

### Úroveň zdrojů

1. **Regulátor, zákonodárce, správce programu, trh**  
   ERÚ, OTE, MPO, MŽP, SFŽP, Evropská komise/EPREL.
2. **Výrobce**  
   datasheet, instalační návod, prohlášení o shodě, kompatibilitní matice.
3. **Distributor/dodavatel**  
   oficiální ceník, obchodní podmínky, HDO a sazby.
4. **Autorizovaný distributor/prodejce**  
   cena, skladová dostupnost a balení.
5. **Marketplace/agregátor**  
   pouze doplňkový signál; technické parametry se jím nepotvrzují.

Technický parametr má preferovat výrobce. Cena a dostupnost musí pocházet z
konkrétního prodejního zdroje. Jediný zdroj nemusí potvrzovat oboje.

### Počáteční oficiální zdroje

- ERÚ – cenové výměry, podmínky sazeb a indikativní ceny:  
  `https://eru.gov.cz/`
- OTE – krátkodobé trhy a časové řady:  
  `https://www.ote-cr.cz/`
- ČEZ, E.ON a PRE – oficiální produktové ceníky:  
  `https://www.cez.cz/`, `https://www.eon.cz/`, `https://www.pre.cz/`
- ČEZ Distribuce, EG.D a PREdistribuce – distribuční/HDO údaje:  
  `https://www.cezdistribuce.cz/`, `https://www.egd.cz/`,
  `https://www.predistribuce.cz/`
- Nová zelená úsporám a SFŽP – závazné pokyny a výzvy:  
  `https://novazelenausporam.cz/`, `https://www.sfzp.cz/`
- MPO/API a dotační portály – podnikové programy a výzvy:  
  `https://www.mpo.gov.cz/`
- Evropská komise EPREL – výrobky podléhající energetickému štítkování:  
  `https://eprel.ec.europa.eu/`
- výrobci zařízení a systémů – pouze jejich oficiální produktové dokumenty.

Přesný registr domén a licenčních/přístupových pravidel bude verzovanou
konfigurací, ne textem natvrdo ve crawleru.

## 8. Sběr a aktualizace

### Pipeline

1. objevení dokumentu nebo nabídky;
2. kontrola dovoleného přístupu a frekvence;
3. stažení a neměnná archivace originálu;
4. SHA-256, MIME, čas a výsledná URL po přesměrování;
5. extrakce textu/tabulek, případně OCR;
6. normalizace modelu, jednotek, měny, DPH a času;
7. párování s existujícím výrobcem/modelem/nabídkou;
8. technické a rozsahové validace;
9. výpočet změn proti poslední verzi;
10. publikace nebo fronta k lidské kontrole;
11. upozornění odběratelům na významnou změnu.

### Doporučená frekvence

| Data | Kontrola | Cíl čerstvosti |
|---|---:|---:|
| ceny a skladová dostupnost | denně | do 24 hodin |
| dodavatelské ceníky | denně na změnu | do 24 hodin od zjištění |
| regulované ceny | denně + zvýšeně před novým rokem | do 24 hodin |
| OTE spot/day-ahead | podle publikace | nejpozději po uzavření trhu |
| dotační výzvy | denně | do 24 hodin |
| technické listy aktivních produktů | týdně | do 7 dnů |
| nové modely výrobců | týdně | do 7 dnů |
| kompatibilitní matice/firmware | týdně | do 7 dnů |
| ukončení výrobku | týdně | do 7 dnů |
| normy a metodiky | měsíčně/událostně | ruční potvrzení |

Denní kontrola neznamená denní změnu záznamu. Nová verze vznikne jen při změně
obsahu nebo pozorované nabídky.

## 9. Kanonický datový model

### Společné entity

- `organization`
- `brand`
- `source_registry`
- `source_document`
- `crawl_run`
- `extraction_run`
- `review`
- `publication`
- `change_event`

### Výrobky a nabídky

- `product_family`
- `product_model`
- `product_version`
- `specification_value`
- `certification`
- `warranty`
- `compatibility_edge`
- `bundle_component`
- `seller`
- `offer`
- `price_observation`
- `availability_observation`

Výrobek a nabídka jsou oddělené. Jeden model může mít mnoho prodejců a každá
nabídka vlastní historii cen a dostupnosti.

### Tarify a trh

- `energy_company`
- `energy_product`
- `energy_product_version`
- `distribution_tariff`
- `distribution_tariff_version`
- `price_component`
- `price_formula`
- `eligibility_rule`
- `market_series`
- `market_point`

### Dotace

- `funding_program`
- `funding_call`
- `funding_call_version`
- `applicant_rule`
- `building_rule`
- `measure_rule`
- `benefit_formula`
- `required_evidence`
- `combination_rule`

### Materiálový návrh

- `construction_system`
- `system_component`
- `compatibility_rule`
- `quantity_formula`
- `design_constraint`
- `bill_of_materials_template`

### Čas a verzování

Všechny významné záznamy budou bitemporální:

- `observed_at` – kdy jsme údaj zjistili;
- `valid_from`, `valid_to` – kdy údaj platil ve skutečnosti;
- `published_at` – kdy byl schválen k použití;
- `superseded_at` – kdy jej nahradila nová verze.

Každý výpočet si uloží identifikátor neměnného snapshotu katalogu.

## 10. Technologie služby

Doporučený základ:

- PostgreSQL pro normalizovaná a verzovaná data;
- S3/MinIO pro originální PDF, XLSX, HTML a datasheety;
- fronta úloh a scheduler pro sběr;
- oddělené worker procesy podle typu zdroje;
- interní REST API s OpenAPI;
- PostgreSQL full-text a trigram vyhledávání v první etapě;
- export snapshotů v JSON/Parquet pro reprodukovatelné analýzy;
- observabilita: metriky, strukturované logy a audit změn.

Samostatný Elasticsearch/OpenSearch není pro MVP nutný. Přidá se až při
prokázané potřebě.

## 11. API pro ostatní projekty

Minimální kontrakt:

- `GET /v1/catalog/products`
- `GET /v1/catalog/products/{id}`
- `GET /v1/offers/latest`
- `POST /v1/energy/tariffs/compare`
- `GET /v1/energy/market-series`
- `POST /v1/pv/string-check`
- `POST /v1/pv/system-bom`
- `POST /v1/subsidies/eligibility`
- `POST /v1/measures/compare`
- `GET /v1/snapshots/{domain}`
- `GET /v1/changes`
- `GET /v1/sources/{id}`

Každý dotaz podporuje:

- `as_of`;
- geografii a distribuční území;
- segment zákazníka;
- cenu s/bez DPH;
- měnu;
- stav dostupnosti;
- minimální kvalitu a čerstvost;
- zahrnutí zdrojů a vysvětlení odvození.

Odpověď vždy obsahuje:

- `snapshot_id`;
- `data_freshness`;
- `confidence`;
- `source_refs`;
- `warnings`;
- `assumptions`.

Spottex nebude číst databázi služby přímo. Bude používat verzované API nebo
neměnný snapshot, aby se aplikace a katalog mohly vyvíjet odděleně.

## 12. Kvalita a publikace

### Stav dat

- `DISCOVERED`
- `FETCHED`
- `EXTRACTED`
- `VALIDATED`
- `REVIEW_REQUIRED`
- `PUBLISHED`
- `REJECTED`
- `STALE`
- `RETIRED`

### Automatická validace

- povinná pole podle kategorie;
- rozměrová analýza jednotek;
- realistické rozsahy;
- kontrola variant v tabulkovém datasheetu;
- součet cenových složek;
- datum platnosti a překryvy verzí;
- detekce změny DPH/jednotky;
- kontrola shody modelového označení;
- detekce neobvyklého poklesu ceny;
- křížová kontrola výrobce versus prodejce;
- validační scénáře kompatibility.

### Publikační politika

Navržený bezpečný režim:

- přímé strukturované údaje regulátora/trhu mohou být publikovány automaticky,
  pokud projdou přísnou validací;
- nový parser nebo změněná struktura dokumentu vždy vyžaduje kontrolu;
- LLM/OCR extrakce z PDF začíná jako `REVIEW_REQUIRED`;
- technická kompatibilita s bezpečnostním dopadem vyžaduje primární dokument;
- dotace se automaticky neprohlásí za právně jistý nárok;
- významný cenový výkyv se před publikací potvrzuje druhým během nebo člověkem.

U každého pole bude možné otevřít přesný dokument, stranu, tabulku a buňku nebo
HTML selektor, ze kterého vzniklo.

## 13. Bezpečnost a provoz

- tajemství pouze v secrets manageru;
- externí přístupové tokeny nikdy v databázi katalogu, dokumentaci ani logu;
- šifrovaná komunikace a autentizace služeb;
- API klíče nebo workload identity pro spotřebitele;
- omezení požadavků, cache a backoff;
- registr povolených domén;
- ochrana před SSRF a kontrola přesměrování;
- limit velikosti a typu souboru;
- skenování stažených souborů;
- minimální ukládání osobních údajů;
- respektování licencí, podmínek a práva na databáze;
- zálohy databáze i archivu;
- audit každé publikace a změny pravidel.

Token viditelný na dodaném screenshotu je nutné před budoucí realizací
zneplatnit/obnovit. Ve specifikaci ani kódu se nepoužije.

## 14. Jednokliková analýza Spottex – závazný kontrakt další etapy

Tato část se nyní neimplementuje, ale určuje návaznost na `costs`.

### 14.1 Tok uživatele

1. Uživatel z dashboardu klikne na **Spočítat úspory**.
2. Okamžitě vznikne úloha a zobrazí se konkrétní průběh.
3. Spottex použije měření a automaticky dostupné technické údaje.
4. Chybějící údaje doplní verzovanými modelovými scénáři.
5. Porovná vhodné dodavatele, distribuční oblasti a sazby.
6. Výsledek ukáže současnou variantu, nejlepší relevantní variantu, úsporu,
   období dat, kvalitu a použité předpoklady.
7. Teprve při rozhodnutí zapnout řízení se vyžádá potvrzení bezpečnostních a
   smluvních údajů.

### 14.2 Priorita zdrojů technických údajů

1. živá data a metadata SolaX pro konkrétní elektrárnu;
2. SolaX plant/device API;
3. katalog modelu v `costs`;
4. jednorázové, cacheované načtení chybějících údajů ze SolaX webu;
5. modelový předpoklad.

Selenium není běžný datový kanál. Použije se jen pro údaj, který API neposkytne,
výsledek se uloží a opakované přihlášení se omezí.

### 14.3 Co již dnešní backend umí získat

Současný soubor `mobile_server/solax_dev_api.py` čte:

- `pvCapacity`;
- `batteryCapacity`;
- název a identifikátor elektrárny;
- polohu a čas vytvoření;
- model, sériové číslo a jmenovitý výkon střídače;
- připojená bateriová zařízení.

Zobrazená elektrárna má v SolaX základních informacích doloženou velikost FVE
20 kWp a baterii 23 kWh. Pokud je Spottex nevidí, jde o chybu mapování,
persistování nebo inicializace, nikoliv o požadavek na ruční zadání.

### 14.4 Modelové předpoklady pro první výpočet

| Neznámá hodnota | Výchozí scénář | Omezení |
|---|---|---|
| hlavní jistič | 3×25 A | pouze analýza, ne řízení |
| maximální odběr | výkon odpovídající 3×25 A při 3f síti | jasně označit |
| maximální přetok | numericky PV kWp → kW | citlivostní scénář, ověřit smlouvou/nastavením |
| účinnost cyklu baterie | 95 % | nahradit datasheetem/modelovou křivkou |
| HDO | NT 22:00–05:00 | jen model; skutečné HDO se liší |
| distributor | všechny relevantní oblasti | netvrdit, že jde o skutečného distributora |
| sazba | všechny technicky dosažitelné sazby | podmínky sazby se vyhodnotí |
| současný ceník | více referenčních produktů | označit jako benchmark, ne smlouvu zákazníka |

Výstup musí nabídnout citlivost na předpoklady. Například přetok 10/15/20 kW
nebo různé rozložení NT, pokud výsledek významně mění.

### 14.5 Hranice mezi analýzou a řízením

Pro informativní analýzu lze použít modelové předpoklady. Před aktivním řízením
se musí potvrdit minimálně:

- přesný identifikátor a oprávnění k elektrárně;
- povolený přetok a export limit;
- hlavní jistič a rezervovaný příkon;
- skutečná baterie, výkonové limity a kompatibilita;
- skutečný distributor, sazba a HDO;
- bezpečnostní limity střídače;
- souhlas se zásahem a možnost bezpečného návratu.

### 14.6 UX změny v návazné etapě

- skrýt bloky **Metodika výpočtu** a **Výpočet teď neběží** z hlavního pohledu;
- po vstupu automaticky spustit výpočet;
- tlačítko nesmí být „mrtvé“: zobrazí stav a ID úlohy;
- průběh například:
  - načítám historii;
  - kontroluji pokrytí dat;
  - načítám technické údaje;
  - porovnávám ceníky a distribuční sazby;
  - simuluji provoz bez řízení;
  - simuluji chytré řízení;
  - připravuji výsledky;
- uvést období, počet intervalů, mezery a podíl skutečných/modelovaných dat;
- chybějící nepovinné údaje nezobrazovat jako hromadu výstrah;
- zobrazit jeden souhrnný panel předpokladů a možnost je později zpřesnit;
- metodiku ponechat dostupnou až jako rozbalovací detail výsledku.

## 15. Vztah k dnešnímu Spottex katalogu

Spottex již má první modely:

- `CatalogSourceDocument`;
- `EnergyCompany`;
- `EnergyProduct` a verze;
- `DistributionTariff` a verze;
- `FundingProgram` a verze;
- `MarketPriceSeries` a body.

Současný katalogový agent bezpečně vytváří pouze `DRAFT`, což je vhodný základ
publikačního workflow. Pro cílovou platformu však nestačí:

- katalog je pevně svázán se Spottex databází;
- nemá obecný výrobkový a nabídkový model;
- nemá technické parametry s jednotkou a proveniencí po jednotlivých polích;
- nemá kompatibilitní graf;
- nemá historii ceny a dostupnosti prodejců;
- dotační podmínky jsou příliš obecný JSON;
- týdenní běh nestačí pro ceny a výzvy;
- nepokrývá materiálové skladby a BOM.

Při migraci se stávající schéma zachová jako kompatibilní čtecí vrstva nebo se
naplní ze snapshotu `costs`. Nevzniknou dvě nezávislé „pravdy“ o cenících.

## 16. Etapy realizace

### Fáze 0 – schválení specifikace

- potvrdit rozsah P0/P1/P2;
- potvrdit publikační politiku;
- potvrdit trhy, segmenty a rozpočet infrastruktury.

### Fáze 1 – společný základ a energie

- nový repozitář a provozní kostra;
- source registry, archiv, provenance a review;
- tarify, distribuce, OTE a snapshoty;
- API pro porovnání;
- napojení jednoklikové analýzy Spottex.

### Fáze 2 – FVE technika

- panely, střídače a baterie;
- ceny a dostupnost;
- kompatibilitní pravidla;
- string checker a základní BOM;
- doplnění SolaX modelů katalogovými parametry.

### Fáze 3 – dotace

- verzované výzvy a pravidla;
- rozhodovací strom;
- auditovatelný výpočet maximální podpory;
- kombinovatelnost programů.

### Fáze 4 – budovy a další technologie

- montážní systémy a elektroinstalace;
- zateplení/ETICS, okna, větrání;
- zdroje tepla, TUV, osvětlení a stínění;
- parametrické BOM.

### Fáze 5 – optimalizace trhu

- detekce slev a neobvyklých cen;
- hlídání dostupnosti;
- automatické přepočty dotčených variant;
- upozornění projektům na změnu.

## 17. Akceptační kritéria

Platforma není hotová pouze tím, že „něco stáhne“. Pro každou zapojenou
kategorii musí:

1. mít schválené povinné pole a jednotky;
2. uchovat originální zdroj a hash;
3. ukázat provenienci každé rozhodné hodnoty;
4. rozlišit výrobek, verzi a nabídku;
5. vrátit platnost a čerstvost;
6. zabránit použití nevalidovaného záznamu ve výpočtu;
7. umět reprodukovat starý výpočet pomocí snapshotu;
8. mít testovací zlaté případy;
9. mít alert na zastaralý nebo rozbitý zdroj;
10. mít dokumentované API a export.

Pro Spottex je první obchodní akceptace:

- uživatel jedním kliknutím spustí analýzu;
- nemusí předem vyplnit technický formulář;
- vidí průběh;
- výsledek uvádí období měření a jeho kvalitu;
- výsledek porovná varianty tarifů;
- žádný modelový předpoklad není prezentován jako ověřený fakt;
- před zapnutím řízení se bezpečnostní údaje ověří.

## 18. Schválená rozhodnutí pro realizaci

1. **Geografie:** pouze Česká republika.
2. **Segmenty:** domácnosti, maloodběr, obce, SVJ/bytová družstva a firmy.
3. **Ceny:** ukládat a vracet ceny s DPH i bez DPH; výchozí prezentace se řídí
   segmentem.
4. **Prodejci:** preferovat spravovaný seznam schválených prodejců. Pokud pro
   kategorii nestačí, dovoluje se řízené objevování českých e-shopů se stejnými
   požadavky na provenienci, podmínky přístupu a kontrolu kvality.
5. **Extrakce a publikace:** použít hybrid Codex CLI/model + lidská kontrola.
   Náročný ceník nebo tabulkové PDF nejdříve zpracuje schopnější model; levnější
   model lze použít pouze na aktivitu, na které dosáhne ověřené kvality.
6. **Počet variant:** ukládat všechny základní modely zařízení prodávané na
   českém trhu. Omezení na pět se týká pouze výsledného výběru zaměnitelných,
   technicky vyhovujících nabídek, typicky konstrukčních a spotřebních
   materiálů. Netýká se úplnosti katalogu panelů, střídačů, baterií, tepelných
   čerpadel a dalších parametricky odlišných zařízení.
7. **OCR/LLM:** automatická extrakce smí vytvořit `REVIEW_REQUIRED`. Nejasný
   výsledek nejdříve zkontroluje schopnější model a teprve poté člověk.
8. **API:** interní, neveřejné, určené vlastním projektům.
9. **Historie:** prozatím neomezené uchování zdrojů, verzí a cenových pozorování.
10. **Pořadí domén:** FVE → dotace → zateplení → vytápění → stínění → všechny
    další schválené oblasti.

### 18.1 Povinné vyhodnocení modelů Codex CLI

Před nasazením modelu na daný typ práce vznikne reprezentativní eval sada a
měřitelné přijímací kritérium. Minimální skupiny aktivit:

- objevení relevantního zdroje;
- tabulkový ceník elektřiny;
- složité PDF s poznámkami a nelineárními podmínkami;
- technický datasheet výrobku;
- kompatibilitní matice;
- dotační pravidla a výpočet podpory;
- normalizace nabídky e-shopu;
- kontrola již extrahovaného kandidáta.

Pro každý model/režim se uloží:

- přesná identifikace modelu a reasoning effort;
- verze promptu a schématu;
- úspěšnost po polích a úplných dokumentech;
- false-positive/false-negative chybovost;
- počet ručních oprav;
- tokeny, doba a odhad nákladů;
- rozhodnutí, pro které aktivity je kombinace povolena.

Výkonný model (například řada `gpt-5.6-sol` s vyšším reasoning effort) bude
referenčním posuzovatelem a zpracovatelem obtížných dokumentů. Levnější model
(například řada `gpt-5.6-terra`) se nasadí jen tam, kde na zlaté sadě splní
prahovou hodnotu. Názvy a dostupnost modelů se zjišťují z konfigurované Codex
CLI služby; nesmí se předpokládat natvrdo.
