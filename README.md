# Spottex platforma

Spottex je full-stack platforma pro chytré řízení fotovoltaiky. V jednom Next.js projektu spojuje veřejný web, uživatelský účet, administraci, obchodní agendu, konzultace a integrační vrstvu pro energetická data.

> [!IMPORTANT]
> Adresář `legacy-flutter-app/` je pouze read-only kopie dosavadní online Flutter aplikace pro porovnání obrazovek a datových kontraktů. Next.js jej nespouští ani nepřibaluje do Docker image. Stávající produkční energetické služby se tímto projektem nemění, nerestartují ani nenahrazují; platforma se k nim připojuje jako klient přes serverové adaptéry.

## Technologie

- Next.js 15 App Router, React 19 a TypeScript
- Tailwind CSS 4 pro aplikační a administrační UI
- zachovaný CSS design veřejné landing page v `src/index.css`
- PostgreSQL 16 s oddělenou owner, aplikační a backup rolí v produkci
- Prisma 6 s databázovými schématy `general`, `auth`, `payment`, `content`, `analytics`, `consultation` a `jobs`
- Auth.js / NextAuth s e-mailem a heslem, JWT session a rolemi `USER` / `ADMIN`
- Vitest pro jednotkové a databázové integrační testy a Playwright pro plné E2E scénáře
- Docker Compose pro vývoj i produkci

## Architektura

### Veřejný web a autentizace

- `src/app/(marketing)` obsahuje landing page, blog, právní stránky a veřejný rezervační proces.
- `src/App.jsx` a `src/index.css` zachovávají původní vizuální podobu landing page.
- `src/app/(auth)` obsahuje registraci, přihlášení, ověření e-mailu a obnovu hesla. Aliasové cesty `/login`, `/signin`, `/signup` přesměrovávají na české obrazovky.
- Souhlasy s analytikou a Meta Pixelem se ukládají před spuštěním volitelného měření.

### Uživatelský účet

Chráněná část `src/app/(user)/app` používá společný `AppShell` a nabízí:

- dashboard výroby, spotřeby, baterie, sítě, cen a úspor,
- připojení energetického účtu a výběr elektrárny,
- stav předplatného služby řízení,
- košík a checkout,
- platby a faktury s tiskovým detailem; PDF se ukládá přes tiskový dialog prohlížeče,
- úpravu osobních a fakturačních údajů.

### Administrace

`src/app/admin` je chráněná rolí `ADMIN` a obsahuje:

- uživatele a ruční PROMO aktivace služby,
- předplatné, platby, faktury a košíky,
- zakladatele a referenční projekty na landing page,
- interní metriky, souhlasy, nastavení webu a Meta Pixelu,
- blog a publikaci článků,
- konzultační termíny, rezervace a napojení Google kalendáře.

### Commerce

Moduly v `src/lib/commerce` a odpovídající API pokrývají produktový košík, aktivaci služby, předplatné a vystavení faktury. Aktuálně je v produkci zapnutý režim `PAYMENT_PROVIDER=FREE`: všechny položky se aktivují za 0 Kč bez platební brány a bez časově omezeného trialu. Historická implementace GoPay zůstává neaktivní; o budoucím napojení Stripe nebo jiné brány se rozhodne až po stabilizaci služby. Peněžní hodnoty se ukládají v nejmenších jednotkách měny (`amountMinor`, `priceMinor`).

Faktura se ukládá jako neměnný databázový snapshot a zobrazuje se v tiskové HTML šabloně. Tlačítko „Vytisknout / uložit PDF“ volá tiskový dialog prohlížeče (`window.print()`); aplikace nyní negeneruje ani nearchivuje serverový PDF soubor.

> [!WARNING]
> Marketingový model „3 měsíce zdarma, poté 99 Kč měsíčně nebo 999 Kč ročně; při nižší ověřené úspoře 15 % ze skutečné úspory“ obsahuje vedle hotového zkušebního období a jednorázového checkoutu také dosud neimplementovanou variabilní složku. Automatický výpočet 15 % skutečné úspory, odsouhlasení vyúčtování a variabilní stržení kód zatím neprovádí. GoPay platby typu `ON_DEMAND` vyžadují aktivaci této merchant funkce u GoPay a samostatné obchodní, právní a účetní schválení billing metodiky. Variabilní účtování nesmí být spuštěno, dokud nebude implementované, smluvně schválené a otestované end-to-end.

### Konzultace

Rezervační systém podporuje:

- veřejné načtení volných termínů,
- dočasné podržení slotu během rezervace,
- potvrzení e-mailem,
- změnu a zrušení přes bezpečný správcovský odkaz,
- ruční i automatické generování termínů v administraci,
- Google Calendar OAuth, kontrolu kolizí a volitelný Google Meet,
- e-mailovou outbox frontu a připomínky.

Časy se ukládají v UTC a uživatelsky formátují pro `Europe/Prague`. Job runner pravidelně uvolňuje expirovaná podržení a doručuje e-maily.

### Energetický adaptér

`src/lib/energy` odděluje UI a doménový model od externích energetických API:

- `service.ts` poskytuje aplikační fasádu, kontrolu vlastnictví a bezpečný cache fallback,
- `legacy-client.ts` komunikuje se stávající Spottex službou,
- `mapping.ts` převádí externí odpovědi na interní typy,
- přístupové a refresh tokeny jsou v databázi šifrované pomocí AES-256-GCM,
- `DEMO` provider a seedovaná data umožňují vývoj bez zásahu do produkčních služeb,
- `GRIDLINK` je připravený provider; proměnné v `.env.example` jsou zatím rezervované pro jeho plný adaptér.

Bezpečnostní deaktivace nedůvěřuje lokálnímu příznaku stavu. Po zániku oprávnění posílá a ověřuje samostatný OFF pro každý podporovaný střídač na elektrárně; úloha uspěje až po konvergenci všech řiditelných zařízení.

