import "server-only";

import { prisma } from "@/lib/prisma";

import { csvRow } from "./csv";

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function exportProAnalysisCsv(userId: number, runId: string) {
  const run = await prisma.energyAnalysisRun.findFirst({
    where: { id: runId, userId, kind: "PRO", status: "COMPLETED" },
    include: {
      scenarios: {
        orderBy: { scenarioKey: "asc" },
        include: {
          priceCurve: {
            include: {
              buyProductVersion: {
                include: { product: { include: { supplier: true } } },
              },
              distributionVersion: { include: { distributionTariff: true } },
            },
          },
        },
      },
    },
  });
  if (!run) throw new Error("PRO_ANALYSIS_EXPORT_NOT_FOUND");
  const rows = [
    csvRow(["SpotTEX rozšířená analýza", run.id]),
    csvRow(["Verze enginu", run.engineVersion]),
    csvRow(["Metodika", run.methodologyVersion]),
    csvRow(["Období od", run.dataFrom]),
    csvRow(["Období do", run.dataTo]),
    csvRow(["Vstupní fingerprint", run.inputFingerprint]),
    csvRow([
      "Všechny publikované ceníky",
      object(run.inputs).compareAllTariffs === true ? "ano" : "ne",
    ]),
    "",
    csvRow([
      "Scénář",
      "Režim",
      "Dodavatel a produkt",
      "Distribuční sazba",
      "Baterie kWh",
      "Nabíjení kW",
      "Vybíjení kW",
      "FVE kWp",
      "Jistič A",
      "Limit odběru kW",
      "Limit přetoku kW",
      "Roční náklad Kč",
      "Nákup Kč",
      "Výkup Kč",
      "Stálé platby Kč",
      "Úspora proti dnešku Kč",
      "Úspora řízením Kč",
      "Investice Kč",
      "Dotace Kč",
      "Efektivní investice Kč",
      "Měsíční splátka Kč",
      "Návratnost roky",
      "Import kWh",
      "Export kWh",
      "Cykly",
      "Stav",
    ]),
    ...run.scenarios.map((scenario) => {
      const investment = object(
        object(scenario.assumptions).investmentAssessment,
      );
      return csvRow([
        scenario.label,
        scenario.controlMode,
        scenario.priceCurve.buyProductVersion
          ? `${scenario.priceCurve.buyProductVersion.product.supplier.name} · ${scenario.priceCurve.buyProductVersion.product.name}`
          : scenario.priceCurve.purpose,
        scenario.priceCurve.distributionVersion?.distributionTariff.code,
        scenario.batteryCapacityKwh,
        scenario.batteryMaxChargeKw,
        scenario.batteryMaxDischargeKw,
        scenario.pvCapacityKwp,
        scenario.mainFuseA,
        scenario.maxGridInputKw,
        scenario.maxGridOutputKw,
        scenario.annualCostCzk,
        scenario.annualImportCostCzk,
        scenario.annualExportRevenueCzk,
        scenario.annualFixedCostCzk,
        scenario.savingsVsBaselineCzk,
        scenario.savingsControlCzk,
        investment.capexCzk,
        investment.grantCzk,
        investment.effectiveInvestmentCzk,
        investment.monthlyPaymentCzk,
        investment.simplePaybackYears,
        scenario.importedKwh,
        scenario.exportedKwh,
        scenario.batteryCycles,
        scenario.status,
      ]);
    }),
  ];
  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "PRO_ANALYSIS_EXPORTED",
      entityType: "EnergyAnalysisRun",
      entityId: run.id,
      metadata: { format: "CSV", scenarioCount: run.scenarios.length },
    },
  });
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
