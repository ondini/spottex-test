const MAX_UNSERVED_SHARE = 0.0001;
const MAX_UNSERVED_KWH = 1;

export function unservedEnergyToleranceKwh(consumptionKwh: number) {
  if (!Number.isFinite(consumptionKwh) || consumptionKwh <= 0) return 0;
  return Math.min(MAX_UNSERVED_KWH, consumptionKwh * MAX_UNSERVED_SHARE);
}

export function hasMaterialUnservedEnergy(
  unservedKwh: number,
  consumptionKwh: number,
) {
  if (!Number.isFinite(unservedKwh) || unservedKwh < 0) return true;
  return unservedKwh > unservedEnergyToleranceKwh(consumptionKwh) + 0.000001;
}