Stávající API na portech `2086` a `45992` nejsou součástí tohoto Compose stacku. Vývojový kontejner k nim může přistupovat přes `host.docker.internal`; jejich nasazení a životní cyklus zůstávají beze změny.

V produkci musí `SPOTTEX_LEGACY_API_URL` používat interní HTTPS endpoint. Přihlášení k energetickému účtu přenáší uživatelské credentials, proto je neposílejte na původní port `2086` přes plaintext HTTP. Doporučená topologie je interní TLS reverse proxy před stávající službou. `ALLOW_INSECURE_LEGACY_HTTP=true` je vědomý nouzový override pro řízené prostředí, nikoli produkční výchozí hodnota.

### Background jobs

Kontejner `jobs` každých 30 sekund volá chráněný endpoint `/api/internal/jobs/run`. Endpoint:

- uvolní expirované konzultační holdy,
- idempotentně vytvoří nebo smaže Google události z transakčního outboxu; chyby opakuje s exponenciálním backoffem,
- označí skončená předplatná a trialy jako `EXPIRED`,
- po zániku entitlementu zpracuje transakční OFF outbox, potvrzuje fyzické vypnutí všech řiditelných elektráren a neúspěch opakuje s backoffem,
- obnoví nedokončené příkazy oprávněných uživatelů,
- každých 15 minut z read-only backendové databáze synchronizuje potvrzené i predikované OTE ceny, které už backend převedl kurzem ČNB do Kč/kWh,
- každých 6 hodin načte publikovaný snapshot energetických produktů z Costs; do lokálního katalogu uloží jen jednoznačně mapovatelné a zdrojované položky, neúplné ceníky do analýzy nepustí,
- označí nejednoznačně založené GoPay platby k ruční kontrole a periodicky dorovná propojené rozpracované platby, aniž by předčasně uvolnil jejich košík,
- zpracuje čekající e-maily v outboxu,
- nejvýše jednou za 23 hodin provede schválenou retenci a anonymizaci dat,
- vyžaduje hlavičku `Authorization: Bearer <INTERNAL_JOB_TOKEN>`.

Jeden owner-safe databázový lease brání souběhu dvou celých cyklů i při ručním vyvolání endpointu. Worker lease průběžně obnovuje a dlouhé energetické operace dělí do malých dávek; přerušené dílčí úlohy se po vypršení svého zámku vrátí do fronty. Selhání kalendáře, platebního recovery nebo bezpečného vypnutí se ukládá do auditu a aktivním administrátorům se odešle provozní upozornění.

## Porty při lokálním vývoji

| Služba | Adresa na hostu | Poznámka |
| --- | --- | --- |
| Next.js | `http://127.0.0.1:3004` | veřejný web, účet, administrace a API |
| Next.js production | `http://127.0.0.1:3005` | optimalizovaný produkční build; může běžet současně s dev serverem |
| PostgreSQL | `127.0.0.1:5435` | databáze `spottex` |
| Mailpit UI | `http://127.0.0.1:8026` | náhled vývojových e-mailů |
| Mailpit SMTP | `127.0.0.1:1026` | SMTP z hostu; kontejnery používají `mailpit:1025` |
| Legacy Spottex API | výchozí `127.0.0.1:2086` | existující externí služba, není součástí stacku |
| GridLink API | výchozí `127.0.0.1:45992` | existující / připravovaná externí služba |

Všechny porty spravované Compose jsou bindované pouze na loopback a nejsou samy o sobě veřejně dostupné.

Dev a produkční build lze spravovat jedním příkazem, aniž by se navzájem přepisovaly:

```bash
scripts/runtime-mode.sh dev       # hot reload, výchozí port 3004
scripts/runtime-mode.sh prod      # standalone production, výchozí port 3005
scripts/runtime-mode.sh both      # spustí oba stacky
scripts/runtime-mode.sh status
```

Veřejné přepnutí se provádí změnou upstreamu v samostatném reverse proxy mezi
`127.0.0.1:3004` a `127.0.0.1:3005`; databáze a tajemství zůstávají oddělené
v odpovídajícím dev/prod Compose projektu. Stav build režimu vrací `/api/health`
v poli `runtime`.

## Nejrychlejší lokální start: Docker Compose

Požadavky: Docker Engine a Docker Compose v2.

```bash
docker compose -f deploy/compose.dev.yml up --build
```

Vývojový stack:

1. sestaví `Dockerfile.dev`,
2. spustí PostgreSQL a Mailpit,
3. vygeneruje Prisma klienta,
4. aplikuje existující migrace příkazem `prisma migrate deploy`,
5. spustí Next.js dev server na portu `3004`,
6. spustí job runner.

Seed se záměrně nespouští automaticky. V druhém terminálu jej spusťte jednou:

```bash
docker compose -f deploy/compose.dev.yml exec app npm run db:seed
```

Výchozí seed vytvoří nebo aktualizuje:

- administrátora `admin@spottex.cz` s lokálním heslem `Spottex-Dev-2026!`,
- produkt chytrého řízení střídače,
- základní nastavení webu,
- deterministickou DEMO elektrárnu, měření a plán pro dashboard.

Výchozí seed heslo nikdy nepoužívejte v produkci.

Užitečné příkazy:

```bash
# Stav kontejnerů
docker compose -f deploy/compose.dev.yml ps

# Logy aplikace a job runneru
docker compose -f deploy/compose.dev.yml logs -f app jobs

# Zastavení stacku se zachováním dat
docker compose -f deploy/compose.dev.yml down

# Úplné smazání lokální DB a node_modules volume (destruktivní)
docker compose -f deploy/compose.dev.yml down -v
```

Databázová služba se jmenuje `web-db`, ne `db`. Generický název kolidoval se
stejnojmennou službou energetického backendu při slučování v `compose.full.yml`
(viz níže).

