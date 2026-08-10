# SpotTEX — produkční roadmapa zákaznické cesty

Stav: schválený směr, průběžně implementováno. Tento dokument je zdroj pravdy pro pořadí práce a akceptační kritéria. Změny se týkají repozitáře `/home/web/spottex`; projekt GridLink a jeho běžící měření jsou mimo rozsah.

## Produktová pravidla

- Základní analýza pracuje s existující FVE, baterií a připojením.
- Každý reálný cenový scénář porovnává self-use a chytré řízení při stejném hardwaru, tarifu a cenách.
- Úspora řízením je `náklady self-use − náklady chytrého řízení`.
- Základní služba je roční. Nabídková cena je `min(990 Kč, 25 % očekávané roční úspory řízením)` a zobrazí se před platbou jako obchodní sleva; vratka není standardní mechanismus.
- GoPay má uložit souhlas/token pro opakovanou roční platbu. Před další platbou zákazníka včas upozorníme a cenu znovu odvodíme z aktuální analýzy.
- Rozšířené simulace hardwaru jsou placené podle počtu bodů nad základní balíček. Orientační pravidlo je 5 Kč za jeden dodatečný simulační bod; finální minimum, zaokrouhlení a DPH jsou konfigurovatelné.
- Ceníky, distribuční sazby, dotace a financování jsou verzované. Automatický agent smí připravit návrh importu, ale publikace do produkčních výpočtů vyžaduje validaci a auditní stopu.
- Pokud chybí přesné HDO, výsledek používá konzervativní model a viditelně to přizná.
- Výsledek zatím nesměruje zákazníka na konkurenci. Architektura odděluje simulaci od sjednání a je připravena na interní nabídku vlastního dodavatele od roku 2027.

## Fáze A — bezpečný datový základ

1. [x] Izolovat změny tohoto projektu od GridLinku a jeho databáze.
2. [x] Zdokumentovat současné kontejnery, porty a vlastníky databází.
3. [x] Zavést explicitní označení zdroje každé energetické hodnoty.
4. [x] Zavést stav dostupnosti jednotlivých částí dashboardu.
5. [x] Zabránit tomu, aby chyba ceny skryla funkční telemetrii.
6. [x] Zabránit tomu, aby chyba jedné elektrárny označila všechny elektrárny uživatele jako nefunkční.
7. [x] Oddělit stav spojení účtu od stavu konkrétní elektrárny.
8. [x] Opravit a otestovat význam `requiredInfo`.
9. [x] Opravit jednotky okamžitého výkonu kW podle ověřeného writeru legacy cache (sloupce jsou historicky chybně pojmenované `*_kwh`, ale obsahují W/1000).
10. [x] Opravit jednotky intervalové energie kWh; graf používá výhradně integrované 15minutové tabulky.
11. [x] Opravit znaménko importu a exportu podle ověřeného legacy/SolaX writeru: feed-in kladně znamená export, normalizovaný dashboard kladně import.
12. [x] Uložit originální čas měření, pokud ho API poskytuje; jinak výslovně označit čas přijetí a nepředstírat ho jako čas měření.
13. [x] Oddělit 5minutovou telemetrii a 15minutové energetické intervaly.
14. [x] Uložit skutečný konec každého intervalu.
15. [x] Odstranit hodinový fallback posledního 15minutového bodu.
16. [x] Zachovat příznak měření, odhadu a predikce.
17. [x] Nikdy neukládat budoucí predikci jako naměřenou historii.
18. [x] Omezit graf historie na skutečných posledních 24 hodin.
19. [x] Zobrazit predikci samostatně a odlišným přerušovaným stylem, nikdy ji nemíchat do naměřené 24hodinové historie.
20. [x] Zobrazit stáří poslední telemetrie a posledního intervalu (u LIVE zdroje zatím podle času odpovědi; původní čas měření řeší bod 12).
21. [x] Přejmenovat nejasnou synchronizaci na načtení technických údajů ze SolaX Cloud podle skutečné operace endpointu.
22. [x] Opravit energetické jednotky v plánu řízení.
23. [x] Zobrazovat jen budoucí kroky plánu.
24. [x] Přestat prezentovat neověřené nulové úspory jako výsledek.
25. [x] Přidat jednotkové a integrační testy celého datového kontraktu.

## Fáze B — informační architektura a Moje elektrárna

