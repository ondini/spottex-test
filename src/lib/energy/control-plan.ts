// The control plan as the owner reads it: which mode the inverter is in now,
// the blocks that follow, and whether the whole plan is plain self-use (with a
// single-rate tariff that is the optimum and looks like "nothing happens").

export type ControlPlanBlock = {
  startAt: string;
  endAt: string;
  mode: string;
  targetSocPct: number | null;
  batteryKw: number | null;
};

export type ControlPlan = {
  current: ControlPlanBlock | null;
  upcoming: ControlPlanBlock[];
  allSelfUse: boolean;
  horizonEndAt: string | null;
};

const SELF_USE_LABELS = new Set(["SELF_USE", "Vlastní spotřeba", "self_use", "AUTO"]);

export function isSelfUseMode(mode: string) {
  return SELF_USE_LABELS.has(mode.trim());
}

export function describeControlPlan(
  schedule: Array<{ startAt: string; endAt: string; mode: string; targetSocPct: number | null; batteryKw: number | null }>,
  now: Date,
  horizonHours = 24,
): ControlPlan {
  const horizonEnd = new Date(now.getTime() + horizonHours * 3_600_000);
  const sorted = [...schedule]
    .filter((item) => new Date(item.endAt) > now && new Date(item.startAt) < horizonEnd)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  // Blocks overlap when a newer plan is written over an older one; the block
  // that starts last for a given moment is the newest, so later starts win.
  const blocks: ControlPlanBlock[] = [];
  for (const item of sorted) {
    const previous = blocks[blocks.length - 1];
    if (previous && new Date(previous.endAt) > new Date(item.startAt)) previous.endAt = item.startAt;
    if (previous && previous.mode === item.mode && previous.endAt === item.startAt) {
      previous.endAt = item.endAt;
      previous.targetSocPct = item.targetSocPct ?? previous.targetSocPct;
      continue;
    }
    blocks.push({ startAt: item.startAt, endAt: item.endAt, mode: item.mode, targetSocPct: item.targetSocPct, batteryKw: item.batteryKw });
  }
  const current = blocks.find((block) => new Date(block.startAt) <= now && new Date(block.endAt) > now) ?? null;
  const upcoming = blocks.filter((block) => block !== current);
  return {
    current,
    upcoming,
    allSelfUse: blocks.length > 0 && blocks.every((block) => isSelfUseMode(block.mode)),
    horizonEndAt: blocks.length ? blocks[blocks.length - 1].endAt : null,
  };
}
