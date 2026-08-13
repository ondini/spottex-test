# Secrets Spottex

Tato složka drží neveřejnou konfiguraci **lokálního vývoje**. Skutečné soubory
`*.env` jsou ignorované Gitem; do repozitáře patří pouze tato dokumentace.

## Soubory

- `spottex.development.env` — lokální Docker Compose a vývoj.

Produkční konfigurace tady **není**. Bydlí v `.env.production` v kořeni
repozitáře a jedinou její šablonou je [`deploy/env.production.example`](../deploy/env.production.example):

```bash
cp deploy/env.production.example .env.production
chmod 600 .env.production
```

Dřívější `Secrets/spottex.production.env.example` byl zastaralá duplicitní
šablona a byl odstraněn — chyběly v něm klíče pro katalog nákladů, spotové ceny
z backendu i parser faktur, takže stack z něj naběhl, ale tyto funkce tiše
nefungovaly. Pokud na stroji ještě leží starý `Secrets/spottex.production.env`,
přeneste hodnoty do `.env.production` proti aktuální šabloně a starý soubor
smažte; jinak vám budou klíče chybět.

## Co musíte doplnit vy

Interní náhodné klíče a databázová hesla si vygenerujete sami. Řádky, které
vyžadují účet nebo token od externí služby:

1. `RESEND_API_KEY`, nebo kompletní SMTP údaje — po ověření domény odesílatele.
2. `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `GOPAY_GO_ID` — nejdřív sandbox.
   Povinné jen při `PAYMENT_PROVIDER=GOPAY`; produkce běží v režimu `FREE`.
3. Google Calendar trojici — Client ID, Client Secret a přesnou redirect URI.
4. `SPOTTEX_LEGACY_API_URL` a existující `SPOTTEX_LEGACY_FERNET_KEY` pro živá
   data SolaX. Fernet klíč musí vydat správce současné energetické služby; nový
   náhodný klíč by existující data neodemkl.
5. `COSTS_INTERNAL_API_URL` + `COSTS_INTERNAL_API_KEY` — adresa katalogu nákladů
   uvnitř WireGuard tunelu, nikdy na veřejném internetu.
6. `SPOTTEX_BACKEND_DATABASE_URL` — vyhrazená read-only role v databázi
   energetického backendu, ze které se čtou spotové ceny.
7. Volitelně `GRIDLINK_API_URL`, `GRIDLINK_API_TOKEN` a serverový Meta CAPI token.

Podrobný postup získání jednotlivých hodnot je v
[`docs/INTEGRATIONS_AND_SECRETS.md`](../docs/INTEGRATIONS_AND_SECRETS.md).
Krátký seznam toho, co musí dodat vlastník externích účtů, je v
[`EXTERNAL_TOKENS_TODO.md`](./EXTERNAL_TOKENS_TODO.md).

Předání celé sady tajemství na nový produkční stroj dělá
[`scripts/collect-deployment-bundle.sh`](../scripts/collect-deployment-bundle.sh);
postup je v `README.md`, sekce „Nasazení na nový stroj".
