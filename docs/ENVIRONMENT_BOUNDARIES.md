# Prostředí a bezpečné hranice

## Nová platforma SpotTEX (`/home/web/spottex`)

- Dev aplikace: `spottex-platform-dev-app-1`, host port `3004`.
- Dev jobs: `spottex-platform-dev-jobs-1`.
- Dev PostgreSQL: `spottex-platform-dev-db-1`, host port `5435`.
- Dev Mailpit: `spottex-platform-dev-mailpit-1`, web port `8026`.
- Produkční compose je definován v `deploy/compose.prod.yml`, ale při auditu 21. 7. 2026 nebyl pro tuto novou platformu spuštěn.

## Legacy energetická služba SpotTEX

- API: `spottex_backend-web-1`, host port `2086`.
- PostgreSQL: `spottex_backend-db-1`, host port `5434`.
- Nová platforma používá tuto službu přes API. Její vlastní databáze na portu 5435 není replikou legacy databáze; jde o oddělenou cache a aplikační úložiště.
- Změny legacy schématu nebo běžících optimalizačních workerů vyžadují samostatný plán, zálohu a provozní okno.

## GridLink / ostatní běžící měření

Kontejnery `spottex_prod-*`, `spottex_web_prod-*` a `spottex_web_dev-*` nejsou součástí změn nové platformy v tomto repozitáři. Nesmí se proti nim spouštět migrace, restart ani zápisové diagnostické operace. Zejména se nesmí zaměnit jejich PostgreSQL na portu `15433` s dev databází nové platformy na portu `5435`.

## Pravidlo migrací

1. Ověřit přesný `DATABASE_URL` bez vypsání hesla.
2. Povolit pouze databázi nové platformy SpotTEX.
3. Vytvořit zálohu a dry-run SQL.
4. Spustit migraci přes `prisma migrate deploy` pouze v cílovém prostředí.
5. Ověřit počty řádků, integritu a aplikační health check.
6. GridLink a legacy energetickou databázi nemigrovat z tohoto repozitáře.
