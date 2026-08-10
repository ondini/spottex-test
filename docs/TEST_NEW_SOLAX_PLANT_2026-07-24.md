# Test připojení nové elektrárny SolaX — 2026-07-24

## Cíl

Ověřit na `https://dev1.spottex.cz`, že účet SolaX s více elektrárnami:

1. nejdřív vrátí seznam dostupných elektráren bez zápisu do databáze,
2. dovolí uživateli vybrat jednu elektrárnu,
3. zaregistruje a uloží pouze vybranou elektrárnu,
4. nezapne automaticky řízení ani optimalizaci měniče.

## Nasazená oprava

- Legacy backend: větev `integration/dev-registration-20260724`
- Commit backendu: `146ff31 Add selected SolaX plant onboarding`
- Veřejné API: `http://api2.spottex.cz:2086`
- Nové endpointy:
  - `POST /discover_plants`
  - `POST /register_selected`
- Webová aplikace používá dvoukrokový formulář:
  - `Načíst elektrárny`
  - `Připojit vybranou`

Při načtení seznamu se údaje pouze čtou ze SolaX Cloud. Registrace se provede až po
výběru konkrétní elektrárny. Čtení metadat nemění nastavení `HotStandby` a nově
registrovaný měnič má `optimization_running = false`.

## Výchozí stav před ručním testem

Čas záznamu: `2026-07-24T11:18:22+02:00`

Legacy databáze:

| Metrika | Hodnota |
| --- | ---: |
| Uživatelé | 4 |
| Odběrná místa | 4 |
| Zařízení | 4 |
| Měniče | 4 |
| Baterie | 4 |
| Měniče s aktivní optimalizací | 0 |
| Nejvyšší `device_id` | 35 |

Databáze dev1 pro účet `michal.polic@centrum.cz`:

| Metrika | Hodnota |
| --- | ---: |
| ID uživatele | 898 |
| Role | USER |
| Stav | ACTIVE |
| Energetická propojení | 0 |
| Elektrárny | 0 |

## Automatické kontroly před testem

- Legacy backend: 20 testů úspěšných.
- Web: 46 testovacích souborů úspěšných, 135 testů úspěšných, 38 přeskočených.
- TypeScript typecheck: úspěšný.
- Cílený ESLint změněných souborů: úspěšný.
- `OPTIONS http://api2.spottex.cz:2086/discover_plants`: HTTP 200.
- `OPTIONS http://api2.spottex.cz:2086/register_selected`: HTTP 200.
- `GET https://dev1.spottex.cz/prihlaseni`: HTTP 200.

## Očekávaný stav po úspěšném testu

- Po kroku `Načíst elektrárny` zůstanou počty v obou databázích beze změny.
- Po kroku `Připojit vybranou` přibude v účtu dev1 jedno propojení a právě jedna
  elektrárna.
- V legacy databázi přibude pouze vybrané odběrné místo a jeho zařízení; ostatní
  elektrárny ze SolaX účtu se nezaregistrují.
- Optimalizace zůstane vypnutá.
- Historická data se začnou stahovat na pozadí, takže grafy a výpočet úspor nemusí
  být vyplněné okamžitě.

## Výsledek ručního testu

Test proveden přibližně v `2026-07-24T11:25:26+02:00`.

- Web odeslal první krok na `POST /api/app/energy/connect`.
- Legacy backend se úspěšně přihlásil do SolaX Cloud.
- SolaX API vrátilo 10 elektráren.
- Požadavek skončil po 25,122 sekundy odpovědí HTTP 502.
- K výběru ani registraci konkrétní elektrárny se proces nedostal.
- Obě databáze zůstaly beze změny:
  - legacy: 4 uživatelé, 4 odběrná místa, 4 zařízení, 4 měniče, 4 baterie,
    0 aktivních optimalizací, nejvyšší `device_id` 35,
  - dev1 účet `michal.polic@centrum.cz`: 0 propojení, 0 elektráren.

Příčina:

`mobile_server/solax_dev_api.py::parse_address` předpokládá, že každá adresa
obsahuje alespoň dvě části oddělené čárkou. Třetí vrácená elektrárna
`MS Slunicko` má adresu `Usti nad Labem-Litomerice--Alšova`, takže
`address.split(",")` obsahuje jen jednu položku a přístup k `parsed[1]` vyvolá
`IndexError: list index out of range`. V účtu jsou i další nestandardní adresy,
včetně samostatného čísla `428`, které musí parser rovněž přijmout.

