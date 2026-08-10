"use client";

import type { ControlAudit } from "@/lib/admin/control-audit";

type CoverageDay = ControlAudit["coverageTimeline"][number];
type Inverter = ControlAudit["inverters"][number];

const dateFormatter = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function dayTitle(day: CoverageDay, inverters: Inverter[]) {
  const deviceLines = day.inverters.map((coverage) => {
    const inverter = inverters.find((item) => item.id === coverage.inverterId);
    return `${inverter?.name ?? `Střídač ${coverage.inverterId}`}: výroba ${coverage.productionIntervals}/96, spotřeba ${coverage.consumptionIntervals}/96`;
  });
  return [
    dateFormatter.format(new Date(`${day.date}T12:00:00Z`)),
    `Výroba ${day.productionKwh.toLocaleString("cs-CZ")} kWh`,
    `Spotřeba ${day.consumptionKwh.toLocaleString("cs-CZ")} kWh`,
    ...deviceLines,
    day.suspiciousZeroProduction
      ? "Podezření: při dostupné spotřebě je výroba téměř nulová."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function inverterTone(state: "FULL" | "PARTIAL" | "NONE") {
  if (state === "FULL") return "bg-emerald-500";
  if (state === "PARTIAL") return "bg-amber-400";
  return "bg-slate-200";
}

function summaryTone(day: CoverageDay) {
  if (day.suspiciousZeroProduction) return "bg-red-500";
  if (day.state === "BOTH") return "bg-emerald-700";
  if (day.state === "ONE") return "bg-amber-500";
  if (day.state === "PARTIAL") return "bg-yellow-300";
  return "bg-slate-200";
}

export function ControlAuditCoverageTimeline({
  data,
  inverters,
}: {
  data: CoverageDay[];
  inverters: Inverter[];
}) {
  if (!data.length) {
    return (
      <div className="grid h-32 place-items-center text-sm text-slate-400">
        Pokrytí zařízení zatím nelze zobrazit.
      </div>
    );
  }

  const months: Array<{ label: string; length: number }> = [];
  const monthFormatter = new Intl.DateTimeFormat("cs-CZ", { month: "short" });
  for (const day of data) {
    const key = day.date.slice(0, 7);
    const previous = months.at(-1);
    if (previous?.label === key) {
      previous.length += 1;
    } else {
      months.push({ label: key, length: 1 });
    }
  }
  const minWidth = Math.max(920, data.length * 4);
  const columns = `repeat(${data.length}, minmax(3px, 1fr))`;

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div style={{ minWidth }}>
          <div className="mb-2 grid gap-px" style={{ gridTemplateColumns: columns }}>
            {months.map((month) => (
              <div
                key={month.label}
                className="overflow-hidden whitespace-nowrap px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400"
                style={{ gridColumn: `span ${month.length}` }}
                title={dateFormatter.format(
                  new Date(`${month.label}-15T12:00:00Z`),
                )}
              >
                {monthFormatter.format(new Date(`${month.label}-15T12:00:00Z`))}
                {month.label.endsWith("-01") ? ` ${month.label.slice(0, 4)}` : ""}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            {inverters.map((inverter) => (
              <div key={inverter.id} className="contents">
                <div className="truncate text-xs font-medium text-slate-600">
                  {inverter.name}
                  <span className="ml-1 font-mono text-[10px] text-slate-400">
                    #{inverter.externalDeviceId}
                  </span>
                </div>
                <div
                  className="grid h-5 gap-px overflow-hidden rounded"
                  style={{ gridTemplateColumns: columns }}
                >
                  {data.map((day) => {
                    const value = day.inverters.find(
                      (item) => item.inverterId === inverter.id,
                    );
                    return (
                      <span
                        key={`${inverter.id}-${day.date}`}
                        className={inverterTone(value?.state ?? "NONE")}
                        title={dayTitle(day, inverters)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="text-xs font-semibold text-slate-800">Výsledek dne</div>
            <div
              className="grid h-7 gap-px overflow-hidden rounded"
              style={{ gridTemplateColumns: columns }}
            >
              {data.map((day) => (
                <span
                  key={`summary-${day.date}`}
                  className={summaryTone(day)}
                  title={dayTitle(day, inverters)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
        {[
          ["bg-emerald-700", "oba střídače mají téměř celý den"],
          ["bg-amber-500", "celý den měří jen jeden"],
          ["bg-yellow-300", "jen část dne"],
          ["bg-slate-200", "bez měření"],
          ["bg-red-500", "podezřelá nulová výroba"],
        ].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-2">
            <span className={`size-2.5 rounded-sm ${color}`} />
            {label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        „Celý den“ zde znamená alespoň 80 z očekávaných 96 čtvrthodinových
        intervalů výroby i spotřeby. Na jednotlivý proužek lze najet pro přesné
        počty.
      </p>
    </div>
  );
}
