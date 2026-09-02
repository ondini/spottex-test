# Repair the SolaX Cloud tokenID extractor

You are repairing a Playwright extraction script for the SolaX Cloud user
portal. The previous run of the script failed; your job is to produce a full
replacement script that works against the portal UI shown in the artifacts.

## Goal

The script logs into https://global.solaxcloud.com/user-center/ with the
credentials it receives and reads the account **tokenID** shown on the
portal's API page (the per-account key for the public SolaxCloud API). The
portal UI may have changed since the script was written — infer the current
structure from the artifacts and adjust selectors and navigation accordingly.

## Files in this directory

- `current-script.mjs` — the script that just failed.
- `error.txt` — the failure message.
- `failure.html` — DOM snapshot at the moment of failure (may be truncated).
- `failure.png` — screenshot at the moment of failure (attached as image if present).
- `console.log.txt` — browser console plus the script's own step log.

## Contract the replacement must keep

- ESM module whose **default export** is `async ({ page, credentials, portalUrl, log }) => tokenId`.
- `page` is a Playwright `Page` in a fresh context; do not create browsers or
  contexts yourself, and use only this page for navigation.
- `credentials.email` and `credentials.password` are the portal login; never
  pass them to `log`, never print them, never send them anywhere except the
  portal's own login form.
- Return the tokenID as a trimmed non-empty string (throw if it looks empty
  or shorter than 10 characters).
- Prefer explicit Playwright waits (`locator.waitFor`, `page.waitForFunction`)
  over sleeps; keep every wait bounded (max 30 s).
- No new dependencies, no imports beyond the JavaScript standard library, no
  network access other than the page itself, under 300 lines.

## Output

Return JSON matching the provided schema: the complete replacement script in
`script` and a one-sentence `notes` describing what you changed and why.