Vedlejší bezpečnostní nález:

Legacy backend zapisuje do aplikačního logu celé odpovědi autorizačního API,
včetně citlivých tokenů a klientských údajů. Hodnoty nejsou v tomto protokolu
uvedeny; logování musí být při opravě odstraněno nebo redigováno.

## Oprava po prvním ručním testu

Nasazeno `2026-07-24T11:38:53+02:00`.

- Backend commit: `5ccdef0 Make SolaX onboarding retry-safe`
- Parser adres přijímá všech 10 tvarů adres zachycených z testovaného účtu,
  včetně volného textu bez čárek a samotného čísla `428`.
- První krok ukládá na 30 minut šifrovaný kontext objevených elektráren do
  Redis.
- Druhý krok používá tento kontext a neopakuje Selenium přihlášení do
  developerského portálu SolaX.
- Redis zámek brání souběžné registraci po dvojitém kliknutí.
- Kontext se odstraní až po úspěšné registraci; při chybě zůstane do vypršení
  dostupný pro kontrolovaný retry.
- Selenium pro developerský portál i metadata nyní vždy zavře Chrome také při
  výjimce.
- Z logů byly odstraněny klientské tajné údaje, API token a celé odpovědi SolaX.

Ověření bez živého přihlášení do SolaX:

- 30 backendových testů úspěšných.
- Ruff úspěšný.
- Šifrovaný Redis round-trip proti běžícímu Redis úspěšný.
- 46 webových testovacích souborů úspěšných, 135 testů úspěšných,
  38 přeskočených.
- TypeScript typecheck a cílený ESLint úspěšné.
- Backend i `dev1.spottex.cz` po restartu zdravé.
- Nebyl odeslán žádný další živý požadavek na SolaX.
- Databáze zůstaly na původním výchozím stavu.

## Pokračování testu a cesta k analýze úspor

Test pokračoval po nasazení opravy parseru:

- seznam 10 elektráren se vypsal správně,
- uživatel vybral `MS Vetrnik`,
- elektrárna se připojila jako odběrné místo `34`,
- web ji uložil jako elektrárnu `437`,
- elektrárna má dva střídače (`device_id` 36 a 37),
- řízení zůstalo vypnuté.

První registrace odhalila, že původní implementace znovu otevírala Selenium kvůli
technickým údajům pro řízení. Tento druhý login byl odstraněn. Připojení je nyní
„analysis first“: k registraci a historii používá už jednou načtený šifrovaný
discovery kontext; technické údaje nutné pouze pro řízení se doplní později na
výslovný pokyn uživatele.

Nasazené backendové commity:

- `9ab7d34 Add multi-plant onboarding and history export`
- `75427db Backfill analysis intervals after full history`
- `50d2ade Make full history imports resumable`
- `f81b553 Backfill only completed history windows`
- `32b0ec0 Hold history export until backfill is ready`
- `4a24aab Speed up historical interval backfill`
- `9429dcc Normalize history intervals across DST`

Nové chování:

- `POST /register_selected` přijme jednu i více elektráren,
- formulář nabízí `Připojit vybranou` i `Připojit všechny`,
- discovery kontext se spotřebuje jednou pro celý hromadný výběr,
- registrace už neprovádí druhé Selenium přihlášení,
- pro každou novou elektrárnu se spustí recentní i plný historický import,
- elektrárna bez baterie se zpracuje s nulovým tokem baterie místo pádu,
- prázdná odpověď SolaX před uvedením elektrárny do provozu se považuje za
  prázdné období, ne za chybu,
- chráněný `GET /history_intervals` předává nové aplikaci agregovanou výrobu a
  spotřebu všech střídačů v daném odběrném místě,
- po plném stažení se mezipaměť převádí do 15minutových tabulek pro analýzu.

Další provozní opravy z reálného importu:

- původní roční Celery úloha překračovala devítiminutový soft limit a retry
  začínal znovu od začátku,
- plný import je proto rozdělen do obnovitelných a globálně rate-limitovaných
  částí; každá část se samostatně uloží a další naváže pevným koncem původního
  období,
- převod do analytických 15minutových tabulek proběhne až po stažení souvislého
  období, aby se mezera mezi starší historií a posledními živými daty
  nevyplnila odhadem,