## Celý systém v jednom Compose: `deploy/compose.full.yml`

`compose.dev.yml` obsahuje jen Next.js platformu a k backendu se připojuje přes
externí síť běžícího projektu `spottex_backend`. `deploy/compose.full.yml` spustí
obě poloviny jako jeden projekt: přes `include` natáhne compose soubor
z repozitáře backendu, takže jeho definice zůstává ve vlastnictví backendu a
nekopíruje se sem.

```bash
# Ověření interpolace bez spuštění čehokoli
docker compose --env-file Secrets/spottex.development.env \
  -f deploy/compose.full.yml config -q
```

Cestu k backendu lze přepsat proměnnou `SPOTTEX_BACKEND_COMPOSE`; výchozí je
`/home/web/spottex_backend_new/docker-compose.yml`.

Mířte na checkout větve, kterou opravdu chcete provozovat, ne na libovolnou
pracovní kopii na stroji. Zastaralé kopii může chybět služba `model_sync` a
predikce pak spadnou zpět na vyřazené LSTM checkpointy místo připnutého
LightGBM vydání.

Checkout backendu potřebuje vlastní `.env` včetně `HF_TOKEN` — repozitář
`reframed-cz/PV_pred` je privátní a všechny predikční služby čekají na
`service_completed_successfully` od `model_sync`, takže bez tokenu vůbec
nenaběhne `control_broadcaster` ani `invertor_updater`.

Sjednocený projekt přebírá datové volumes běžících projektů
(`spottex_backend_postgres_data`, `redis_data`, `celery_beat_data` a
`spottex-platform-dev_spottex_dev_db`) jako externí. Bez toho by si založil
vlastní prázdné a backend by naběhl bez zákazníků, střídačů i historie měření.
Právě proto smí běžet vždy jen jeden z projektů.

Ve sloučeném projektu míří aplikace na backend přes síť projektu
(`http://web:2086`, databáze `db:5432`) místo přes `host.docker.internal`
a publikované porty.

**Nespouštějte `compose.full.yml` souběžně se samostatně běžícím projektem
`spottex_backend`.** Obě instance by obsadily porty `2086` a `5434` a obě by
provozovaly `control_broadcaster` a inverter workery proti stejným reálným
střídačům. Samostatný backend nejdřív zastavte:

```bash
docker compose -p spottex_backend \
  -f "${SPOTTEX_BACKEND_COMPOSE:-/home/anna/Documents/spottex_backend/docker-compose.yml}" down

docker compose --env-file Secrets/spottex.development.env \
  -f deploy/compose.full.yml up -d
```

## Lokální start na hostu

Požadavky: Node.js 22, npm, Docker Compose v2. PostgreSQL a Mailpit mohou běžet v kontejnerech, zatímco Next.js běží přímo na hostu.

```bash
cp .env.example .env
```

V `.env` nahraďte minimálně `AUTH_SECRET`, `APP_ENCRYPTION_KEY` a `INTERNAL_JOB_TOKEN`. Bezpečné lokální hodnoty lze vytvořit například takto:

```bash
openssl rand -base64 48   # AUTH_SECRET
openssl rand -base64 32   # APP_ENCRYPTION_KEY – musí dekódovat přesně na 32 bytů
openssl rand -hex 32      # INTERNAL_JOB_TOKEN
```

Potom spusťte závislosti a aplikaci:

```bash
docker compose -f deploy/compose.dev.yml up -d db mailpit
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Host vývoj používá `DATABASE_URL` a SMTP port z `.env.example`, tedy PostgreSQL na `5435` a Mailpit na `1026`.

### Spotové ceny a centrální katalog

- `SPOTTEX_BACKEND_DATABASE_URL` musí patřit samostatné PostgreSQL roli s
  `CONNECT`, `USAGE` na schématu `control` a pouze `SELECT` na
  `control.ote_prices_15min`. Aplikace čte příznak `prediction`; potvrzené a
  budoucí hodnoty ukládá odděleně do verzované lokální řady.
- `COSTS_INTERNAL_API_URL` a `COSTS_INTERNAL_API_KEY` připojují read-only Costs
  API. Spottex ukládá ID upstream snapshotu a archivovaný zdroj každého
  importovaného návrhu.
- `npm run sync:market` a `npm run sync:catalog` provedou ruční kontrolní
  synchronizaci. Za běžného provozu je spouští interní job runner.
- Import z Costs záměrně automaticky nepublikuje ceník, pokud chybí některá
  ekonomická veličina, platnost, daňový režim nebo archivovaný dokument.

Při host vývoji není kontejner `jobs` automaticky připojený k hostované aplikaci. Frontu lze jednorázově zpracovat ručním voláním s hodnotou z `INTERNAL_JOB_TOKEN`:

```bash
curl -fsS -X POST \
  -H 'Authorization: Bearer <INTERNAL_JOB_TOKEN>' \
  http://127.0.0.1:3004/api/internal/jobs/run
```

Pro automatické zpracování použijte celý vývojový Compose stack nebo stejný endpoint pravidelně volejte z lokálního scheduleru.

## Databáze, migrace a seed

Prisma schema je v `prisma/schema.prisma`, migrace v `prisma/migrations/`.

```bash
# Znovu vygenerovat Prisma klienta po změně schema
npm run db:generate

# Aplikovat již vytvořené migrace bez jejich vytváření
npm run db:deploy

# Vytvořit novou vývojovou migraci po úpravě schema
npm run db:migrate -- --name popis-zmeny