26. [x] Změnit menu na Přehled, Moje elektrárna, Analýza úspor, Řízení, Služba a vyúčtování, Profil.
27. [x] Sloučit objednávku, stav služby, opakované platby, platební historii, doklady a fakturační údaje do jedné zákaznické cesty; staré URL zachovat pouze jako přesměrování.
28. [x] Zachovat existující fakturační údaje uživatele a umožnit jejich úpravu před platbou.
29. [x] Vytvořit přehled všech elektráren uživatele.
30. [x] Vytvořit detail technické konfigurace elektrárny.
31. [x] Evidovat EAN, distributora, sazbu, jistič a počet fází.
32. [x] Evidovat maximální odběr, povolení přetoků a jejich limit.
33. [x] Evidovat pole/panely FVE, nominální výkon a vazbu na střídače.
34. [x] Evidovat kapacitu, výkon, účinnost a SoC limity baterie.
35. [x] Připravit model a uživatelskou evidenci ovládaných spotřebičů bez jejich aktivního řízení.
36. [x] Evidovat původ každé technické hodnoty.
37. [x] Evidovat čas zjištění a čas potvrzení každé hodnoty.
38. [x] Umožnit uživateli hodnotu potvrdit nebo opravit.
39. [x] Zavést úrovně povinnosti: informativní, nutné pro analýzu, nutné pro řízení.
40. [x] Zobrazit dopad chybějícího údaje místo obecné chyby.
41. [x] Zamezit zapnutí řízení při neověřených bezpečnostních limitech.
42. [x] Přidat auditní stopu změn technické konfigurace.
43. [x] Připravit bezpečnou migraci současných JSON metadata do strukturovaných polí.
44. [x] Migrovat pouze databázi SpotTEX po záloze a dry-runu.
45. [x] Přidat Playwright cestu pro doplnění a potvrzení elektrárny.

## Fáze C — faktura a přesnost vstupů

46. [x] Přidat možnost „Zpřesnit pomocí faktury“.
47. [x] Zobrazit adresu `contact@spottex.cz` a instrukce pro odeslání.
48. [x] Vytvořit unikátní referenční kód elektrárny pro párování příchozí faktury.
49. [x] Připravit bezpečný upload PDF/JPG/PNG do šifrovaného databázového úložiště SpotTEX s 10MB limitem, ověřením skutečného typu, výchozí 180denní retencí a fyzickým odstraněním obsahu; automatické parsování zůstává vypnuté.
50. [x] Umožnit ruční administrátorské zapsání údajů z faktury.
51. [x] Evidovat dokument, jeho období a neměnné pořadové verze ručně vytěžených údajů.
52. [x] Označit dokument jako citlivý, šifrovat obsah AES-256-GCM, povolit stažení pouze vlastníkovi a administrátorovi a každý přístup auditovat.
53. [x] Připravit stavový workflow přijato, zpracovává se, vyžaduje doplnění, potvrzeno.
54. [x] Po změně ceny z faktury po povinném potvrzení uživatelem automaticky přepočítat self-use náklady.
55. [x] Po změně ceny z faktury po povinném potvrzení uživatelem automaticky vytvořit nový běh chytré optimalizace; při chybějící historii nebo katalogu se odklad audituje.
56. [x] Nezobrazovat starý smart výsledek jako výsledek pro nové ceny.
57. [x] Verzovat vstupní snapshot každé analýzy.
58. [x] Připojit výchozím stavem vypnutý AI parser faktur, který ukládá pouze verzovaný návrh a vyžaduje lidské potvrzení.
59. [x] Přidat integrační a Playwright testy neplatného typu, duplicity, cizího dokumentu, šifrovaného uložení, oprávněného stažení a verzovaného vytěžení.

## Fáze D — historický import a kvalita

60. [x] Navrhnout idempotentní importní kurzory po elektrárně a datovém typu.
61. [x] Stahovat historii po omezených 12hodinových blocích (aktivace čeká na bezpečný legacy `history-v1` endpoint).
62. [x] Opakovat pouze neúspěšné bloky s exponenciálním backoffem.
63. [x] Evidovat průběh, poslední chybu a počet pokusů.
64. [x] Detekovat duplicity, mezery, překryvy a neplatné délky intervalů.
65. [x] Validovat energetickou bilanci výroba–spotřeba–baterie–síť v úplných intervalech, evidovat odchylku a při více než 5 % chybných intervalů analýzu zablokovat.
66. [x] Při změně již uloženého intervalu uchovat původní i novou hodnotu, čas, příznak predikce, důvod a zdrojovou referenci v neměnné historii korekcí.
67. [x] Vytvořit a v analýze zobrazit report pokrytí za posledních 30, 90 a 365 dní vůči nejnovějšímu společnému intervalu.
68. [x] Definovat minimální pokrytí pro orientační a produkční analýzu.
69. [x] Zobrazit uživateli průběh importu a očekávané omezení výsledku.
70. [x] Oddělit historický import do samostatných idempotentních úloh; živá synchronizace, reconcilace příkazů a bezpečné vypnutí mají v runneru přednost a na import nečekají.
71. [x] Přidat exponenciální provozní retry, obnovu zatuhlého workeru a administrátorské znovuspuštění pouze chybných bloků.
72. [x] Přidat databázový integrační test obnovy zatuhlého dlouhého importu po pádu, zachování stavu řízení a následného administrátorského retry.

