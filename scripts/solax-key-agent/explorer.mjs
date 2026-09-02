import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Walks the authenticated portal like a person hunting for the API key: read
// the current page, enumerate the things worth clicking, click each, look
// again — following new tabs, because SolaX now opens its developer view in
// one. It does not decide where the key is; it gathers evidence (rendered
// token-shaped strings with their labels, page text outlines, screenshots) for
// the reasoning step. The app decrypts and renders the tokenID in the DOM once
// you reach the right page, so a crawl that visits that page sees it even
// though the raw API response is encrypted.

// Runs in the page: leaf elements whose text looks like a token, with nearby
// label context so the reasoner can tell an API key from a serial number.
// Written as an IIFE string: page.evaluate(string) evaluates an expression, so
// a bare arrow function would be returned rather than called.
const FIND_TOKENS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    if (el.children.length) continue;
    const text = (el.textContent || "").trim();
    if (text.length < 16 || text.length > 64) continue;
    if (!/^[A-Za-z0-9]+$/.test(text) || /^[0-9]+$/.test(text)) continue;
    const prev = el.previousElementSibling;
    let context = prev ? (prev.textContent || "").trim() + " | " : "";
    context += (el.parentElement ? el.parentElement.textContent || "" : "").trim();
    out.push({ value: text, context: context.slice(0, 200) });
    if (out.length >= 40) break;
  }
  return out;
})()`;

// Runs in the page: clickable things with visible labels, favouring anything
// that smells like API/token/developer navigation.
const FIND_NAV = `(() => {
  const items = [];
  const sel = "a[href], [class*=menu-item], [class*=logo-api], .data-screen-btn, button, [role=menuitem]";
  for (const el of document.querySelectorAll(sel)) {
    const text = ((el.innerText || el.textContent || "").trim()).slice(0, 40);
    const cls = (el.className && el.className.toString) ? el.className.toString() : "";
    if (!text && !cls) continue;
    items.push({ text, cls: cls.slice(0, 80) });
    if (items.length >= 60) break;
  }
  return items;
})()`;

function looksLikeKeyContext(context) {
  return /token|api\b|apikey|api key|klíč|key/i.test(context || "");
}

async function snapshot(page, artifactsDir, index, via) {
  const shotPath = path.join(artifactsDir, `page-${index}.png`);
  let tokens = [];
  let nav = [];
  let innerText = "";
  try {
    tokens = await page.evaluate(FIND_TOKENS);
  } catch {
    /* page may have navigated */
  }
  try {
    nav = await page.evaluate(FIND_NAV);
  } catch {
    /* ignore */
  }
  try {
    innerText = (await page.evaluate("document.body ? document.body.innerText : ''")).slice(0, 4000);
  } catch {
    /* ignore */
  }
  try {
    await page.screenshot({ path: shotPath, fullPage: false });
  } catch {
    /* ignore */
  }
  return {
    index,
    via,
    url: page.url(),
    title: await page.title().catch(() => ""),
    tokenCandidates: tokens,
    nav,
    innerText,
    screenshotPath: shotPath,
  };
}

export async function exploreForToken({ page, context, artifactsDir, log, maxSteps = 14 }) {
  await mkdir(artifactsDir, { recursive: true });
  const observations = [];
  const visitedUrls = new Set();
  let stepIndex = 0;

  const record = async (target, via) => {
    const obs = await snapshot(target, artifactsDir, stepIndex, via);
    stepIndex += 1;
    observations.push(obs);
    visitedUrls.add(obs.url);
    return obs;
  };

  log("exploring: landing page");
  const first = await record(page, "landing");

  // A click may open a new tab (SolaX opens its developer view that way).
  const clickAndCapture = async (label) => {
    if (stepIndex >= maxSteps) return;
    const locator = page.getByText(label, { exact: false }).first();
    if (!(await locator.count().catch(() => 0))) return;
    let popup = null;
    try {
      [popup] = await Promise.all([
        context.waitForEvent("page", { timeout: 4_000 }).catch(() => null),
        locator.click({ timeout: 4_000 }),
      ]);
    } catch {
      return;
    }
    const target = popup ?? page;
    try {
      await target.waitForLoadState("domcontentloaded", { timeout: 8_000 });
    } catch {
      /* single-page apps may not fire load; snapshot anyway */
    }
    if (!visitedUrls.has(target.url()) || popup) {
      await record(target, `click:${label.slice(0, 30)}`);
    }
    if (popup) {
      await popup.close().catch(() => {});
    } else {
      // Return the SPA to a known state for the next click.
      await page.goBack({ timeout: 5_000 }).catch(() => {});
    }
  };

  // Prioritise obviously relevant labels, then whatever else the nav offers.
  const seen = new Set();
  const labels = [];
  for (const item of first.nav ?? []) {
    const text = (item.text || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const priority = /api|token|developer|key|klíč|ecosystem/i.test(text + " " + item.cls);
    labels.push({ text, priority });
  }
  labels.sort((a, b) => Number(b.priority) - Number(a.priority));

  for (const { text } of labels) {
    if (stepIndex >= maxSteps) break;
    await clickAndCapture(text);
  }

  const tokenCandidates = observations.flatMap((obs) =>
    (obs.tokenCandidates ?? []).map((candidate) => ({
      ...candidate,
      pageIndex: obs.index,
      pageUrl: obs.url,
      pageTitle: obs.title,
      labelled: looksLikeKeyContext(candidate.context),
    })),
  );

  const bundlePath = path.join(artifactsDir, "observations.json");
  await writeFile(
    bundlePath,
    JSON.stringify(
      {
        pages: observations.map(({ screenshotPath, ...rest }) => ({
          ...rest,
          screenshot: path.basename(screenshotPath),
        })),
        tokenCandidates,
      },
      null,
      2,
    ),
  );
  log(`explored ${observations.length} pages, ${tokenCandidates.length} token candidates`);
  return { observations, tokenCandidates, bundlePath };
}