# Idempotentní základní seed + obnovení DEMO časové řady
npm run db:seed
```

Do sdílených a produkčních databází používejte `db:deploy`, nikoli `prisma db push`. Každá změna datového modelu musí mít verzovanou migraci.

Seed je opakovatelný pro administrátora, produkt, nastavení a DEMO site, ale záměrně obnovuje časovou řadu DEMO střídače relativně k aktuálnímu času. Při každém spuštění také bezpečně znovu zahashuje `ADMIN_SEED_PASSWORD`, přepíše hash seedovaného admina a zvýší jeho `authVersion`, čímž zneplatní jeho starší session. V produkci seed odmítne prázdný nebo placeholderový admin e-mail a heslo, které je prázdné, placeholderové, kratší než 14 znaků nebo delší než 72 UTF-8 bytů (limit bcryptu).

### Produkční databázové role

Produkce nepoužívá jeden univerzální databázový účet:

| Role | Connection string / proměnné | Oprávnění a použití |
| --- | --- | --- |
| owner | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_ADMIN_URL` | vlastník DB, migrace, granty, seed a restore |
| application | `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD`, `DATABASE_URL` | pouze runtime CRUD a sekvence ve známých schématech |
| backup | `POSTGRES_BACKUP_USER`, `POSTGRES_BACKUP_PASSWORD` | pouze `CONNECT`, `USAGE` a `SELECT` pro `pg_dump`, včetně Prisma migration ledgeru v `public` |

Migrátor se připojí přes `DATABASE_ADMIN_URL`, aplikuje Prisma migrace a spustí `scripts/grant-db-role.ts`. Skript vytvoří nebo aktualizuje hesla omezených rolí a nastaví současná i výchozí práva pro všech sedm schémat. Názvy app, backup, session/migration a databázové owner role musí být navzájem odlišné; skript kolizi odmítne ještě před `ALTER ROLE`. Aplikační kontejner nikdy nedostane owner URL ani backup credentials; backup kontejner nikdy nedostane aplikační nebo owner heslo.

## E-maily a Mailpit

E-maily se nejdříve ukládají do tabulky `jobs.email_outbox`; těla jsou v klidu šifrovaná aplikačním AES-256-GCM klíčem. Vlastní odeslání provádí job runner a po úspěšném doručení obsah těla rediguje. Přerušené `RUNNING` zprávy se bezpečně vracejí do fronty nebo po vyčerpání pokusů označí jako `FAILED`. Lokální Compose posílá přes Mailpit.

- webové rozhraní: `http://127.0.0.1:8026`
- SMTP z hostu: `127.0.0.1:1026`
- SMTP z Compose aplikace: `mailpit:1025`

Pokud je nastaven `RESEND_API_KEY`, aplikace použije Resend před SMTP. SMTP fallback je implementovaný balíčkem `emailjs` (`SMTPClient`), nikoli Nodemailerem. V produkci nastavte ověřenou odesílací doménu v `EMAIL_FROM`.

## Testy a kontrola kvality

```bash
npm run lint          # ESLint, bez povolených warningů
npm run typecheck     # TypeScript bez emitování souborů
npm test              # Vitest unit testy
npm run test:watch    # Vitest ve watch režimu
npm run test:e2e      # Playwright Chromium E2E; spustí/reuse dev server na 3004
npm run build         # Produkční Next.js build
npm run preflight     # lint + typecheck + unit testy + build
```

Jednotkové testy jsou u doménových modulů v `src/**/*.test.ts`; E2E testy jsou v `e2e/`. Před E2E testy mějte dostupnou migrovanou lokální databázi. Playwright použije existující server na portu `3004`, pokud už běží.

## Proměnné prostředí

Lokální hodnoty jsou v `.env.example`; skutečné deployment hodnoty jsou v ignorovaných souborech `Secrets/spottex.development.env` a `Secrets/spottex.production.env`. Bezpečná veřejná šablona je v `Secrets/spottex.production.env.example`. Tajemství nikdy necommitujte.
Podrobný návod, kde jednotlivé hodnoty získat a jak nastavit Google Calendar,
SolaX bridge, e-mail, GoPay a Meta Pixel, je v
[`docs/INTEGRATIONS_AND_SECRETS.md`](docs/INTEGRATIONS_AND_SECRETS.md).

### Povinné pro každé reálné nasazení

| Proměnná | Účel |
| --- | --- |
| `APP_URL` | veřejná absolutní URL bez koncového lomítka; callbacky, e-maily a platby |
| `AUTH_URL` | veřejná URL pro Auth.js, obvykle stejná jako `APP_URL` |
| `AUTH_SECRET` | silný náhodný podpisový klíč session a OAuth state |
| `APP_ENCRYPTION_KEY` | base64 klíč o přesně 32 bytech pro AES-256-GCM šifrování externích tokenů |
| `INTERNAL_JOB_TOKEN` | samostatný silný bearer token job runneru |
| `DATABASE_URL` | runtime connection string omezené aplikační role; v Compose směřuje na `db:5432` |
| `EMAIL_FROM` | ověřená adresa odesílatele |

Produkční start validuje HTTPS `APP_URL`, minimálně 32 znaků u auth/job secretů, přesně 32 dekódovaných bytů šifrovacího klíče, vypnuté automatické ověření e-mailu, důvěryhodný proxy režim a e-mailového poskytovatele. GoPay konfiguraci vyžaduje pouze při explicitním `PAYMENT_PROVIDER=GOPAY`; současný bezplatný režim ji nepoužívá.

### Produkční DB a backup secrets

| Proměnná | Účel |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | databáze a owner účet bootstrapovaný PostgreSQL kontejnerem |
| `DATABASE_ADMIN_URL` | owner connection string pouze pro migrátor, grant skript, seed a obnovu |
| `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD` | omezená aplikační role odpovídající `DATABASE_URL` |
| `POSTGRES_BACKUP_USER`, `POSTGRES_BACKUP_PASSWORD` | read-only role používaná pouze backup kontejnerem |
| `BACKUP_ENCRYPTION_PASSPHRASE` | samostatná silná fráze pro AES-256-CBC/PBKDF2 šifrování dumpů |

