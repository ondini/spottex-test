# Integrace a secrets Spottex

Tento soubor je provozní checklist. Skutečné secrets patří pouze do ignorovaných
souborů ve složce `Secrets/` nebo do externího secret manageru. Nikdy je
nevkládejte do Gitu, Figmy, ticketu ani do klientského JavaScriptu.

Výchozí šablony:

- lokální vývoj: `Secrets/spottex.development.env`
- produkce: `Secrets/spottex.production.env`
- bezpečná šablona: `Secrets/spottex.production.env.example`

Interní podpisové a šifrovací klíče i databázová hesla jsou v místních env
souborech již vygenerované. Vy doplňujete pouze hodnoty označené komentářem
`DOPLNIT UŽIVATELEM`.

## 1. Základ aplikace

| Proměnná | Jak ji získat |
| --- | --- |
| `APP_URL` | Veřejný origin aplikace bez koncového lomítka, lokálně `http://localhost:3004`, v produkci například `https://spottex.cz`. |
| `AUTH_URL` | Stejná hodnota jako `APP_URL`. |
| `AUTH_SECRET` | Vygenerujte `openssl rand -base64 48`. Podepisuje sessions a OAuth state. |
| `APP_ENCRYPTION_KEY` | Vygenerujte `openssl rand -base64 32`. Musí dekódovat na přesně 32 bytů; šifruje externí tokeny AES-256-GCM. |
| `INTERNAL_JOB_TOKEN` | Vygenerujte samostatně `openssl rand -base64 48`. Používá jej pouze kontejner `jobs`. |
| `DEV_AUTO_VERIFY_EMAIL` | Používejte `false` lokálně i v produkci. Lokální ověřovací e-maily zachytí Mailpit, takže testujete stejný proces jako uživatel. |
| `TRUST_PROXY_HEADERS` | Lokálně `false`; v produkci za reverzní proxy `true`, přičemž proxy musí příchozí forwarding hlavičky přepisovat. |

Každý klíč generujte zvlášť. Nepoužívejte jednu hodnotu pro více účelů.

## 2. PostgreSQL a zálohy

Lokální Compose používá databázi `spottex` na `127.0.0.1:5435` a vývojové
hodnoty ze souboru `Secrets/spottex.development.env`.

V produkci vytvořte čtyři nezávislé náhodné hodnoty:

```bash
openssl rand -base64 36  # POSTGRES_PASSWORD
openssl rand -base64 36  # POSTGRES_APP_PASSWORD
openssl rand -base64 36  # POSTGRES_BACKUP_PASSWORD
openssl rand -base64 48  # BACKUP_ENCRYPTION_PASSPHRASE
```

`DATABASE_ADMIN_URL` používá owner účet jen pro migrace. `DATABASE_URL` používá
omezený aplikační účet. Speciální znaky v heslech URL-enkódujte. Backup frázi
uchovávejte i mimo server; bez ní nelze šifrovaný dump obnovit.

## 3. E-mail

Lokálně není potřeba externí účet:

- SMTP `127.0.0.1:1026`
- web Mailpit `http://127.0.0.1:8026`
- `DEV_AUTO_VERIFY_EMAIL=false`

Po registraci otevřete Mailpit, rozklikněte zprávu **Ověřte svůj účet Spottex** a
klikněte na aktivační odkaz. Stejně zde uvidíte obnovu hesla i potvrzení
konzultace. Pro lokální testování tedy nepotřebujete Resend ani skutečné SMTP
údaje.

Pro produkci zvolte právě jednu variantu.

### Resend

