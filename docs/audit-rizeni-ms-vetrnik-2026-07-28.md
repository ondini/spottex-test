# Audit predikcí a řízení — MŠ Větrník

Datum auditu: 28. 7. 2026

## Verdikt

Nová analýza úspor je finančně vnitřně konzistentní, ale pro MŠ Větrník zatím
nelze potvrdit přesnost produkčních predikcí ani skutečný přínos live řízení.
Elektrárna není řízena a uložená historie neobsahuje dostatečně dlouhou souběžnou
historii obou střídačů.

Výsledky lze prezentovat jako simulaci nad dostupnými daty. Nelze je zatím
prezentovat jako ověřený výsledek skutečného řízení.

## Ověřené skutečnosti

### Skutečné řízení

- MŠ Větrník má dva legacy střídače, zařízení 36 a 37.
- U obou je `optimization_running = false`.
- Pro zařízení 36 a 37 nejsou uložené žádné optimalizační běhy, plány ani
  provedené řídicí povely.
- Neexistuje tedy provozní vzorek, na kterém by šlo porovnat plánovaný zásah,
  odeslaný povel a následnou telemetrii.

### Historická data

- Agregovaná historie výroby a spotřeby obsahuje přibližně 276,9 úplného dne.
- Původní backend má od října 2025 téměř souběžnou historii obou střídačů:
  zařízení 36 má 26 602 a zařízení 37 má 26 606 měřených 15minutových intervalů
  výroby.
- Nová administrace založila všechny tři dosavadní importy jen pro zařízení 36.
  Příčinou je explicitní výběr prvního střídače při založení importu, nikoli
  chybějící data v SolaXu.
- Živá synchronizace sice stáhla oba střídače, ale sečetla je a agregát uložila
  pod ID prvního zařízení. Tím ztratila informaci, který střídač skutečně měřil.
- Fyzikální energetická bilance je mimo toleranci u přibližně 68 % intervalů,
  pro které máme výrobu, spotřebu, baterii i síť.
- V historii jsou dlouhé úseky téměř nulové výroby. Než se použijí pro učení
  modelu, je nutné odlišit skutečnou odstávku FVE od chybějících dat.

### Retrospektivní replay současného modelu

Kontrolní replay byl proveden pro zařízení 36 od 18. 7. 2026 00:00 na horizontu
34 hodin. Použil současné checkpointy a archivní počasí. Jde tedy o retrospektivní
horní odhad kvality současného modelu, nikoli o důkaz toho, co systém v daný den
skutečně předpověděl.

| Řada | Skutečnost | Predikce | MAE | WAPE |
| --- | ---: | ---: | ---: | ---: |
| Výroba — živé škálování 40 kWp | 59,076 kWh | 438,105 kWh | 11,148 kWh/h | 641,6 % |
| Výroba — fyzické měřítko 10 kW a správný čas | 59,076 kWh | 46,869 kWh | 0,847 kWh/h | 48,7 % |
| Spotřeba | -5,222 kWh | 11,668 kWh | 0,660 kWh/h | 90,9 % |

Registrace zapsala celkových 20 kWp elektrárny ke každému střídači. Metadata je
sečetla na 40 kWp a tento součet živý kód poslal modelu každého jednotlivého
10kW zařízení. Jde o vstup výrazně mimo trénovací rozsah modelu. Hodnota se
navíc používá při normalizaci vstupu i při převodu výstupu zpět na kWh.

Model výroby v tomto replayi předpověděl 101,430 kWh v nočních hodinách, zatímco
skutečnost byla 0 kWh. Při fyzickém měřítku 10 kW a ukotvení na poslední
vstupní hodinu klesá noční odhad v tomto okně na 0 kWh.
Ochranné oříznutí pod slunečním horizontem je nutná provozní pojistka, ale
nenahrazuje opravu dat ani doučení modelu.

Nejde však jen o integrační chybu. V trénovací sadě je 3 398 hodin s kladnou
výrobou při nulovém globálním ozáření. Podle lokality je nejlepší korelace
výroby s počasím posunutá o 0 až 3 hodiny. Checkpoint proto musí být přeučen na
časově sjednocených datech; samotná noční pojistka z něj neudělá ověřený model.

Vstupních 48 hodin spotřeby mělo součet -29,270 kWh a obsahovalo 19 záporných
hodin. V následném 34hodinovém okně bylo záporných 9 hodin. Predictor záporné
vstupy interně ořízne na nulu, takže dostává jiný signál, než jaký je uložený v
databázi. Tato řada není fyzická spotřeba objektu ani platný trénovací label.

Tento jediný interval není dostatečný pro odhad běžné přesnosti, ale je
dostatečný k zamítnutí současné pipeline jako ověřené pro live řízení.

### Finanční výpočet nové analýzy

- Poslední dokončený běh obsahuje 16 shodných tarifních variant v režimech
  self-use a smart.
- Smart nebyl dražší ani v jedné párové variantě.
- Rozsah přínosu smart řízení je podle tarifu 0 až 14 623,35 Kč.
- Nejvyšší odchylka kontroly
  `roční náklad = nákup − výkup + stálé platby` je 0,02 Kč.
