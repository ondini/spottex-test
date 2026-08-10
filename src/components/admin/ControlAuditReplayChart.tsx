"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ControlAuditReplay } from "@/lib/admin/control-audit-replay";

const hourFormatter = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatKwh(value: number) {
  return `${value.toLocaleString("cs-CZ", {
    maximumFractionDigits: 2,
  })} kWh`;
}

function ReplayPlot({
  data,
  kind,
}: {
  data: ControlAuditReplay["points"];
  kind: "production" | "consumption";
}) {
  const isProduction = kind === "production";
  return (
    <div className="h-[310px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
        >
          <CartesianGrid
            stroke="#e2e8f0"
            strokeDasharray="4 4"
            vertical={false}
          />
          <XAxis
            dataKey="timestamp"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            minTickGap={42}
            tickFormatter={(value: string) =>
              hourFormatter.format(new Date(value))
            }
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            width={52}
            unit=" kWh"
          />
          <Tooltip
            labelFormatter={(value) =>
              hourFormatter.format(new Date(String(value)))
            }
            formatter={(value, name) => [formatKwh(Number(value)), name]}
            contentStyle={{
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
            }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" />
          {isProduction ? (
            <>
              <Line
                type="monotone"
                dataKey="productionActualKwh"
                name="Následně naměřeno"
                stroke="#3f8f2c"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="productionForecastLiveKwh"
                name="Živý vstup 40 kWp"
                stroke="#dc2626"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="productionForecastDeviceKwh"
                name="Po opravě na 20 kWp zařízení"
                stroke="#7c3aed"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </>
          ) : (
            <>
              <Line
                type="monotone"
                dataKey="consumptionActualKwh"
                name="Vstup označený jako spotřeba"
                stroke="#475569"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="consumptionForecastKwh"
                name="Odhad modelu"
                stroke="#2563eb"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ControlAuditReplayChart({
  replay,
}: {
  replay: ControlAuditReplay;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Výroba: odhad proti následnému měření
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Jeden střídač · hodinové hodnoty
              </p>
            </div>
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
              WAPE {replay.metrics.productionLive.wapePercent.toLocaleString("cs-CZ")} %
            </span>
          </div>
          <ReplayPlot data={replay.points} kind="production" />
        </div>

        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Spotřeba: odhad proti vstupním datům
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Záporné hodnoty nejsou fyzická spotřeba objektu
              </p>
            </div>
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
              {replay.inputs.consumptionHistoryNegativeHours} záporných vstupních hodin
            </span>
          </div>
          <ReplayPlot data={replay.points} kind="consumption" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Reálná výroba",
            value: formatKwh(replay.metrics.productionLive.actualTotalKwh),
            detail: `${replay.horizonHours} hodin`,
          },
          {
            label: "Predikce živého nastavení",
            value: formatKwh(replay.metrics.productionLive.forecastTotalKwh),
            detail: "40 kWp poslaných modelu jednoho střídače",
          },
          {
            label: "Predikce po opravě vstupů",
            value: formatKwh(replay.metrics.productionPerDevice.forecastTotalKwh),
            detail: "10 kW zařízení a čas posledního vzorku",
          },
          {
            label: "Noční nesmysl modelu",
            value: formatKwh(replay.night.forecastLiveKwh),
            detail: `realita ${formatKwh(replay.night.actualProductionKwh)}`,
          },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {item.value}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
