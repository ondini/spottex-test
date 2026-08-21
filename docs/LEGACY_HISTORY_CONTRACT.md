# Legacy `history-v1` contract

SpotTEX nikdy nečte databázi legacy/GridLink projektu přímo. Historický import používá šifrovaný endpoint stejného API, které dnes obsluhuje mobilní administraci. Výchozí cesta je `/history_intervals`; `SPOTTEX_LEGACY_HISTORY_PATH` ji přepisuje jen tehdy, když reverse proxy používá jiný prefix.

## Požadavek

Autentizovaný `GET` používá stávající JWT/Fernet kontrakt a parametry:

- `device_id`: externí ID střídače,
- `from`: ISO-8601 UTC včetně,
- `to`: ISO-8601 UTC bez koncového bodu.

Jeden požadavek má v platformě nejvýše 20 dní (1 920 čtvrthodin) a backend přijímá nejvýše 31 dní. Endpoint musí ověřit, že přihlášený uživatel vlastní zařízení.

## Odpověď po dešifrování

```json
{
  "intervals": [
    {
      "startAt": "2026-01-01T00:00:00.000Z",
      "endAt": "2026-01-01T00:15:00.000Z",
      "productionKwh": 0.12,
      "consumptionKwh": 0.08
    }
  ]
}
```

Všechny intervaly musí mít přesně 15 minut, ležet uvnitř požadovaného okna a obsahovat nezáporné konečné hodnoty v kWh. Časy se posílají v UTC; lokální čas elektrárny se používá až pro tarif a HDO.

## Provozní vlastnosti

- Stejný dotaz musí být idempotentní.
- Chybějící měření se nevyplňuje nulou; interval se vynechá.
- HTTP `401` používá stávající obnovu tokenu.
- `429` a `5xx` vedou ve SpotTEXu k exponenciálnímu retry konkrétního bloku, maximálně čtyřikrát.
- Endpoint nesmí spouštět řízení ani měnit zařízení.
