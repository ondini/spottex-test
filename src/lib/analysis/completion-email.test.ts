import { describe, expect, it } from "vitest";

import { buildAnalysisCompletionEmail, type CompletionEmailScenario } from "./completion-email";

function scenario(overrides: Partial<CompletionEmailScenario>): CompletionEmailScenario {
  return {
    label: "Enerspot · Základní dodávka SPOT – nákup · D25D · D25d · chytré řízení",
    controlMode: "SMART",
    annualCostCzk: 5000,
    currentHardware: true,
    currentTariff: false,
    distributionCode: "D25d",
    batteryCapacityKwh: 53,
    pvCapacityKwp: 6.3,
    investment: null,
    ...overrides,
  };
}

const base = {
  siteName: "FVE Saffronela",
  userName: "Jana",
  appUrl: "https://spottex.cz/",
  dataFrom: new Date("2025-09-30T22:00:00Z"),
  dataTo: new Date("2026-09-06T20:00:00Z"),
  confidence: "HIGH",
  currentControlMode: "SELF_USE" as const,
};

describe("analysis completion e-mail", () => {
  it("tells the customer what they pay today and what the best option costs", () => {
    const mail = buildAnalysisCompletionEmail({
      ...base,
      kind: "BASE",
      scenarios: [
        scenario({ label: "Váš současný produkt · EnerSpot · Základní výkup · D25d · self-use", controlMode: "SELF_USE", currentTariff: true, annualCostCzk: 11474 }),
        scenario({ label: "Váš současný produkt · EnerSpot · Základní výkup · D25d · chytré řízení", currentTariff: true, annualCostCzk: 5591 }),
        scenario({ label: "Enerspot · SPOT – nákup · D26D · D26d · chytré řízení", distributionCode: "D26d", annualCostCzk: 4243 }),
        scenario({ label: "Enerspot · SPOT – nákup · D25D · D25d · self-use", controlMode: "SELF_USE", annualCostCzk: 11244 }),
      ],
    });
    expect(mail.subject).toBe("Analýza FVE Saffronela: dnes 11 474 Kč/rok, nejvýhodnější varianta 4 243 Kč/rok");
    expect(mail.text).toContain("Dobrý den Jana,");
    expect(mail.text).toContain("- Dnes: váš tarif bez řízení: 11 474 Kč/rok — Váš současný produkt · EnerSpot · Základní výkup · D25d");
    expect(mail.text).toContain("- Váš tarif s chytrým řízením: 5 591 Kč/rok — Váš současný produkt · EnerSpot · Základní výkup · D25d (úspora 5 883 Kč/rok)");
    expect(mail.text).toContain("- Nejvýhodnější tarif s chytrým řízením: 4 243 Kč/rok — Enerspot · SPOT – nákup · D26D · D26d (úspora 7 231 Kč/rok; sazba D26d vyžaduje způsobilost");
    expect(mail.text).toContain("https://spottex.cz/app/analyza");
    expect(mail.text).toContain("ne o záruku");
    expect(mail.html).toContain("<table");
    expect(mail.html).toContain("4 243 Kč/rok");
    expect(mail.html).not.toContain("<script");
  });

  it("says when the current tariff is unknown instead of inventing a baseline", () => {
    const mail = buildAnalysisCompletionEmail({
      ...base,
      kind: "BASE",
      scenarios: [scenario({ label: "Orientační český tarif 2026 · D02d · 3×25 A · chytré řízení", distributionCode: "D02d", annualCostCzk: 28210 })],
    });
    expect(mail.subject).toBe("Analýza FVE Saffronela: nejvýhodnější varianta 28 210 Kč/rok");
    expect(mail.text).toContain("Váš současný tarif zatím neznáme");
    expect(mail.text).not.toContain("Dnes:");
  });

  it("never presents a modelled reference tariff as the best option", () => {
    const mail = buildAnalysisCompletionEmail({
      ...base,
      siteName: "MS Vetrnik",
      kind: "BASE",
      scenarios: [
        scenario({ label: "Váš současný produkt · TEDOM · C02d · self-use", controlMode: "SELF_USE", currentTariff: true, distributionCode: "C02d", annualCostCzk: 36227 }),
        scenario({ label: "Váš současný produkt · TEDOM · C02d · chytré řízení", currentTariff: true, distributionCode: "C02d", annualCostCzk: 36227 }),
        scenario({ label: "Orientační český tarif 2026 · D02d · 3×25 A · chytré řízení", distributionCode: "D02d", referenceOnly: true, annualCostCzk: 28206 }),
      ],
    });
    expect(mail.subject).toBe("Analýza MS Vetrnik: váš tarif je nejvýhodnější (36 227 Kč/rok)");
    expect(mail.text).toContain("- Dnes: váš tarif bez řízení: 36 227 Kč/rok");
    expect(mail.text).not.toContain("Nejvýhodnější tarif");
    expect(mail.text).toContain("Katalog zatím nenabízí tarif");
  });

  it("summarizes each hardware variant with its payback against today's plant", () => {
    const mail = buildAnalysisCompletionEmail({
      ...base,
      kind: "PRO",
      scenarios: [
        scenario({ currentTariff: true, controlMode: "SELF_USE", annualCostCzk: 11474 }),
        scenario({ currentTariff: true, annualCostCzk: 5591 }),
        scenario({
          label: "Enerspot · SPOT – nákup · D27D · D27d · chytré řízení",
          distributionCode: "D27d",
          currentHardware: false,
          pvCapacityKwp: 12,
          annualCostCzk: -13117,
          investment: { vsCurrentControl: { annualSavingsCzk: 24591, simplePaybackYears: 14.2 }, vsOptimizedControl: { annualSavingsCzk: 18708, simplePaybackYears: 18.7 } },
        }),
      ],
    });
    expect(mail.subject).toBe("Rozšířená analýza FVE Saffronela je hotová");
    expect(mail.text).toContain("- 6,3 kWp / 53 kWh (dnešní hardware): 5 591 Kč/rok");
    expect(mail.text).toContain("- 12 kWp / 53 kWh: -13 117 Kč/rok — Enerspot · SPOT – nákup · D27D · D27d · s chytrým řízením (proti dnešku úspora 24 591 Kč/rok, návratnost 14,2 let, proti provozu s řízením 18,7 let)");
  });
});
