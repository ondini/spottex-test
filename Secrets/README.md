# Secrets Spottex

Tato složka je jediné provozní místo pro neveřejnou konfiguraci Spottexu.
Skutečné soubory `*.env` jsou ignorované Gitem. Do repozitáře patří pouze tato
dokumentace a bezpečné šablony `*.example`.

## Soubory

- `spottex.development.env` — lokální Docker Compose a vývoj.
- `spottex.production.env` — produkční build, migrace, web, job runner a backup.
- `spottex.production.env.example` — veřejná šablona bez tajných hodnot.

Interní náhodné klíče a databázová hesla jsou v reálných env souborech už
vygenerované. Řádky označené `DOPLNIT UŽIVATELEM` vyžadují účet nebo token od
externí služby a Codex je nemůže bezpečně vymyslet.

## Práva a produkční spuštění

Po doplnění externích hodnot převeďte soubor na uživatele `root` a zakažte
čtení ostatním uživatelům:

```bash
sudo chown root:root Secrets/spottex.production.env
sudo chmod 600 Secrets/spottex.production.env
```

Konfiguraci i build pak spouštějte přes `sudo`, aby Docker Compose mohl soubor
načíst:

```bash
sudo docker compose --env-file Secrets/spottex.production.env \
  -f deploy/compose.prod.yml config --quiet

sudo docker compose --env-file Secrets/spottex.production.env \
  -f deploy/compose.prod.yml up -d --build
```

Secrets nejsou kopírovány do image. Compose je použije pro interpolaci a každému
kontejneru předá pouze proměnné, které skutečně potřebuje.

## Co musíte doplnit vy

1. `RESEND_API_KEY`, nebo kompletní SMTP údaje — po ověření domény odesílatele.
2. `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `GOPAY_GO_ID` — nejdřív sandbox.
3. Google Calendar trojici — Client ID, Client Secret a přesnou redirect URI.
4. `SPOTTEX_LEGACY_API_URL` a existující `SPOTTEX_LEGACY_FERNET_KEY` pro živá
   data SolaX. Fernet klíč musí vydat správce současné energetické služby; nový
   náhodný klíč by existující data neodemkl.
5. Volitelně `GRIDLINK_API_URL`, `GRIDLINK_API_TOKEN` a serverový Meta CAPI token.

Podrobný postup získání jednotlivých hodnot je v
[`docs/INTEGRATIONS_AND_SECRETS.md`](../docs/INTEGRATIONS_AND_SECRETS.md).
Krátký seznam toho, co musí dodat vlastník externích účtů, je v
[`EXTERNAL_TOKENS_TODO.md`](./EXTERNAL_TOKENS_TODO.md).