1. V [Resend Domains](https://resend.com/domains) přidejte odesílací doménu.
2. V DNS nastavte požadované SPF/DKIM záznamy a počkejte na ověření.
3. Vytvořte API key pouze pro odesílání a vložte jej do `RESEND_API_KEY`.
4. `EMAIL_FROM` musí používat ověřenou doménu, například `Spottex <noreply@spottex.cz>`.

### SMTP

Údaje vydá správce e-mailového serveru. Pro port 465 nastavte
`SMTP_SECURE=true`, `SMTP_STARTTLS=false`; pro port 587 opačně. Uživatelské
jméno a heslo se nastavují vždy společně.

## 4. Google Calendar a Meet

1. V [Google Cloud Console](https://console.cloud.google.com/) vytvořte nebo
   vyberte projekt Spottex.
2. V **APIs & Services → Library** zapněte **Google Calendar API**.
3. V **Google Auth Platform / OAuth consent screen** nastavte název aplikace,
   kontaktní e-mail a autorizované domény. Dokud je aplikace v režimu Testing,
   přidejte administrátorský Google účet mezi test users.
4. V **Credentials → Create credentials → OAuth client ID** zvolte
   **Web application**.
5. Přidejte přesnou redirect URI:
   - lokálně: `http://localhost:3004/api/admin/google-calendar/callback`
   - produkce: `https://spottex.cz/api/admin/google-calendar/callback`
6. Client ID vložte do `GOOGLE_CALENDAR_CLIENT_ID`, client secret do
   `GOOGLE_CALENDAR_CLIENT_SECRET` a tutéž callback adresu do
   `GOOGLE_CALENDAR_REDIRECT_URI`.
7. Restartujte aplikaci a v **Administrace → Konzultace** klikněte na propojení
   Google účtu. Heslo ke Google účtu se do Spottex nikdy nezadává.

Všechny tři Google proměnné musí být buď vyplněné společně, nebo společně
prázdné.

## 5. SolaX Cloud a energetická data

Uživatelské přihlašovací údaje SolaX nejsou globální secret a nepatří do `.env`.
Uživatel je zadá ve svém účtu přes **Připojit SolaX Cloud**. Heslo nový web
neukládá; použije jej jednorázově vůči energetické službě. Uloží pouze přístupové
tokeny zašifrované pomocí `APP_ENCRYPTION_KEY`.

Současný read-only bridge potřebuje:

| Proměnná | Zdroj |
| --- | --- |
| `SPOTTEX_LEGACY_API_URL` | Interní HTTPS adresa původní energetické služby. Lokálně může být `http://127.0.0.1:2086`. Produkčně ji vystavte jen přes interní TLS/reverse proxy. |
| `SPOTTEX_LEGACY_FERNET_KEY` | Existující 32bytový Fernet klíč provozované energetické služby. Musí jej bezpečně předat její správce; nový náhodný klíč nebude s existujícím API fungovat. |
| `ENERGY_SYNC_INTERVAL_MINUTES` | Interval read-only synchronizace, doporučeně `5`. Runner kontroluje frontu každých 30 sekund. |

Fernet klíč nekopírujte z logů ani z běžícího kontejneru do dokumentace. Pro
produkci jej přeneste mezi správci přes secret manager.

Důležité omezení současného bridge: přihlášení funguje pro SolaX účet, který už
byl bezpečně onboardován v původní energetické službě. Její starý endpoint
`/register` nelze použít pro read-only test, protože po registraci automaticky
spouští řídicí worker. Pro zcela nový SolaX účet je proto potřeba samostatný
read-only onboarding kontrakt s výchozím `optimization_running=false`; do jeho
nasazení se na reálné elektrárně nesmí testovat starý `/register`.

Spottex web odděluje oprávnění takto:

- připojení, měření, ukládání historie a simulace nevyžadují předplatné a nikdy
  neposílají povel střídači;
- `turnon`/`turnoff` zůstává oddělený auditovaný příkaz, vyžaduje aktivní
  předplatné/PROMO a výslovnou akci uživatele;
- pro read-only ověření použijte dedikovaný SolaX test účet s vypnutou
  optimalizací v původní službě.

## 6. GoPay

1. Požádejte o obchodní účet v [GoPay](https://www.gopay.com/).
2. V integračním portálu nejprve použijte sandbox; získáte `GoID`, client ID a
   client secret.
3. Sandbox používá `https://gw.sandbox.gopay.com/api`, produkce
   `https://gate.gopay.cz/api`.
4. Nastavte `PAYMENT_PROVIDER=GOPAY`, `GOPAY_GO_ID`, `GOPAY_CLIENT_ID` a
   `GOPAY_CLIENT_SECRET`. Produkční údaje nevyměňujte za sandboxové.

## 7. Meta Pixel

Klientský Pixel se nastavuje v **Administrace → Metriky**, ne v `.env`; spustí
se pouze po marketingovém souhlasu návštěvníka.

1. V Meta Business Manageru otevřete **Events Manager → Connect data sources → Web**.
2. Vytvořte Pixel a jeho ID vložte do nastavení metrik ve Spottex.
3. Pro budoucí serverové Conversions API vygenerujte access token v Events
   Manageru a uložte jej jako `META_CONVERSIONS_API_TOKEN` pouze na serveru.

## 8. První admin a ostatní volby

- `ADMIN_SEED_EMAIL` a `ADMIN_SEED_PASSWORD` používá pouze `npm run db:seed`.
  Produkční heslo musí být jedinečné a po prvním přihlášení jej změňte.
- `GRIDLINK_API_URL` a `GRIDLINK_API_TOKEN` vydá správce GridLink služby;
  adaptér je připravený jako budoucí alternativa k legacy bridge.
- `PUBLIC_MEDIA_HOSTS` je čárkou oddělený allowlist HTTPS hostů pro obrázky.
- Retenční proměnné určují počet dní uchování analytiky, souhlasů, auditu,
  konzultací a e-mailového outboxu.

## 9. Kontrola před spuštěním

```bash
npm run db:generate
npm run db:deploy
npm run preflight
sudo docker compose --env-file Secrets/spottex.production.env \
  -f deploy/compose.prod.yml config
```

Produkční image při startu validuje povinné proměnné, HTTPS origin, oddělené
Google hodnoty, GoPay a tvar Fernet/AES klíčů. Po nasazení ověřte `/api/health`,
registraci a doručení ověřovacího e-mailu, Google callback, jednu sandboxovou
platbu a read-only synchronizaci testovací elektrárny. Žádný ověřovací krok
nemá obsahovat `turnon`.
