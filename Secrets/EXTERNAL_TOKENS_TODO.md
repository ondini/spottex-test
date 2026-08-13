# Externí tokeny — co dodat před produkcí

Tento soubor neobsahuje žádné tajné hodnoty. Skutečné tokeny patří do
`.env.production`, který je ignorovaný Gitem.

## Teď nutné: odesílání e-mailů

Doporučená varianta je Resend. Je potřeba dodat právě jednu hodnotu:

```dotenv
RESEND_API_KEY=SEM_VLOZTE_RESEND_API_KEY
```

`EMAIL_FROM=Spottex <noreply@spottex.cz>` už je připravené. SMTP proměnné při
použití Resendu ponechte prázdné.

Postup:

1. Přihlaste se na https://resend.com/ a vytvořte tým/projekt Spottex.
2. V **Domains** přidejte `spottex.cz` nebo doporučenou odesílací subdoménu,
   například `mail.spottex.cz`.
3. Do DNS vložte přesně SPF/DKIM záznamy, které Resend ukáže, a počkejte na stav
   **Verified**.
4. V **API Keys** vytvořte klíč s oprávněním pouze pro odesílání; pokud Resend
   nabízí omezení na doménu, omezte jej na ověřenou doménu Spottexu.
5. Klíč se zobrazí pouze při vytvoření. Vložte jej do
   `.env.production` jako `RESEND_API_KEY`.
6. Pokud ověříte subdoménu `mail.spottex.cz`, změňte také `EMAIL_FROM`, aby
   odesílatel používal tutéž ověřenou subdoménu.

Lokálně není Resend potřeba. `DEV_AUTO_VERIFY_EMAIL=false` a Mailpit na
http://127.0.0.1:8026 umožňují otestovat registraci, obnovu hesla i rezervace.

## Teď nutné pro kalendář konzultací

Je potřeba dodat všechny tři hodnoty současně:

```dotenv
GOOGLE_CALENDAR_CLIENT_ID=SEM_VLOZTE_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET=SEM_VLOZTE_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI=https://spottex.cz/api/admin/google-calendar/callback
```

Postup:

1. V https://console.cloud.google.com/ vytvořte projekt **Spottex Production**.
2. Zapněte **Google Calendar API**.
3. V **Google Auth Platform** nastavte branding, support e-mail a publikum.
4. Pro první test ponechte stav **Testing** a mezi test users přidejte Google
   účet, jehož kalendář bude spravovat konzultace.
5. Vytvořte **OAuth client ID → Web application**.
6. Mezi **Authorized redirect URIs** vložte přesně produkční callback výše.
7. Client ID a Client Secret vložte do odpovídajících řádků produkčního env.
8. Po restartu otevřete **Administrace → Konzultace → Připojit Google**.

Pro lokální OAuth je vhodný samostatný klient s callbackem
`http://localhost:3004/api/admin/google-calendar/callback`. Google autorizace v
režimu Testing testovacím uživatelům standardně po sedmi dnech vyprší, takže pro
stabilní produkci je potřeba aplikaci následně publikovat.

## Živá data SolaX

Nejde o hodnoty z Resendu ani SolaX portálu. URL míří na původní backend
Spottexu a Fernet klíč šifruje přenos přihlašovacích údajů mezi novou aplikací
a tímto backendem.

```dotenv
SPOTTEX_LEGACY_API_URL=https://INTERNI-ENERGETICKA-SLUZBA
SPOTTEX_LEGACY_FERNET_KEY=EXISTUJICI_KLIC_STAVAJICI_SLUZBY
```

Na současném vývojovém serveru běží původní backend v kontejneru
`spottex_backend-web-1` na portu `2086`. Lokální hodnoty lze bezpečně převzít
bez vypsání klíče příkazem:

```bash
node scripts/import-legacy-secret.mjs
```

Příkaz nastaví hostitelský `.env`, `Secrets/spottex.development.env` a převezme
klíč také do `.env.production`. Produkční URL úmyslně nenastavuje:
nejprve musí existovat interní HTTPS reverse proxy před původním portem `2086`.
Přímé veřejné zpřístupnění tohoto HTTP portu není bezpečné.

Přihlašovací údaje jednotlivého zákazníka do SolaX Cloud nejsou globální secret.
Zákazník je zadává až ve svém účtu přes **Připojit SolaX Cloud**. Web je předá
bridge službě a dlouhodobě ukládá jen zašifrované přístupové tokeny.

## Až před zapnutím plateb

GoPay po registraci obchodníka a schválení integrace vydá:

```dotenv
PAYMENT_PROVIDER=GOPAY
GOPAY_CLIENT_ID=SEM_VLOZTE_CLIENT_ID
GOPAY_CLIENT_SECRET=SEM_VLOZTE_CLIENT_SECRET
GOPAY_GO_ID=SEM_VLOZTE_GOID
```

Nejdřív použijte sandboxové údaje a `https://gw.sandbox.gopay.com/api`.
Produkční údaje se vydávají samostatně až po schválení integrace.

## Volitelné

- `META_CONVERSIONS_API_TOKEN` — až při serverovém Meta Conversions API.
- `GRIDLINK_API_TOKEN` — vydá správce GridLink služby, pokud se tento adaptér
  začne používat.

## Kam hodnoty vložit a jak nasadit

Upravte pouze:

```text
/home/web/spottex/.env.production
```

Poté:

```bash
chmod 600 /home/web/spottex/.env.production
docker compose --env-file /home/web/spottex/.env.production \
  -f /home/web/spottex/deploy/compose.prod.yml config --quiet
docker compose --env-file /home/web/spottex/.env.production \
  -f /home/web/spottex/deploy/compose.prod.yml up -d --build
```

Tokeny neposílejte do chatu, commitu ani do `.env.example`.
