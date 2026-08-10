export type ControlAuditReplayPoint = {
  timestamp: string;
  productionActualKwh: number;
  productionForecastLiveKwh: number;
  productionForecastDeviceKwh: number;
  consumptionActualKwh: number;
  consumptionForecastKwh: number;
  daylight: boolean;
};

export type ControlAuditReplay = {
  title: string;
  description: string;
  origin: string;
  horizonHours: number;
  deviceId: string;
  modelFiles: {
    production: string;
    consumption: string;
  };
  inputs: {
    coordinates: [number, number];
    historyHours: number;
    sitePvPowerKwpPassedByLiveCode: number;
    devicePvArrayKwp: number;
    deviceMaxAcKw: number;
    physicalDeviceScaleKwp: number;
    productionHistoryTotalKwh: number;
    productionHistoryMaxKwh: number;
    consumptionHistoryTotalKwh: number;
    consumptionHistoryMinKwh: number;
    consumptionHistoryNegativeHours: number;
    timestampUsedForReplay: string;
    deployedTimestampBehavior: string;
    weatherSource: string;
  };
  metrics: {
    productionLive: ReplayMetric;
    productionPerDevice: ReplayMetric;
    consumption: ReplayMetric;
  };
  night: {
    actualProductionKwh: number;
    forecastLiveKwh: number;
    forecastPerDeviceKwh: number;
  };
  points: ControlAuditReplayPoint[];
};

type ReplayMetric = {
  actualTotalKwh: number;
  forecastTotalKwh: number;
  maeKwh: number;
  rmseKwh: number;
  wapePercent: number;
};

/**
 * Reproducible one-off replay of the currently deployed checkpoints against
 * already measured data. Weather comes from the historical Open-Meteo archive,
 * so this is a model/input diagnostic, not a reconstruction of the forecast
 * that was actually emitted at the time.
 */
