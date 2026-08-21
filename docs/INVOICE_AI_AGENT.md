# AI parser vstupních faktur

Automatické zpracování je rozdělené do dvou kontejnerů. `invoice-coordinator`
má přístup pouze k aplikační databázi a `APP_ENCRYPTION_KEY`; nemá Codex
autentizaci. `invoice-parser` má Codex CLI a jeho read-only autentizaci, ale
nemá databázové připojení, šifrovací klíč, repozitář ani Docker socket. Oba
procesy sdílejí pouze síťový namespace a komunikují přes loopback, který není
publikovaný na hostitele ani do Docker sítě.

Koordinátor atomicky převezme nejstarší přijatý dokument, dešifruje jej v
paměti a předá jediný dokument parseru. Parser jej uloží jen do privátního
`tmpfs`, PDF lokálně převede na text a Codex CLI spustí přes `spawn` se
`shell:false`, v ephemeral/read-only sandboxu. JPG/PNG se předá jako obraz.
Kontejner běží jako neprivilegovaný uživatel, s read-only root filesystémem,
bez Linux capabilities a s `no-new-privileges`. Po zpracování je dočasný
adresář vždy smazán a plaintext buffer koordinátoru přepsán nulami.

Codex CLI je agentní program, proto nelze současně požadovat jeho spuštění a
technicky tvrdit, že v kontejneru vůbec neexistuje možnost spustit proces.
Bezpečnost je řešená izolací dat a oprávnění: případný nástroj spuštěný Codexem
vidí jen jednu fakturu, read-only systém a žádná aplikační tajemství. Pro
produkci je navíc vhodné omezit odchozí provoz parseru firewallem/proxy pouze na
schválené OpenAI endpointy.

Strukturovaný výstup prochází deterministickou validací a uloží se jako nová
verze `AI_CODEX_DRAFT`. Nikdy sám nemění technický profil, cenu ani analýzu.
V zákaznické části `Moje elektrárna` se zobrazí průběh každého souboru a po
dokončení kontrolní dialog s hodnotami, jistotou, důkazy a varováními. Teprve
tlačítko „Uložit do odběrného místa“ propíše potvrzené hodnoty. Stejný návrh
zůstává dostupný administrátorovi v `/admin/vstupni-faktury`.

Jeden požadavek může obsahovat nejvýše tři dokumenty. Koordinátor je zpracuje
postupně i poté, co první dokument přejde do stavu `NEEDS_INPUT`. Neprázdná
pole se sloučí; novější faktura má přednost a odlišné hodnoty jsou označené
jako konflikt k ručnímu rozhodnutí.

Aktuální schéma `energy-invoice-ai-v2` dovoluje pouze doloženou normalizaci
ceny silové elektřiny: Kč/MWh se dělí 1000 a cena bez DPH se násobí sazbou DPH
výslovně uvedenou na dokumentu. Zdrojová cena, sazba a výpočet musí být v
důkazu. Regulované složky se do ceny silové elektřiny nikdy nepřičítají.

Compose worker je zapnutý pomocí `ENERGY_INVOICE_AI_ENABLED=true`. Adresář
`CODEX_AUTH_FILE` připojí do parseru pouze strojový `auth.json` a read-only;
celý uživatelský adresář `.codex` se záměrně nepřipojuje. Koordinátor čeká na
nové faktury a zpracovává je postupně; zatuhlý claim lze bezpečně převzít po
dvou hodinách. Při jakékoli chybě se dokument označí k ruční kontrole a do
logu/auditu se nikdy nezapisuje jeho obsah. Starší systemd timer zůstává jen
jako ruční nouzová varianta a nesmí běžet současně s Compose koordinátorem.
