# Automatický katalogový agent

Stejná izolovaná pipeline spravuje dodavatelské a distribuční ceníky, dotační
tituly i nabídky financování. U dotací eviduje územní, technické,
příjmové/žadatelské a časové podmínky; u úvěrů navíc RPSN, poplatky a rozsah
splatnosti. Publikované dotace a financování se používají výhradně v investiční
Pro analýze a vždy po výslovném potvrzení nároku zákazníkem.

Týdenní systemd timer spouští Codex CLI v `read-only` sandboxu a s JSON Schema výstupem. Agent nemá databázové nástroje ani právo měnit repozitář. Následný deterministický importér:

1. přijme nejvýše 20 kandidátů,
2. znovu stáhne uvedený dokument pouze z povolených oficiálních HTTPS domén,
3. ověří i cílovou doménu po přesměrování a limit 15 MB,
4. uloží neměnný soubor pod SHA-256 do neveřejného archivu,
5. vytvoří pouze `DRAFT` zdroj a katalogovou verzi,
6. zapíše auditní událost.

Agent nemá cestu k publikaci. Administrátor musí zvlášť validovat zdroj, automatické kontroly, varování a až potom verzi publikovat na `/admin/ceniky`.

## Instalace timeru

Soubory z `deploy/systemd` se instalují do `/etc/systemd/system`, prostředí podle `deploy/catalog-agent.env.example` do `/etc/spottex/catalog-agent.env` s oprávněním `0640` a strojové přihlášení Codexu do adresáře uvedeného v `CODEX_HOME`. Archiv musí vlastnit uživatel `spottex`.

Po ověření ručního běhu `npm run catalog:agent` lze timer zapnout příkazem `systemctl enable --now spottex-catalog-agent.timer`. Nasazení timeru není součástí migrace aplikace a nesmí být provedeno na hostiteli GridLinku.