- Konkrétní tarif MŠ Větrník stále chybí. Není vyplněný distributor,
  distribuční sazba, režim a cena nákupu, režim a cena výkupu ani stálý plat
  dodavateli.

### Starý live optimalizér

Režim FIX/FIX musí používat dvě explicitní hodnoty: fixní cenu nákupu a
samostatnou fixní cenu výkupu. Opravený optimalizér je používá přímo v cílové
funkci; výkup není odvozený z nákupní ceny ani nahrazený obecnou penalizací.

Starý loader navíc ořezával zápornou spotovou nákupní cenu na nulu. Záporná
komoditní cena je platný vstup; distribuční a regulované složky se k ní přičítají
samostatně. Ořezání proto může změnit optimální plán.

Je nutné rozlišit záporný nákup a záporný výkup:

- záporná nákupní cena je výhodný vstup a zachovává se;
- záporná konečná výkupní cena znamená, že zákazník za export platí;
- optimalizér proto při záporném výkupu explicitně nastaví export na nulu;
- vysílač povelů nastavuje nulový exportní limit při každém záporném intervalu,
  nejen při změně znaménka. Ochrana tak zůstane aktivní i po restartu služby.

V pracovním stromu je připravená oprava:

- FIX/FIX používá explicitní nákupní i výkupní cenu;
- záporná spotová nákupní cena se zachovává;
- při záporné výkupní ceně je export zakázaný optimalizérem i exportním limitem;
- timestamp predikce odpovídá poslednímu vstupnímu vzorku;
- produkční model jednoho střídače používá fyzický limit konkrétního zařízení;
- registrace rozděluje celkovou kapacitu elektrárny mezi její střídače;
- historie a živé snapshoty se ukládají samostatně pro všechny střídače;
- záporná hodnota odvozené živé spotřeby se neukládá jako fyzická spotřeba;
- noční výroba je oříznutá fyzikální hranicí denního světla.

„Timestamp posledního vstupního vzorku“ znamená časovou značku poslední známé
hodinové hodnoty, nikoli konec jejího intervalu. Model z něj odvozuje hodinu,
den v týdnu a počasí pro následující hodiny. Nasazený proces používá čas serveru,
což při zpožděné synchronizaci nebo zpětném dopočtu posune všechny tyto vstupy.

Nasazená legacy služba je připojená z jiného pracovního adresáře. Před zapnutím
řízení je nutné tyto změny nasadit i do ní a zopakovat audit.

## Doplněná důkazní stopa

Nová tabulka `general.energy_forecast_snapshot` uchovává:

- čas vytvoření predikce;
- cílový interval a horizont;
- původní predikovanou hodnotu;
- zdroj a verzi modelu;
- později doplněnou skutečnost a čas jejího přijetí.

Původní predikce se po příchodu reality nepřepisuje. Audit počítá přesnost jen
ze snapshotů vytvořených alespoň 60 minut před cílovým intervalem a jen tehdy,
když je známá verze modelu.

## Podmínky před aktivací řízení

1. Doplnit a ověřit konkrétní ceník Litoměřic včetně všech stálých a
   distribučních položek.
2. Doplnit souběžnou historii obou střídačů nebo prokázat, že jeden z nich v
   daném období nebyl v provozu.
3. Snížit podíl bilančně chybných intervalů pod 5 %.
4. Nasbírat alespoň 30 dní neměnných forecast snapshotů se známou verzí modelu.
5. Vyhodnotit výrobu a spotřebu po horizontech 1 h, 4 h, 12 h a 24 h proti
   sezónnímu baseline.
6. Nový model povýšit pouze tehdy, pokud zlepší baseline na odděleném časovém
   testu a nezhorší kritické zimní ani letní období.
7. Nechat řízení alespoň měsíc v shadow režimu: vytvářet plány, ale neposílat
   fyzické povely.
8. V shadow režimu ověřit limity sítě, baterie, zákaz souběžného nákupu a
   prodeje a úplný finanční rozklad.
9. Po aktivaci párovat každý plán s povelem, potvrzením střídače a naměřenou
   odezvou.

## Administrační stránka

Audit je dostupný na `/admin/audit-rizeni`. Zobrazuje:

- stav důkazů a blokující nálezy;
- denní časovou osu, kdy měřil jeden nebo oba střídače;
- červeně označené dny s dostupnými daty, ale téměř nulovou výrobou;
- interaktivní měřenou výrobu a spotřebu;
- hodinový replay výroby a spotřeby proti následně naměřené realitě;
- přesné vstupy replaye, checkpointy, souřadnice, škálování a časový počátek;
- kvalitu a fyzikální bilanci dat;
- přesnost neměnných forecast snapshotů;
- řetězec plán → povel → potvrzení → telemetrie;
- úplnost konkrétního tarifu;
- kontrolu finančního rozkladu a smart vs. self-use;
- připravenost dat pro backtest a doučení modelu.