Všechna hesla vložená do PostgreSQL URL musí být URL-encoded. Backup image před spuštěním odmítne chybějící, krátké nebo veřejně placeholderové hodnoty; heslo backup role musí mít nejméně 20 znaků, šifrovací fráze nejméně 32 znaků a obě hodnoty musí být rozdílné. `BACKUP_ENCRYPTION_PASSPHRASE` neukládejte pouze vedle dumpů; bez ní nelze žádný `.dump.enc` obnovit.

### E-mail: zvolte jednu variantu

- Resend: `RESEND_API_KEY` a `EMAIL_FROM`.
- SMTP: `SMTP_HOST`, `SMTP_PORT`, právě jeden z režimů `SMTP_SECURE=true` (implicitní TLS, typicky port 465) nebo `SMTP_STARTTLS=true` (typicky port 587), případně dvojice `SMTP_USER` a `SMTP_PASSWORD`, plus `EMAIL_FROM`.

### Volitelné integrace

| Proměnné | Kdy jsou potřeba |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` | propojení administrátora s Google Calendar a Meet |
| `PAYMENT_PROVIDER=FREE`, `FREE_ACCESS_MODE=true`, `NEXT_PUBLIC_FREE_ACCESS_MODE=true` | současný bezplatný provoz bez platební brány; vývoj může používat `MOCK` |
| `SPOTTEX_LEGACY_API_URL`, `SPOTTEX_LEGACY_FERNET_KEY` | živé napojení na existující Spottex API; produkční URL musí být HTTPS |
| `ALLOW_INSECURE_LEGACY_HTTP` | explicitní override TLS kontroly; produkční výchozí a doporučená hodnota je `false` |
| `GRIDLINK_API_URL`, `GRIDLINK_API_TOKEN` | rezervováno pro plný GridLink adaptér |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | seedovaný admin; produkční heslo musí mít 14 znaků až 72 UTF-8 bytů, nesmí být placeholder a vždy přepíše jeho hash |
| `DEV_AUTO_VERIFY_EMAIL` | pouze lokálně; v produkci musí být `false` |

`META_PIXEL_ID` a `META_CONVERSIONS_API_TOKEN` v `.env.example` jsou rezervované pro budoucí serverovou integraci. Aktuální klientský Meta Pixel se zapíná a nastavuje v `/admin/metriky` a spustí se pouze s marketingovým souhlasem návštěvníka.

### Proxy, média a retence

| Proměnná | Produkční výchozí hodnota | Chování |
| --- | --- | --- |
| `TRUST_PROXY_HEADERS` | `true` v produkčním Compose | rate limiting použije proxy hlavičky; proxy je musí přepsat, nikoli slepě propustit od klienta |
| `PUBLIC_MEDIA_HOSTS` | `spottex.cz,www.spottex.cz` | comma-separated allowlist hostů pro HTTPS obrázky blogu, zakladatelů a referencí |
| `ANALYTICS_RETENTION_DAYS` | `395` | odstranění starých analytických událostí |
| `CONSENT_RETENTION_DAYS` | `1825` | odstranění starých záznamů souhlasu |
| `AUDIT_RETENTION_DAYS` | `730` | odstranění starých audit logů |
| `CONSULTATION_PII_RETENTION_DAYS` | `730` | anonymizace ukončených a zrušených konzultací |
| `EMAIL_OUTBOX_RETENTION_DAYS` | `7` | odstranění doručených nebo zrušených zpráv |
| `FAILED_EMAIL_RETENTION_DAYS` | `30` | odstranění neúspěšných zpráv |

Retence probíhá přes job runner nejvýše jednou za 23 hodin. Hodnoty musí být kladné celé dny a aplikace je omezuje maximálně na 3650 dní. Před změnou je slaďte se schválenými zásadami ochrany osobních údajů.

## Nasazení na nový stroj

Platforma se skládá ze tří samostatných kódových základen ve třech
repozitářích. Nesdílejí procesy ani souborový systém — mluví spolu výhradně
přes URL a přihlašovací údaje, takže každá může běžet jinde.

| Codebase | Repozitář | Kde běží |
|---|---|---|
| Next.js platforma | `ondini/spottex-test` | produkční stroj |
| Energetický backend (Flask, Celery, řízení střídačů) | `ondini/spottex_backend` | produkční stroj |
| Ceníky / katalog nákladů | samostatný repozitář | zůstává na rserveru |

Ceníky se nestěhují. Produkční stroj na ně sáhne přes **WireGuard tunel a VPS**,
autentizace tokenem; `COSTS_INTERNAL_API_URL` proto míří na adresu uvnitř
tunelu, nikdy na veřejný internet. Když je proměnná prázdná, katalog se jen
vypne a zbytek aplikace běží dál — výpadek tunelu tedy web nepoloží.

Žádný compose soubor se nepřipojuje k Docker síti jiného projektu. To by
fungovalo jen na stroji, kde náhodou běží všechno pohromadě.

### Postup na čistém stroji

Předpoklady: Docker Engine, Docker Compose v2, WireGuard, reverse proxy s TLS.

```bash
# 1. Obě repozitáře, které na stroji poběží
git clone git@github.com:ondini/spottex-test.git spottex
git clone --branch prod git@github.com:ondini/spottex_backend.git spottex_backend

