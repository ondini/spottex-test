"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type HistoryPoint = {
  date: string;
  productionKwh: number;
  consumptionKwh: number;
  intervals: number;
};

const dateFormatter = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "short",
  year: "2-digit",
});

export function ControlAuditHistoryChart({ data }: { data: HistoryPoint[] }) {
  if (!data.length) {
    return (
      <div className="grid h-72 place-items-center text-sm text-slate-400">
        Pro tuto elektrárnu nejsou uložená měřená data.
      </div>
    );
  }
  const tickStep = Math.max(1, Math.floor(data.length / 8));
  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="auditProduction" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#65b741" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#65b741" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="auditConsumption" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#64748b" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#64748b" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            interval={tickStep}
            tickFormatter={(value: string) => dateFormatter.format(new Date(`${value}T12:00:00Z`))}
            minTickGap={28}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            width={54}
            unit=" kWh"
          />
          <Tooltip
            labelFormatter={(value) =>
              dateFormatter.format(new Date(`${String(value)}T12:00:00Z`))
            }
            formatter={(value, name) => [
              `${Number(value).toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} kWh`,
              name,
            ]}
            contentStyle={{
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
            }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Area
            type="monotone"
            dataKey="consumptionKwh"
            name="Spotřeba"
            stroke="#64748b"
            strokeWidth={1.8}
            fill="url(#auditConsumption)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="productionKwh"
            name="Výroba"
            stroke="#4d9e2f"
            strokeWidth={2}
            fill="url(#auditProduction)"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
