// Pure builder for the e-mail a customer receives when an analysis finishes.
// It answers the two questions the customer asked by registering the plant:
// what do I pay today, and what could I pay. Every number is the model's
// estimate over the measured window, never a guarantee, and the mail says so.

export type CompletionEmailScenario = {
  label: string;
  controlMode: "SELF_USE" | "SMART";
  annualCostCzk: number;
  currentHardware: boolean;
  currentTariff: boolean;
  distributionCode: string | null;
  // Modelled reference tariffs (the orientational standard, the reference
  // baseline) are shown in the app but are not something the customer can
  // sign, so they never count as the best option.
  referenceOnly?: boolean;
  batteryCapacityKwh: number;
  pvCapacityKwp: number;
  investment: {
    vsCurrentControl: { annualSavingsCzk: number; simplePaybackYears: number | null } | null;
    vsOptimizedControl: { annualSavingsCzk: number; simplePaybackYears: number | null } | null;
  } | null;
};

export type CompletionEmailInput = {
  kind: "BASE" | "PRO";
  siteName: string;
  userName: string | null;
  appUrl: string;
  dataFrom: Date | null;
  dataTo: Date | null;
  confidence: string | null;
  currentControlMode: "SELF_USE" | "SMART";
  scenarios: CompletionEmailScenario[];
};

// Rates that a household can only use with a qualifying appliance; the
// comparison shows them, but the customer has to confirm eligibility.
const ELIGIBILITY_GATED_RATES = new Set([
  "D25D", "D26D", "D27D", "D35D", "D45D", "D56D", "D57D",
  "C25D", "C26D", "C27D", "C35D", "C45D", "C46D", "C56D",
]);

// Intl separates thousands with a non-breaking space; e-mail clients and the
// plain-text part read better with an ordinary one.
const plain = (formatter: Intl.NumberFormat) => ({ format: (value: number) => formatter.format(value).replace(/[\u00a0\u202f]/g, " ") });
const czk = plain(new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }));
const oneDecimal = plain(new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }));
const date = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" });

export function formatCzkPerYear(value: number) {
  return `${czk.format(Math.round(value))} Kč/rok`;
}

function tariffName(label: string) {
  return label.replace(/\s*·\s*(chytré řízení|self-use)\s*$/i, "").trim();
}

function controlName(mode: "SELF_USE" | "SMART") {
  return mode === "SMART" ? "s chytrým řízením" : "bez řízení";
}

function confidenceName(value: string | null) {
  if (value === "HIGH") return "vysoká";
  if (value === "MEDIUM") return "střední";
  if (value === "LOW") return "nízká";
  return null;
}