# 2. Konfigurace platformy
cd spottex
cp deploy/env.production.example .env.production
```

V `.env.production` nahraďte **každý** placeholder. Bez těchto hodnot se
nasazení nerozběhne nebo se rozběhne špatně:

- `APP_URL`, `AUTH_URL` — HTTPS, jinak produkční validace start odmítne
- `AUTH_SECRET`, `APP_ENCRYPTION_KEY` (musí dekódovat přesně na 32 bytů), `INTERNAL_JOB_TOKEN`
- tři různá databázová hesla (owner, app, backup) a `BACKUP_ENCRYPTION_PASSPHRASE` uložená jinde než zálohy
- `EMAIL_FROM` a buď Resend, nebo SMTP
- `SPOTTEX_LEGACY_API_URL` (HTTPS) a `SPOTTEX_LEGACY_FERNET_KEY` vždy společně
- `COSTS_INTERNAL_API_URL` + `COSTS_INTERNAL_API_KEY` — adresa uvnitř WireGuardu
- `SPOTTEX_BACKEND_DATABASE_URL` — vyhrazená read-only role, nikdy owner backendu

Backend potřebuje vlastní `.env` ve svém adresáři, a v něm navíc `HF_TOKEN`:
repozitář `reframed-cz/PV_pred` je privátní a služba `model_sync` je blokující
závislost pěti dalších služeb. Bez tokenu nenaběhne `control_broadcaster` ani
`invertor_updater`. Adresář z `models_root` musí existovat a být zapisovatelný —
modely si `model_sync` stáhne sám na revizi připnutou v `config/config.yaml`.

```bash
# 3. Ověřte interpolaci dřív, než cokoli nastartujete
docker compose --env-file .env.production -f deploy/compose.prod.yml config --quiet

# 4. Spusťte platformu (migrace proběhnou jako one-shot služba)
docker compose --env-file .env.production -f deploy/compose.prod.yml up -d --build

# 5. Backend zvlášť, ve svém adresáři
cd ../spottex_backend && docker compose up -d --build
```

### Ověření

```bash
curl -fsS http://127.0.0.1:3005/api/health          # {"status":"ok","database":"connected"}
docker compose -p spottex_backend logs model_sync   # musí skončit s kódem 0
```

Dál zkontrolujte, že `invertor_updater` čte střídače, že `prices_updater`
zapisuje predikce, a že aplikace dosáhne na ceníky přes tunel.

Seed spouštějte jen vědomě — každý běh přehashuje `ADMIN_SEED_PASSWORD`,
zapíše ho adminovi a zvýší `authVersion`, čímž zneplatní jeho existující
relace.

### Předání tajemství: `scripts/collect-deployment-bundle.sh`

Nic z výše uvedeného není v gitu a být nemá. Skript posbírá to, co gitu chybí,
**ověří úplnost** a výsledek zašifruje:

```bash
scripts/collect-deployment-bundle.sh            # výchozí výstup do kořene repozitáře
scripts/collect-deployment-bundle.sh -b /cesta/k/spottex_backend -o /tmp
```

Sbírá produkční env platformy, `.env` backendu a Codex přihlášení pro parser
faktur. Přidá `README.md` s postupem a `MANIFEST.md`, který vypisuje **jen názvy
klíčů, nikdy hodnoty** — manifest tedy jde poslat i kanálem, kterým se předání
domlouvá.

Než něco zapíše, kontroluje mimo jiné:

- že `APP_URL` je HTTPS a `APP_ENCRYPTION_KEY` dekóduje přesně na 32 bytů,
- že owner, app a backup heslo k databázi jsou tři různá a záložní passphrase je
  odlišná od nich,
- že backendový `.env` má `HF_TOKEN` (bez něj `model_sync` zablokuje řízení),
- že `COSTS_INTERNAL_API_URL` nemíří na jméno platné jen na jednom stroji,
- že `SPOTTEX_LEGACY_API_URL` je HTTPS, pokud není vědomě povolena výjimka,
- SMTP jen když není nastavený Resend, GoPay jen při `PAYMENT_PROVIDER=GOPAY`.

Když něco chybí nebo v tom zůstal placeholder, **skript balíček nevytvoří** a
vypíše seznam. To je záměr: nasazení má selhat tady, ne v noci na stroji, kam
nikdo nevidí. Vynutit jde přes `--force`.

Passphrase se bere z `BUNDLE_PASSPHRASE`, jinak se na ni skript zeptá. Posílejte
ji **jiným kanálem než balíček**.

Rozbalení na cílovém stroji:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in spottex-handover-<timestamp>.tar.gz.enc | tar -xzf -
```

Zbytek — WireGuard peer, DNS a TLS, databázové role, off-site zálohy a plán
návratu — skript udělat nemůže; jsou vypsané v `README.md` uvnitř balíčku.
Předání pořád potřebuje jmenovitě určeného správce, stejně jako rotace klíčů,
obnova zálohy a přístup k logům, když v noci selže řízení střídačů.

## Produkční nasazení přes Docker Compose

Produkční stack očekává soubor `Secrets/spottex.production.env`. Interní klíče
jsou v pracovním prostředí už vygenerované; externí integrace označené
`DOPLNIT UŽIVATELEM` doplňte podle `Secrets/README.md`. Při vytváření čistého
nasazení začněte šablonou a nastavte práva pouze pro provozního uživatele:

```bash
cp Secrets/spottex.production.env.example Secrets/spottex.production.env
sudo chown root:root Secrets/spottex.production.env
sudo chmod 600 Secrets/spottex.production.env
```

Nahraďte každý placeholder a zejména použijte tři různá databázová hesla a čtvrté samostatné tajemství pro backupy:

```dotenv
POSTGRES_DB=spottex
POSTGRES_USER=spottex_owner
POSTGRES_PASSWORD=<owner-heslo>
POSTGRES_APP_USER=spottex_app
POSTGRES_APP_PASSWORD=<jine-app-heslo>
POSTGRES_BACKUP_USER=spottex_backup
POSTGRES_BACKUP_PASSWORD=<jine-backup-heslo>
DATABASE_ADMIN_URL=postgresql://spottex_owner:<url-encoded-owner-heslo>@db:5432/spottex?schema=public
DATABASE_URL=postgresql://spottex_app:<url-encoded-app-heslo>@db:5432/spottex?schema=public
BACKUP_ENCRYPTION_PASSPHRASE=<samostatna-dlouha-fraze>

APP_URL=https://spottex.cz
AUTH_URL=https://spottex.cz
DEV_AUTO_VERIFY_EMAIL=false
SPOTTEX_LEGACY_API_URL=https://legacy-api.internal.spottex.cz
SPOTTEX_LEGACY_FERNET_KEY=<platny-32-byte-fernet-klic>
ALLOW_INSECURE_LEGACY_HTTP=false
```

