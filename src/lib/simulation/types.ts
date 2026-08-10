export type SimulationTariffCode = "C03d" | "C25d" | "C26d";

export type SimulationInput = {
  siteId: number;
  currentBatteryKwh: number;
  currentPvKwp: number;
  batteryPriceCzkPerKwh: number;
  pvPriceCzkPerKwp: number;
  exportPriceCzkPerKwh: number;
};

export type SimulationPoint = {
  at: Date;
  productionKwh: number;
  consumptionKwh: number;
  intervalHours: number;
};

export type SimulationScenario = {
  tariff: SimulationTariffCode;
  pvKwp: number;
  batteryKwh: number;
  selfUseAnnualCostCzk: number;
  smartAnnualCostCzk: number;
  annualSavingsCzk: number;
  controlSavingsCzk: number;
  investmentCzk: number;
  paybackYears: number | null;
};

export type SimulationResult = {
  engineVersion: "SPOTTEX_FORECAST_V1";
  generatedAt: string;
  data: {
    from: string;
    to: string;
    intervals: number;
    coverageDays: number;
    annualizationFactor: number;
    confidence: "LOW" | "MEDIUM" | "HIGH";
  };
  current: { batteryKwh: number; pvKwp: number; baselineAnnualCostCzk: number };
  batteryOptionsKwh: number[];
  pvOptionsKwp: number[];
  tariffs: Array<{
    code: SimulationTariffCode;
    label: string;
    note: string;
  }>;
  scenarios: SimulationScenario[];
  bestScenario: SimulationScenario;
  assumptions: string[];
};

export type SimulationJobView = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  createdAt: string;
  completedAt: string | null;
  stage: string;
  error: string | null;
  input: SimulationInput;
  result: SimulationResult | null;
};

