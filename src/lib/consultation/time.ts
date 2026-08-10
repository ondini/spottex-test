const PRAGUE_TIME_ZONE = "Europe/Prague";

function pragueOffsetMs(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PRAGUE_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

export function pragueWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = pragueOffsetMs(new Date(guess));
  let utc = guess - firstOffset;
  const correctedOffset = pragueOffsetMs(new Date(utc));
  if (correctedOffset !== firstOffset) utc = guess - correctedOffset;
  return new Date(utc);
}

export function pragueDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: PRAGUE_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday] ?? 1,
  };
}

export type SlotCandidate = { startUtc: Date; endUtc: Date };

export function generateWeekSlots(
  reference: Date,
  options: { daysCount?: number; startHour?: number; endHour?: number; slotMinutes?: number } = {},
): SlotCandidate[] {
  const daysCount = options.daysCount ?? 5;
  const startHour = options.startHour ?? 9;
  const endHour = options.endHour ?? 17;
  const slotMinutes = options.slotMinutes ?? 30;
  const localReference = pragueDateParts(reference);
  const monday = Date.UTC(localReference.year, localReference.month - 1, localReference.day)
    - (localReference.weekday - 1) * 86_400_000;
  const slots: SlotCandidate[] = [];

  for (let dayIndex = 0; dayIndex < daysCount; dayIndex += 1) {
    const localDay = new Date(monday + dayIndex * 86_400_000);
    for (let hour = startHour; hour < endHour; hour += 1) {
      for (let minute = 0; minute < 60; minute += slotMinutes) {
        const startUtc = pragueWallClockToUtc(
          localDay.getUTCFullYear(),
          localDay.getUTCMonth() + 1,
          localDay.getUTCDate(),
          hour,
          minute,
        );
        slots.push({ startUtc, endUtc: new Date(startUtc.getTime() + slotMinutes * 60_000) });
      }
    }
  }
  return slots;
}

export function nextWeekReference(now = new Date()): Date {
  return new Date(now.getTime() + 7 * 86_400_000);
}

export function formatPragueDate(date: Date): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date);
}