- závěrečný převod používá přesnou integraci lineárních úseků a dávkové zápisy
  místo sekundového vzorkování a jednotlivých SQL příkazů,
- export historie během této přípravy vrací dočasný stav, takže nová aplikace
  část automaticky zopakuje a nepovažuje předčasně prázdnou odpověď za hotovou,
- nové importní části mají osm pokusů s odstupem, aby bezpečně počkaly na
  rate-limitovaný zdroj.

Stav dat při zahájení importu:

| Metrika | Hodnota |
| --- | ---: |
| Společné 15minutové intervaly výroby a spotřeby | 380 |
| Úplná historie | přibližně 4 dny |
| Požadované období importu | 365 dní |
| Počet importních částí v nové aplikaci | 27 |
| Publikované cenové produkty v katalogu | 0 |

Elektrárna byla podle SolaX vytvořena `2025-10-24`, takže nemůže mít celý rok
reálných dat. Výsledná analýza proto musí výslovně uvést skutečné období a nesmí
krátký vzorek vydávat za roční měření.

Finální ověřený stav po dokončení reálného importu:

| Metrika | Hodnota |
| --- | ---: |
| Importní části nové aplikace | 19/19 |
| Nevratně chybné části | 0 |
| Importované agregované intervaly | 26 213 |
| Společné intervaly výroby a spotřeby | 26 209 |
| Chybějící intervaly ve skutečném období | 4 |
| Skutečné období | 24. 10. 2025 – 24. 7. 2026 |
| Úplné dny | 273 |
| Pokrytí skutečného období | 100 % |
| Pokrytí posledních 30 / 90 dní | 100 % / 100 % |
| Jistota analýzy | MEDIUM – orientační |

Reálný průchod navíc odhalil přechod na zimní čas: lokální interval
`02:45–03:00` by při samostatném převodu obou hran vypadal v UTC jako 75 minut.
Export nyní převádí začátek a zachovává invariant skutečných 15 minut. Nová
aplikace ukládá dlouhé části hromadně a zachovává audit oprav existujících
hodnot, takže nepřekračuje pětisekundový výchozí limit transakce.

Databáze při kontrole neobsahovala žádnou publikovanou verzi standardního
produktového ani distribučního ceníku. Analýza proto zobrazuje srozumitelný
blokující stav a nevytváří domnělé ceny. Pro skutečný výpočet je nutné
publikovat ověřené ceníky a potvrdit technický profil elektrárny.

Dashboard byl změněn tak, aby:

- měl přepínač mezi více elektrárnami,
- ukazoval jeden klidný stav přípravy dat s progress barem,
- zobrazil počet úplných dnů, přesné období a procento pokrytí,
- schoval dílčí technické nedostatky do rozbalovacích podrobností,
- při čekání na graf zobrazil načítání,
- vedl uživatele primárně na `Spočítat úspory`,
- vysvětlil, že výpočet platí jen pro skutečně dostupné období,
- rozlišoval orientační odhad od sezónního srovnání s alespoň přibližně 300 dny
  kvalitních dat,
- odkaz na analýzu zachoval právě vybranou elektrárnu.

Po prvním reálném otevření analýzy byla odstraněna další slepá ulička:

- neaktivní tlačítko výpočtu se už netváří jako běžně spustitelné,
- stránka vždy výslovně rozlišuje stav „výpočet neběží“, „čeká ve frontě“,
  „počítáme varianty“ a „dokončeno“,
- při chybějícím potvrzení profilu nabízí přímo akci
  `Doplnit a potvrdit údaje`,
- při chybějícím katalogu ukazuje `Čekáme na ověření ceníků`,
- běžící výpočet zobrazuje fázi, progress bar, počet hotových scénářů a
  automatické obnovení po čtyřech sekundách,
- karta popisující algoritmus byla přejmenována na `Metodika výpočtu`, aby se
  nepletla se skutečným stavem úlohy.

Ověření:

- backend Ruff úspěšný,
- 34 cílených backendových testů registrace, historie a startu aplikace úspěšných,
- samostatný test převodu plné historie úspěšný,
- frontend TypeScript a ESLint úspěšné,
- cílené unit testy klienta, chunkingu a datové kvality: 12/12,
- optimalizovaný Next.js build úspěšný,
- Playwright cesta `připojení → výběr → technický profil → doporučení` úspěšná,
- žádný z těchto ověřovacích kroků neprovedl další Selenium login do SolaX.