## Fáze E — HDO, ceníky a cenové křivky

73. [x] Oddělit obchodníka, distributora, produkt, sazbu a jistič.
74. [x] Vytvořit verzované katalogy s platností od–do.
75. [x] Uložit komoditní cenu, měsíční plat, regulované složky, daň a DPH.
76. [x] Uložit výkupní cenu, spotový vzorec a obchodní poplatky.
77. [x] Modelovat pouze publikované kombinace nákupu a výkupu uložené v jedné verzi produktu.
78. [x] Načíst do DRAFT katalogu a archivovat aktuální oficiální podklady ČEZ, E.ON a PRE pro dodávku i výkup; neúplné jednostranné ceníky jsou pouze SOURCE a nesmí se bez kompletního ručně validovaného kontraktu použít ve výpočtu. Bootstrap je idempotentní a ukládá SHA-256 i přímou URL.
79. [x] Uložit originální dokument, kontrolní součet a URL zdroje.
80. [x] Validovat nové ceny proti předchozí verzi a rozumným mezím.
81. [x] Vytvořit auditovaný import přesného kalendáře HDO s neměnným snapshotem EAN, distributora, časové zóny, platnosti a oficiálního zdroje; vložení zneplatní překrývající modelové křivky a analýzy.
82. [x] Vytvořit konzervativní HDO model 22:00–06:00, když přesné časy nejsou dostupné.
83. [x] U konzervativního modelu přepočítat self-use i smart optimalizaci pro krajní all-VT/all-NT křivky, uložit roční dolní/horní mez a vysvětlit ji jako citlivostní, nikoli pravděpodobnostní interval.
84. [x] Vytvořit jednotný generátor časové nákupní a výkupní křivky.
85. [x] Podporovat fixní VT/NT produkty.
86. [x] Podporovat spotové produkty s přirážkou a zápornými cenami.
87. [x] Podporovat procentní a časově podmíněné produkty přes omezená pravidla `TIME_RULES_V1`.
88. [x] Pro nestandardní produkt umožnit auditovaný verzovaný generátor cenové křivky bez spouštění cizího kódu.
89. [x] Každou analýzu svázat s neměnnou verzí cenové křivky.
90. [x] Přidat referenční účetní testy pro fixní, spotové i nestandardní časové ceníky a E2E materializaci.

## Fáze F — produkční analýza

91. [x] Odvodit nezávislý profil zátěže bez vlivu historického řízení baterie.
92. [x] Kalibrovat výrobu a oddělit skutečnost od předpovědi.
93. [x] Implementovat deterministický self-use referenční model.
94. [x] Integrovat rolling optimalizaci po 15 minutách za stabilním rozhraním a zapnout produkční příznak až po křížové regresi solverů, roční fyzikální regresi a kapacitním běhu bez fallbacku.
95. [x] Zahrnout SoC, účinnost, výkon, přetoky, jistič a cenu cyklování.
96. [x] Vybrat prediktor spotřeby pomocí časově korektní validace.
97. [x] Preferovat jednoduchý profil, pokud neuronový model není prokazatelně lepší.
98. [x] Evidovat chybu predikce a datové pokrytí bez zahlcení uživatele.
99. [x] Po změně cen zneplatnit cenové křivky a po potvrzení automaticky znovu spustit smart optimalizaci.
100. [x] Oddělit úsporu produktem, distribuční sazbou a řízením proti potvrzenému současnému self-use.
101. [x] Zvýraznit skutečný nebo uživatelem potvrzený současný scénář.
102. [x] Označit distribuční sazby vyžadující ověření nároku.
103. [x] Zobrazit tři nejlepší chytré scénáře, doporučený scénář zvýraznit a celou matici ponechat rozbalitelnou.
104. [x] Zobrazit rozpad ceny na nákup po všech proměnných složkách, výkup a stálé platby.
105. [x] Uložit reprodukovatelný vstup, verzi algoritmu a výsledek každého běhu.
106. [x] Zavést frontu, progress po scénářích, bezpečný timeout, tři automatické pokusy s backoffem a zrušení nezačatého běhu.
107. [x] Porovnat referenční datasety se Studií a nastavit toleranci regresí (syntetické zlaté případy i read-only roční dataset pro self-use procházejí; zákaznická řada se nekopíruje do repozitáře).
108. [x] Přidat Playwright cestu od připojení po doporučení.

## Fáze G — řízení, cena služby a GoPay

