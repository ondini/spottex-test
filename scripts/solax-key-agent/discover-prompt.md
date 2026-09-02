# Discover how to read the SolaX Cloud API tokenID and write a locator script

The previous locator that read the account **tokenID** from the SolaX Cloud
portal stopped working — SolaX changed the UI and the token is no longer where
the old script looked. An exploration agent has already logged in and crawled
the portal for you. Your job: from that evidence, work out where the tokenID is
now shown and write a durable locator script that navigates there and reads it.

## The tokenID

It is the per-account key for the SolaX public/"third-party" API — an
alphanumeric string, roughly 16–64 characters, shown in the portal's API or
developer section. It is NOT a plant name, serial number, or a purely numeric
value. The portal fetches it over an encrypted API and renders it into the page
DOM, so it is readable from a page once you navigate to the right one.

## Evidence in this directory

- `observations.json` — the crawl result:
  - `pages[]`: each visited page with `url`, `title`, `innerText` (truncated),
    `nav` (clickable labels found there), `tokenCandidates` (token-shaped
    strings with nearby label `context`), and a `screenshot` filename.
  - `tokenCandidates[]`: all candidates across pages, each with `pageIndex`,
    `pageUrl`, `pageTitle`, `context`, and `labelled` (true when the surrounding
    text mentions token/API/key).
- `<screenshot>.png` files referenced by the pages (one is attached as an image).
- `failed-locator.mjs` — the locator that just failed, for reference.

Prefer a candidate whose `labelled` is true and whose `context` mentions
tokenID/API. If several look plausible, pick the one on the page whose title or
URL is about the API/developer section.

## The script you must write

An ESM module whose **default export** is:

```js
export default async function locate({ page, context, log }) { /* ... */ return tokenId }
```

- `page` is ALREADY logged in — do NOT log in and do NOT go to the login URL.
- Reproduce the navigation the evidence shows leads to the token: e.g. click a
  header/menu item by its visible text, and if it opens a new tab, wait for it
  on `context` (`context.waitForEvent("page")`) and read from that page.
- Read the tokenID from the DOM with a resilient locator (prefer text/label
  anchors over generated class names). Return it trimmed; throw if it is empty
  or shorter than 10 characters.
- Bounded waits only (max 30 s), no sleeps, no new dependencies, no network
  calls of your own, never log credentials, under 300 lines.

## Output

Return JSON matching the schema: the complete locator script in `script`, and a
one-sentence `notes` naming the page and element you targeted and why.
