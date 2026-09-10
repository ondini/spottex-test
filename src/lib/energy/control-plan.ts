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

// --- Drawing the plan into the charts ---------------------------------------
//
// The plan belongs where the owner already looks: over production and
// consumption, and over the battery. A mode is a shaded band, a change of mode
// is a marked point that says what the control aims for there.

export type PlanModeStyle = { color: string; opacity: number; label: string };

export function planModeStyle(mode: string): PlanModeStyle {
  const value = mode.trim();
  if (isSelfUseMode(value)) return { color: "#82c651", opacity: 0.07, label: "Vlastní spotřeba" };
  if (/nabíj|charge/i.test(value)) return { color: "#38bdf8", opacity: 0.18, label: value };
  if (/vybíj|discharge/i.test(value)) return { color: "#8b5cf6", opacity: 0.18, label: value };
  if (/přetok|feed/i.test(value)) return { color: "#f59e0b", opacity: 0.18, label: value };
  if (/záloha|backup/i.test(value)) return { color: "#0ea5e9", opacity: 0.16, label: value };
  if (/vypnuto|off/i.test(value)) return { color: "#94a3b8", opacity: 0.16, label: value };
  return { color: "#64748b", opacity: 0.14, label: value };
}

export type PlanOverlaySegment = {
  id: string;
  fromKey: string;
  toKey: string;
  mode: string;
  color: string;
  opacity: number;
};

export type PlanOverlayMarker = {
  id: string;
  atKey: string;
  mode: string;
  color: string;
  /** Short caption drawn at the point: what changes and what it aims for. */
  caption: string;
  targetSocPct: number | null;
};

export type PlanOverlay = {
  segments: PlanOverlaySegment[];
  markers: PlanOverlayMarker[];
  modes: Array<{ mode: string; color: string }>;
};

function formatPct(value: number) {
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(value)} %`;
}

/**
 * Maps plan blocks onto the categorical x axis of a chart. `points` are the
 * chart's own rows in order, each with the instant it represents and the key
 * the axis uses, so a band starts and ends exactly on a drawn point.
 */
export function buildPlanOverlay(
  blocks: ControlPlanBlock[],
  points: Array<{ at: string; key: string }>,
): PlanOverlay {
  if (!blocks.length || !points.length) return { segments: [], markers: [], modes: [] };
  const times = points.map((point) => new Date(point.at).getTime());
  const segments: PlanOverlaySegment[] = [];
  const markers: PlanOverlayMarker[] = [];
  const modes = new Map<string, string>();
  blocks.forEach((block, index) => {
    const start = new Date(block.startAt).getTime();
    const end = new Date(block.endAt).getTime();
    const firstIndex = times.findIndex((time) => time >= start && time < end);
    if (firstIndex < 0) return;
    let lastIndex = firstIndex;
    while (lastIndex + 1 < times.length && times[lastIndex + 1] < end) lastIndex += 1;
    const style = planModeStyle(block.mode);
    modes.set(block.mode, style.color);
    segments.push({
      id: `${block.startAt}-${index}`,
      fromKey: points[firstIndex].key,
      toKey: points[lastIndex].key,
      mode: block.mode,
      color: style.color,
      opacity: style.opacity,
    });
    // A marker only where the plan actually switches inside the chart, not at
    // its left edge, where the band already starts the picture.
    if (index > 0 && times[firstIndex] >= start) {
      markers.push({
        id: `${block.startAt}-marker-${index}`,
        atKey: points[firstIndex].key,
        mode: block.mode,
        color: style.color,
        caption: block.targetSocPct != null ? `${style.label} · cíl ${formatPct(block.targetSocPct)}` : style.label,
        targetSocPct: block.targetSocPct,
      });
    }
  });
  return { segments, markers, modes: [...modes].map(([mode, color]) => ({ mode, color })) };
}