function cheapest(list: CompletionEmailScenario[]) {
  return list.reduce<CompletionEmailScenario | null>(
    (best, item) => (best == null || item.annualCostCzk < best.annualCostCzk ? item : best),
    null,
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

type Row = { title: string; detail: string | null; cost: number | null; note: string | null; highlight?: boolean };

function baseRows(input: CompletionEmailInput) {
  const current = input.scenarios.filter((item) => item.currentHardware);
  const today = current.find((item) => item.currentTariff && item.controlMode === input.currentControlMode) ?? null;
  const currentSmart = current.find((item) => item.currentTariff && item.controlMode === "SMART") ?? null;
  // Alternatives the customer could actually sign: catalog offers, never
  // the modelled references and never their own tariff again.
  const offers = current.filter((item) => !item.referenceOnly && !item.currentTariff);
  const bestSelfUse = cheapest(offers.filter((item) => item.controlMode === "SELF_USE"));
  const bestSmart = cheapest(offers.filter((item) => item.controlMode === "SMART"));
  const gated = (item: CompletionEmailScenario | null) =>
    item?.distributionCode && ELIGIBILITY_GATED_RATES.has(item.distributionCode.toUpperCase())
      ? `sazba ${item.distributionCode} vyžaduje způsobilost (tepelné čerpadlo nebo akumulační vytápění)`
      : null;
  const saving = (item: CompletionEmailScenario | null) => {
    if (!item || !today || today === item) return null;
    const delta = Math.round(today.annualCostCzk - item.annualCostCzk);
    return delta >= 0 ? `úspora ${czk.format(delta)} Kč/rok` : `o ${czk.format(-delta)} Kč/rok dráž než dnes`;
  };
  const rows: Row[] = [];
  if (today) rows.push({ title: `Dnes: váš tarif ${controlName(input.currentControlMode)}`, detail: tariffName(today.label), cost: today.annualCostCzk, note: null, highlight: true });
  if (currentSmart && currentSmart !== today) rows.push({ title: "Váš tarif s chytrým řízením", detail: tariffName(currentSmart.label), cost: currentSmart.annualCostCzk, note: saving(currentSmart) });
  if (bestSelfUse && bestSelfUse !== today) rows.push({ title: "Nejvýhodnější tarif bez řízení", detail: tariffName(bestSelfUse.label), cost: bestSelfUse.annualCostCzk, note: [saving(bestSelfUse), gated(bestSelfUse)].filter(Boolean).join("; ") || null });
  if (bestSmart && bestSmart !== currentSmart) rows.push({ title: "Nejvýhodnější tarif s chytrým řízením", detail: tariffName(bestSmart.label), cost: bestSmart.annualCostCzk, note: [saving(bestSmart), gated(bestSmart)].filter(Boolean).join("; ") || null, highlight: true });
  // The cheapest thing the customer can actually do, including just switching
  // control on with the tariff they already have.
  const best = cheapest([currentSmart, bestSmart, bestSelfUse].filter((item): item is CompletionEmailScenario => item != null));
  return { rows, today, best, offersAvailable: offers.length > 0 };
}

function proRows(input: CompletionEmailInput) {
  const variants = new Map<string, CompletionEmailScenario[]>();
  for (const item of input.scenarios) {
    const key = `${item.pvCapacityKwp}|${item.batteryCapacityKwh}|${item.currentHardware ? "current" : "variant"}`;
    variants.set(key, [...(variants.get(key) ?? []), item]);
  }
  const rows: Row[] = [];
  for (const items of variants.values()) {
    const best = cheapest(items.filter((item) => !item.referenceOnly)) ?? cheapest(items);
    if (!best) continue;
    const payback = best.investment?.vsCurrentControl;
    const optimized = best.investment?.vsOptimizedControl;
    const parts = [
      payback ? `proti dnešku úspora ${czk.format(Math.round(payback.annualSavingsCzk))} Kč/rok` : null,
      payback?.simplePaybackYears != null ? `návratnost ${oneDecimal.format(payback.simplePaybackYears)} let` : null,
      optimized?.simplePaybackYears != null ? `proti provozu s řízením ${oneDecimal.format(optimized.simplePaybackYears)} let` : null,
    ].filter(Boolean);
    rows.push({
      title: `${oneDecimal.format(best.pvCapacityKwp)} kWp / ${oneDecimal.format(best.batteryCapacityKwh)} kWh${best.currentHardware ? " (dnešní hardware)" : ""}`,
      detail: `${tariffName(best.label)} · ${controlName(best.controlMode)}`,
      cost: best.annualCostCzk,
      note: parts.length ? parts.join(", ") : null,
      highlight: !best.currentHardware,
    });
  }
  return rows;
}

export function buildAnalysisCompletionEmail(input: CompletionEmailInput) {
  const greeting = `Dobrý den${input.userName ? ` ${input.userName}` : ""},`;
  const window =
    input.dataFrom && input.dataTo ? `${date.format(input.dataFrom)} – ${date.format(input.dataTo)}` : null;
  const confidence = confidenceName(input.confidence);
  const base = baseRows(input);
  const rows = input.kind === "PRO" ? proRows(input) : base.rows;
  const link = `${input.appUrl.replace(/\/$/, "")}/app/analyza`;
  const subject =
    input.kind === "PRO"
      ? `Rozšířená analýza ${input.siteName} je hotová`
      : base.today && base.best && base.best.annualCostCzk < base.today.annualCostCzk - 1
        ? `Analýza ${input.siteName}: dnes ${formatCzkPerYear(base.today.annualCostCzk)}, nejvýhodnější varianta ${formatCzkPerYear(base.best.annualCostCzk)}`
        : base.today
          ? `Analýza ${input.siteName}: váš tarif je nejvýhodnější (${formatCzkPerYear(base.today.annualCostCzk)})`
          : base.best
            ? `Analýza ${input.siteName}: nejvýhodnější varianta ${formatCzkPerYear(base.best.annualCostCzk)}`
            : `Analýza ${input.siteName} je hotová`;
  const intro =
    input.kind === "PRO"
      ? `rozšířená analýza elektrárny ${input.siteName} s variantami hardwaru je hotová. U každé varianty uvádíme nejlevnější tarif a návratnost investice proti dnešnímu provozu.`
      : `analýza elektrárny ${input.siteName} je hotová. Porovnali jsme váš současný tarif s dostupnými nákupními i výkupními produkty a distribučními sazbami, bez řízení i s chytrým řízením baterie.`;
  const context = [window ? `Období měření ${window}.` : null, confidence ? `Spolehlivost odhadu: ${confidence}.` : null]
    .filter(Boolean)
    .join(" ");
  const missingTariff =
    input.kind === "BASE" && !base.today
      ? "Váš současný tarif zatím neznáme, proto chybí řádek „dnes“. Doplňte ho v aplikaci nebo nám pošlete fakturu a spočítáme i rozdíl proti dnešku."
      : null;
  const noOffers =
    input.kind === "BASE" && !base.offersAvailable
      ? "Katalog zatím nenabízí tarif, který by šel pro váš odběr sjednat, proto nemáme co porovnat s vaším tarifem. Jakmile přibude, analýzu spustíme znovu."
      : null;
  const disclaimer =
    "Jde o modelovaný odhad z vaší naměřené historie a verzovaných ceníků, ne o záruku budoucího výsledku.";

  const textRows = rows
    .map((row) => `- ${row.title}: ${row.cost == null ? "—" : formatCzkPerYear(row.cost)}${row.detail ? ` — ${row.detail}` : ""}${row.note ? ` (${row.note})` : ""}`)
    .join("\n");
  const text = [
    greeting,
    "",
    intro,
    context,
    "",
    "Roční náklady na elektřinu (odhad modelu):",
    textRows || "- žádný scénář nebylo možné spočítat",
    "",
    missingTariff,
    noOffers,
    `Podrobnou tabulku všech ${input.scenarios.length} scénářů najdete v aplikaci: ${link}`,
    "",
    disclaimer,
  ]
    .filter((line) => line != null)
    .join("\n");

  const htmlRows = rows
    .map(
      (row) =>
        `<tr${row.highlight ? ' style="background:#eef2ff"' : ""}><td style="padding:8px 10px;border-top:1px solid #e2e8f0"><strong>${escapeHtml(row.title)}</strong>${row.detail ? `<br><span style="color:#475569;font-size:13px">${escapeHtml(row.detail)}</span>` : ""}${row.note ? `<br><span style="color:#475569;font-size:13px">${escapeHtml(row.note)}</span>` : ""}</td><td style="padding:8px 10px;border-top:1px solid #e2e8f0;text-align:right;white-space:nowrap">${row.cost == null ? "—" : escapeHtml(formatCzkPerYear(row.cost))}</td></tr>`,
    )
    .join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:640px">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}${context ? ` ${escapeHtml(context)}` : ""}</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th style="text-align:left;padding:6px 10px;color:#475569;font-weight:normal">Varianta</th><th style="text-align:right;padding:6px 10px;color:#475569;font-weight:normal">Roční náklady</th></tr></thead><tbody>${htmlRows || '<tr><td colspan="2" style="padding:8px 10px">Žádný scénář nebylo možné spočítat.</td></tr>'}</tbody></table>
${missingTariff ? `<p>${escapeHtml(missingTariff)}</p>` : ""}
${noOffers ? `<p>${escapeHtml(noOffers)}</p>` : ""}
<p><a href="${escapeHtml(link)}">Otevřít podrobnou tabulku všech ${input.scenarios.length} scénářů v aplikaci</a></p>
<p style="color:#475569;font-size:13px">${escapeHtml(disclaimer)}</p>
</div>`;
  return { subject, text, html };
}