export const MS_VETRNIK_REPLAY: ControlAuditReplay = {
  title: "Kontrolní replay 18.–19. 7. 2026",
  description:
    "Aktuálně nasazené checkpointy dostaly 48 hodin tehdy známé historie a následně jsme jejich 34hodinový výstup porovnali s později naměřenou realitou střídače 36.",
  origin: "2026-07-18T00:00:00+02:00",
  horizonHours: 34,
  deviceId: "36",
  modelFiles: {
    production: "model_production_DE.pt",
    consumption: "model_consumption_DE2.pt",
  },
  inputs: {
    coordinates: [50.5472, 14.1287],
    historyHours: 48,
    sitePvPowerKwpPassedByLiveCode: 40,
    devicePvArrayKwp: 20,
    deviceMaxAcKw: 10,
    physicalDeviceScaleKwp: 10,
    productionHistoryTotalKwh: 137.141,
    productionHistoryMaxKwh: 9.731,
    consumptionHistoryTotalKwh: -29.27,
    consumptionHistoryMinKwh: -3.998,
    consumptionHistoryNegativeHours: 19,
    timestampUsedForReplay: "2026-07-17T23:00:00+02:00",
    deployedTimestampBehavior:
      "Živý proces používá aktuální čas serveru místo času posledního vstupního vzorku.",
    weatherSource:
      "Archiv skutečně pozorovaného hodinového počasí Open-Meteo; replay je proto horní kontrola modelu, ne archiv původní předpovědi počasí.",
  },
  metrics: {
    productionLive: {
      actualTotalKwh: 59.076,
      forecastTotalKwh: 438.105,
      maeKwh: 11.148,
      rmseKwh: 12.251,
      wapePercent: 641.6,
    },
    productionPerDevice: {
      actualTotalKwh: 59.076,
      forecastTotalKwh: 46.869,
      maeKwh: 0.847,
      rmseKwh: 1.489,
      wapePercent: 48.7,
    },
    consumption: {
      actualTotalKwh: -5.222,
      forecastTotalKwh: 11.668,
      maeKwh: 0.66,
      rmseKwh: 1.201,
      wapePercent: 90.9,
    },
  },
  night: {
    actualProductionKwh: 0,
    forecastLiveKwh: 101.43,
    forecastPerDeviceKwh: 0,
  },
  points: [
    ["2026-07-18T00:00:00+02:00", 0, 5.2383, 0, 0.2715, 0.0689, false],
    ["2026-07-18T01:00:00+02:00", 0, 4.3622, 0, 0.2482, 0.0946, false],
    ["2026-07-18T02:00:00+02:00", 0, 3.954, 0, 0.2457, 0.2542, false],
    ["2026-07-18T03:00:00+02:00", 0, 10.2276, 0, 0.2677, 0.4051, false],
    ["2026-07-18T04:00:00+02:00", 0, 11.8284, 0.2139, 0.247, 0.4539, false],
    ["2026-07-18T05:00:00+02:00", 0.1418, 17.1283, 1.7374, 0.3098, 0.4425, true],
    ["2026-07-18T06:00:00+02:00", 0.2079, 17.5162, 3.6491, 0.3281, 0.3326, true],
    ["2026-07-18T07:00:00+02:00", 0.4294, 18.1734, 5.7826, 0.4601, 0.3854, true],
    ["2026-07-18T08:00:00+02:00", 1.0383, 16.4885, 7.158, 0.6178, 0.4595, true],
    ["2026-07-18T09:00:00+02:00", 3.6821, 18.8047, 10.0745, 1.4106, 0.5719, true],
    ["2026-07-18T10:00:00+02:00", 6.6935, 18.6609, 11.9648, -1.5439, 0.5995, true],
    ["2026-07-18T11:00:00+02:00", 9.8369, 15.1702, 12.8438, -3.5038, 0, true],
    ["2026-07-18T12:00:00+02:00", 6.8843, 10.9884, 12.6757, -2.4578, 0.4159, true],
    ["2026-07-18T13:00:00+02:00", 3.2821, 13.3086, 12.1688, -0.8314, 0.3654, true],
    ["2026-07-18T14:00:00+02:00", 1.8555, 15.6856, 10.6071, -0.2057, 0.3498, true],
    ["2026-07-18T15:00:00+02:00", 5.5161, 13.8642, 8.4697, -2.1814, 0.4267, true],
    ["2026-07-18T16:00:00+02:00", 6.8314, 10.301, 5.9396, -2.6473, 0.5271, true],
    ["2026-07-18T17:00:00+02:00", 4.2506, 14.678, 4.379, -1.2634, 0.5153, true],
    ["2026-07-18T18:00:00+02:00", 2.4303, 12.3572, 1.8049, -0.3254, 0.4842, true],
    ["2026-07-18T19:00:00+02:00", 1.239, 15.0515, 0.8403, 0.1834, 0.3548, true],
    ["2026-07-18T20:00:00+02:00", 0.2704, 13.1238, 0, 0.3773, 0.2797, true],
    ["2026-07-18T21:00:00+02:00", 0, 12.6334, 0, 0.2324, 0.1997, true],
    ["2026-07-18T22:00:00+02:00", 0, 0, 0, 0.2492, 0.1647, false],
    ["2026-07-18T23:00:00+02:00", 0, 10.1995, 0, 0.2306, 0.176, false],
    ["2026-07-19T00:00:00+02:00", 0, 13.0635, 0, 0.2579, 0.201, false],
    ["2026-07-19T01:00:00+02:00", 0, 10.6033, 0, 0.2571, 0.2725, false],
    ["2026-07-19T02:00:00+02:00", 0, 0, 0, 0.2578, 0.3439, false],
    ["2026-07-19T03:00:00+02:00", 0, 13.7885, 2.0645, 0.2642, 0.3557, false],
    ["2026-07-19T04:00:00+02:00", 0, 18.1644, 3.2925, 0.2209, 0.3404, false],
    ["2026-07-19T05:00:00+02:00", 0.0191, 15.7183, 3.2115, 0.2914, 0.3395, true],
    ["2026-07-19T06:00:00+02:00", 0.2546, 17.214, 3.6451, 0.3418, 0.2578, true],
    ["2026-07-19T07:00:00+02:00", 0.4411, 16.2822, 5.4017, 0.4364, 0.274, true],
    ["2026-07-19T08:00:00+02:00", 0.7734, 17.3706, 7.5029, 0.5291, 0.4018, true],
    ["2026-07-19T09:00:00+02:00", 2.9981, 16.1558, 9.3348, 1.2025, 0.5537, true],
  ].map(
    ([
      timestamp,
      productionActualKwh,
      productionForecastLiveKwh,
      productionForecastDeviceKwh,
      consumptionActualKwh,
      consumptionForecastKwh,
      daylight,
    ]) => ({
      timestamp: String(timestamp),
      productionActualKwh: Number(productionActualKwh),
      productionForecastLiveKwh: Number(productionForecastLiveKwh),
      productionForecastDeviceKwh: Number(productionForecastDeviceKwh),
      consumptionActualKwh: Number(consumptionActualKwh),
      consumptionForecastKwh: Number(consumptionForecastKwh),
      daylight: Boolean(daylight),
    }),
  ),
};

const physicalDeviceForecast = [
  0, 0, 0, 0, 0, 0, 0, 1.1363, 2.2285, 3.5615, 4.9411, 5.6187,
  5.7651, 5.4372, 4.7471, 3.7689, 2.3101, 1.4369, 0.4754, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6558, 1.9055, 2.8809,
];

MS_VETRNIK_REPLAY.points.forEach((point, index) => {
  point.productionForecastDeviceKwh = physicalDeviceForecast[index] ?? 0;
});