Compose už nepoužívá `env_file`. Proměnné z `Secrets/spottex.production.env` slouží pouze k interpolaci a každá služba dostává explicitní minimální seznam. Proto musí být `--env-file Secrets/spottex.production.env` součástí každého produkčního Compose příkazu.

Pokud aktualizujete prostředí, ve kterém už běžela starší vývojová verze konzultačního outboxu, před nasazením zkontrolujte nevyřízené CREATE úlohy verze 1. Aktuální worker záměrně přijímá jen šifrovaný snapshot verze 2, aby retry nikdy nezměnil cílový kalendář:

```sql
SELECT id, status, "runAt"
FROM jobs.scheduled_job
WHERE type = 'CONSULTATION_CALENDAR_CREATE'
  AND payload->>'version' IS DISTINCT FROM '2';
```

V tomto novém Spottex nasazení takové úlohy nevznikají. Pokud query při upgradu cokoli vrátí, nejdřív je v původní verzi bezpečně zpracujte nebo individuálně migrujte; nový worker nad nimi nespouštějte naslepo.

Spuštění nebo aktualizace:

```bash
sudo docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml config --quiet
sudo docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml up -d --build
sudo docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml ps
sudo docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml logs -f migrate app jobs db_backup
```

Služba `migrate` se připojí jako DB owner, jednorázově provede `prisma migrate deploy` a následně vytvoří/aktualizuje omezené role a granty. `app` se spustí až po úspěšné migraci a `jobs` až po úspěšném healthchecku aplikace. Job runner zapisuje po úspěšném cyklu marker do svého tmpfs; pokud se žádný cyklus nedokončí 45 minut, jeho healthcheck přejde do `unhealthy`. Produkční monitoring musí upozorňovat na nezdravý stav `app`, `jobs`, `db` i `db_backup`.

Produkční aplikační image je Next standalone runtime bez zdrojového stromu a vývojových nástrojů. Proces běží jako neprivilegovaný uživatel `nextjs` (UID 1001); Compose používá read-only root filesystem, zahodí capabilities, zapne `no-new-privileges` a poskytne pouze omezené tmpfs pro `/tmp` a Next cache. Stejné read-only/no-capabilities omezení mají job a backup služby. Databáze, aplikace i pomocné kontejnery mají nastavené resource limity.

První seed spusťte vědomě až po úspěšném startu a s bezpečným `ADMIN_SEED_PASSWORD` z produkčního env. Runtime image seed nástroje neobsahuje, proto se používá migrátor:

```bash
docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  run --rm migrate npx tsx prisma/seed.ts
```

Pozor: seed přidává také DEMO elektrárnu k seedovanému adminovi. Při opakovaném spuštění vždy přepíše hash jeho hesla hodnotou z env a zneplatní starší admin session; jde o vědomou rotaci, nikoli o „create only“ operaci.

Ověření aplikace z hostu:

```bash
curl -fsS http://127.0.0.1:3005/api/health
```

Produkční Compose nevystavuje databázi a aplikaci publikuje pouze na `127.0.0.1:${SPOTTEX_PROD_PORT:-3005}`. Veřejný provoz musí vést přes samostatný reverse proxy s TLS. Produkce má `TRUST_PROXY_HEADERS=true`, takže proxy musí odstranit klientem dodané `X-Forwarded-For` / `X-Real-IP` a vytvořit vlastní důvěryhodné hodnoty; jinak lze obejít nebo zkreslit rate limiting. Tento stack existující energetické služby pouze čte přes omezené adaptéry a nesmí je restartovat ani měnit.

## Backup a restore

### Automatické zálohy

Služba `db_backup` používá pouze read-only DB roli. Jednou denně vytvoří PostgreSQL custom dump (`pg_dump -Fc`), za běhu ho zašifruje pomocí AES-256-CBC, PBKDF2 a náhodné soli a teprve atomicky uloží soubor `*.dump.enc` do volume `spottex_backups`. Do volume se nemá zapsat nezašifrovaný dump; soubory starší než 14 dní služba maže. Po úspěchu atomicky obnoví marker `.last-success`; neúspěch atomicky zaznamená do `.last-failure`, nezanechá částečný `*.tmp` soubor a další pokus provede za 15 minut. Docker healthcheck přejde do `unhealthy` po novějším neúspěchu nebo pokud není úspěšná záloha mladší než 26 hodin. `BACKUP_ENCRYPTION_PASSPHRASE` uchovávejte odděleně od zálohy — bez ní obnovu nelze provést.

Docker health status je lokální signál, nikoli doručovací kanál. V produkčním monitoringu nastavte alert na `db_backup=unhealthy` a na stáří posledního off-site souboru; alert musí směřovat alespoň dvěma správcům mimo samotný server.

```bash
# Seznam šifrovaných dumpů uvnitř backup kontejneru
docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec db_backup sh -lc 'ls -lh /backups/*.dump.enc'

# Zkopírování konkrétního šifrovaného dumpu na host
mkdir -p backups
docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml cp \
  db_backup:/backups/spottex-YYYYMMDD-HHMMSS.dump.enc \
  ./backups/
```

Docker volume není off-site záloha. Pravidelně exportujte soubory `*.dump.enc` na oddělené úložiště a monitorujte úspěch, stáří i velikost záloh. Zálohovací heslo zálohujte jiným bezpečným kanálem.

Ruční šifrovaný dump lze vytvořit přímo na hostu bez mezilehlého plaintext souboru:

