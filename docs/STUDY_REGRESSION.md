# Roční regrese proti Studii

Referenční roční dataset AQUA SPP zůstává pouze v `/home/michal/Studie`; zákaznická časová řada se nekopíruje do repozitáře SpotTEX. Příkaz `npm run study:validate-annual` ji přes read-only adaptér načte, po 15 minutách přehraje produkční `simulateSelfUse` a porovná fyzické toky s výstupem `data_derived/sim_sweep.csv` ze Studie.

Kontrolují se varianty 0, 100, 300, 500, 1 000, 2 000 a 4 000 kWh. Tolerance je 0,15 % pro roční spotřebu, výrobu, import a export a 0,75 % pro počet cyklů. Dne 21. 7. 2026 prošlo všech 33 692 intervalů; nejvyšší zjištěná odchylka fyzické energie byla pod 0,000001 % a cyklů pod 0,003 %.

Syntetické MILP zlaté případy zůstávají v běžné Vitest sadě. Jejich zdrojem je nezávislý OR-Tools/CBC plánovač Studie (`analysis_tools.py`, SHA-256 `08c4bd0985a206b2e10eaa0731b7ffcae55e23f129daa11845a8270ab5b95361`), zatímco aplikace používá GLPK.

Samostatný příkaz `npm run study:validate-smart-annual` přehraje produkční rolling řízení nad stejnou roční řadou. Před výpočtem vynechá 28denní warm-up prediktoru, každých 15 minut znovu plánuje 34hodinový hodinově agregovaný horizont a ověřuje bilanci energie, bilanci SoC, nedodanou energii, fallbacky, čas běhu i řádové odchylky proti historickému CBC výsledku Studie. Dne 21. 7. 2026 prošlo 33 692 vstupních a 31 004 hodnocených intervalů za 42,5 s, bez fallbacku a nedodané energie; chyba bilance byla pod `0,0000001 kWh`. Odchylka proti staršímu řadiči byla 8,60 % pro import, 10,86 % pro export, 34,19 % pro cykly a 9,02 % pro náklady. Vyšší rozdíl cyklů je očekávaný kvůli odlišným SoC bezpečnostním mezím a zůstává pod 60% bezpečnostním limitem.

Po této křížové, fyzikální a kapacitní validaci je produkční příznak zapnutý. Uživatelské rozhraní přesto výsledek správně označuje jako modelovaný odhad, nikoli záruku budoucí úspory.

Pokud je Studie jinde, nastaví se `STUDY_ANALYSIS_ROOT` a případně `STUDY_PYTHON`. Adaptér nic nezapisuje do Studie ani do databáze.