109. [x] Oddělit stránku Analýza úspor od stránky skutečného Řízení.
110. [x] Vytvořit technický checklist před aktivací.
111. [x] Nechat uživatele potvrdit zdroj a správnost kritických údajů.
112. [x] Zobrazit očekávanou úsporu proti self-use na stejném tarifu a z ní odvozenou nabídkovou roční cenu.
113. [x] Vypočítat obchodní slevu tak, aby cena nepřesáhla 25 % očekávané úspory.
114. [x] Před platbou zobrazit metodiku, období dat, jejich úroveň jistoty a výslovně uvést, že jde o modelovaný odhad, nikoli záruku.
115. [x] Uložit cenovou nabídku a její expiraci.
116. [x] Vytvořit jediný roční produkt řízení a odstranit interní pojem košíku ze zákaznického UI.
117. [x] Přenést fakturační údaje do checkoutu a umožnit jejich opravu.
118. [x] Integrovat GoPay opakovanou platbu podle ověřeného vzoru ARXITO.
119. [x] Uložit pouze bezpečný token/mandát, nikdy údaje karty.
120. [x] Callbacku GoPay nevěřit: stav, částku, měnu, order number i GoID ověřit autorizovaným server-to-server dotazem a vypořádat transakčně a idempotentně.
121. [x] Transakčně zařadit potvrzení platby, odkaz na daňový doklad a informaci o stavu roční obnovy do e-mailové fronty.
122. [x] Před další roční platbou vyžadovat čerstvou dokončenou analýzu a novou neexpirovanou nabídku; jinak nic nestrhávat.
123. [x] Umožnit automatické obnovení odmítnout před stržením.
124. [x] Řešit neúspěšnou obnovu omezenými pokusy, oznámením uživateli a bezpečným vypnutím řízení po konci zaplaceného období.
125. [x] Auditovat aktivaci, změny technických a bezpečnostních limitů, požadavek i potvrzení příkazu a souhrnný výsledek nouzového vypnutí včetně důvodu.
126. [x] Přidat Playwright checkoutu včetně mobilu a integrační testy ověřeného callback vypořádání, souběhu a idempotentní obnovy.

## Fáze H — placené rozšíření

127. [x] Připravit volitelnou změnu kapacity, nabíjecího výkonu a vybíjecího výkonu baterie.
128. [x] Připravit volitelnou změnu výkonu FVE bez simulace orientace střechy.
129. [x] Připravit změnu přetokového a odběrového limitu.
130. [x] Připravit optimalizaci velikosti jističe.
131. [x] Připravit datový model flexibilních spotřebičů.
132. [x] Sestavit kartézský počet scénářů ještě před objednávkou.
133. [x] Zobrazit uživateli počet základních a placených bodů.
134. [x] Vypočítat cenu dodatečných bodů před spuštěním.
135. [x] Vyžadovat platbu před spuštěním rozsáhlé analýzy.
136. [x] Nastavit rozpočty souběhu, CPU, času a bezpečné obnovy.
137. [x] Umožnit export výsledků rozšířené analýzy.
138. [x] Orientaci panelů a 3D model střechy ponechat mimo aktuální rozsah.

## Fáze I — automatické katalogy, dotace a financování

139. [x] Navrhnout izolovanou pipeline pro vyhledávání oficiálních ceníků.
140. [x] Spouštět Codex CLI agenta v read-only sandboxu, s omezenými doménami a strukturovaným výstupem.
141. [x] Zakázat agentovi přímé publikování neověřených cen do produkce; importuje pouze `DRAFT`.
142. [x] Validovat schéma, platnost, jednotky, DPH, velikost a úplnost importu a znovu stáhnout oficiální zdroj.
143. [x] Vytvořit administrátorský diff a schvalovací workflow.
144. [x] Monitorovat expirace ceníků a chybějící následné verze s eskalovaným upozorněním administrátorům.
145. [x] Stejným vzorem vytvořit katalog dotačních titulů.
146. [x] Evidovat územní, technické, příjmové a časové podmínky dotace.
147. [x] Vytvořit katalog financování s RPSN, poplatky a platností.
148. [x] Zahrnout dotace a financování pouze do investiční Pro analýzy.
149. [x] Přidat placené porovnání všech dostupných ceníků na datech zákazníka.
150. [x] Připravit přechod z externího doporučení na vlastního dodavatele bez změny simulačního jádra.

## Produkční brány

- `lint`, `typecheck`, jednotkové testy a build musí projít bez výjimek.
- Playwright pokryje desktop, mobilní kritickou cestu, chyby a opakované platby.
- Výpočty mají zlaté datasety a reprodukovatelné verze vstupů.
- Migrace mají zálohu, dry-run, kontrolu počtů a rollback postup.
- Příkazy řízení mají audit, idempotenci, entitlement a bezpečné vypnutí.
- Automaticky získaná cena, dotace ani financování se nepoužijí bez validace.
- Produkční nasazení proběhne nejdříve do odděleného SpotTEX prostředí a nezasáhne GridLink.