```bash
mkdir -p backups
docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec -T db_backup sh -lc \
  'set -o pipefail; PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE' \
  > "backups/spottex-manual-$(date +%Y%m%d-%H%M%S).dump.enc"
```

### Povinný test obnovy

Obnovu pravidelně nacvičujte do dočasné databáze, ne přes produkční data. Následující postup čte šifrovaný soubor z hostu, dešifruje ho v jednorázovém backup kontejneru a plaintext vede pouze rourou do `pg_restore`:

```bash
set -o pipefail

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --maintenance-db=postgres --if-exists --force spottex_restore_test && PGPASSWORD="$POSTGRES_PASSWORD" createdb -h 127.0.0.1 -U "$POSTGRES_USER" --maintenance-db=postgres spottex_restore_test'

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  run --rm --no-deps -T db_backup \
  openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  < backups/spottex-YYYYMMDD-HHMMSS.dump.enc | \
docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d spottex_restore_test --no-owner --exit-on-error'

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d spottex_restore_test -c "SELECT count(*) FROM general.users;"'

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --maintenance-db=postgres --if-exists --force spottex_restore_test'
```

### Obnova produkce

Produkční restore je destruktivní operace. Nejprve vytvořte aktuální šifrovaný dump, ověřte obnovitelnost zvoleného souboru, potvrďte správnou databázi a naplánujte odstávku. Příklad předpokládá, že je soubor už bezpečně zkopírovaný do `./backups` na hostu:

```bash
set -o pipefail

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  stop app jobs db_backup

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --maintenance-db=postgres --if-exists --force "$POSTGRES_DB" && PGPASSWORD="$POSTGRES_PASSWORD" createdb -h 127.0.0.1 -U "$POSTGRES_USER" --maintenance-db=postgres "$POSTGRES_DB"'

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  run --rm --no-deps -T db_backup \
  openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  < backups/spottex-YYYYMMDD-HHMMSS.dump.enc | \
docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  exec -T db sh -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error'

docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  run --rm migrate
docker compose --env-file Secrets/spottex.production.env -f deploy/compose.prod.yml \
  up -d app jobs db_backup
curl -fsS http://127.0.0.1:3005/api/health
```

Migrátor po obnově doplní případné novější migrace a znovu nastaví omezené app/backup granty. Po obnově zkontrolujte přihlášení, poslední platby, faktury, rezervace, stav outboxu a dashboard energetických dat. Plaintext dump nikdy neukládejte na disk a heslo neposílejte v argumentu nebo shell historii.

## Checklist před produkcí

- [ ] Vygenerovat unikátní `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `INTERNAL_JOB_TOKEN`, oddělená hesla owner/app/backup DB rolí a samostatnou `BACKUP_ENCRYPTION_PASSPHRASE`; odstranit všechny vývojové hodnoty.
- [ ] Nastavit `DEV_AUTO_VERIFY_EMAIL=false` a ověřit registraci, ověření e-mailu a obnovu hesla přes produkčního poskytovatele.
- [ ] Zkontrolovat údaje prodávajícího, číslování faktur, sazby DPH, právní texty a fakt, že faktura se nyní tiskne/ukládá přes prohlížeč a server nearchivuje PDF, s účetním / právníkem.
- [ ] Nastavit bezpečného prvního admina; produkční seed vyžaduje heslo délky 14 znaků až 72 UTF-8 bytů a jeho opakované spuštění rotuje hash i zneplatní staré session.
- [ ] Založit Google OAuth aplikaci, přesně povolit produkční redirect URI a otestovat připojení, odpojení, kolize i Google Meet.
- [ ] Přepnout jednorázové GoPay platby ze sandboxu na správné prostředí, ověřit credentials, návratovou URL, notifikační URL, idempotenci a refund/cancel proces.
- [ ] Před automatickou variabilní fakturací 15 % úspory získat aktivaci GoPay `ON_DEMAND` u obchodníka, samostatně schválit obchodní/právní/účetní metodiku a teprve potom implementovat a E2E otestovat recurring flow; současný kód ho neumí.
- [ ] Připojit produkční legacy energetické API pouze přes interní HTTPS/TLS proxy a serverové secrets; `ALLOW_INSECURE_LEGACY_HTTP` ponechat `false` a otestovat cache fallback bez zásahu do stávajících služeb.
- [ ] Nastavit reverse proxy, TLS, bezpečnostní hlavičky a omezení requestů; při `TRUST_PROXY_HEADERS=true` odstranit klientské `X-Forwarded-For`/`X-Real-IP` a nastavit vlastní hodnoty.
- [ ] Nastavit `PUBLIC_MEDIA_HOSTS` pouze na schválené HTTPS hosty a sladit retenční lhůty analytiky, souhlasů, auditu, konzultací a e-mailového outboxu se schválenými zásadami.
- [ ] Rozhodnout o Meta Pixelu a souhlasové liště; ověřit, že se Pixel bez marketingového souhlasu nenačítá.
- [ ] Ověřit `npm run preflight` nad release commitem.
- [ ] Nastavit off-site ukládání `*.dump.enc`, oddělenou úschovu hesla, monitoring neúspěšných dumpů a alert na healthcheck/job runner.
- [ ] Provést a zdokumentovat skutečný decrypt/restore test z posledního produkčního `*.dump.enc` bez uložení plaintext dumpu.
- [ ] Připravit rollback image a databázový postup před každou nevratnou migrací.

## Důležité adresáře

```text
src/app/                  Next.js stránky, layouty a API route handlers
src/components/           veřejné, aplikační a administrační komponenty
src/lib/                  doménové služby, adaptéry, auth, e-mail a Prisma
prisma/                   schema, migrace a seed
deploy/                   vývojový a produkční Docker Compose
e2e/                      Playwright end-to-end scénáře
legacy-flutter-app/       read-only reference dosavadní online aplikace
```
