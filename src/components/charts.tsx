"use client";

/**
 * Dashboard charts (spec §58). Palette: validated categorical slots
 * blue / orange / aqua in fixed order (never cycled). One y-axis per chart,
 * thin marks with rounded data-ends, recessive grid, legend for ≥2 series,
 * hover tooltip on every chart, and a table view for accessibility.
 */
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Area, AreaChart, LabelList } from "recharts";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"] as const;
const INK = "#0f172a";
const MUTED = "#64748b";
const GRID = "#e2e8f0";

type Fmt = "money" | "count";
const fmtMoney = (paise: number) => {
  const r = paise / 100;
  const abs = Math.abs(r);
  const s = abs >= 1e7 ? `${(abs / 1e7).toFixed(1)}Cr` : abs >= 1e5 ? `${(abs / 1e5).toFixed(1)}L` : abs >= 1e3 ? `${(abs / 1e3).toFixed(1)}k` : abs.toFixed(0);
  return `${r < 0 ? "−" : ""}₹${s}`;
};
const fmtFull = (paise: number) => `${paise < 0 ? "−" : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmt = (f: Fmt, v: number, full = false) => (f === "money" ? (full ? fmtFull(v) : fmtMoney(v)) : v.toLocaleString("en-IN"));

type Series = { key: string; label: string; kind?: "bar" | "line" };
/** Axis label formats (functions can't be passed from server components). */
export type XFormat = "month" | "day" | "none";
const LABELERS: Record<XFormat, ((l: string) => string) | undefined> = {
  month: (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }),
  day: (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
  none: undefined,
};

function ChartTooltip({ active, payload, label, format, labelFormat }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; format: Fmt; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold" style={{ color: INK }}>{labelFormat ? labelFormat(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2" style={{ color: MUTED }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium" style={{ color: INK }}>{fmt(format, p.value, true)}</span>
        </p>
      ))}
    </div>
  );
}

function TableView({ rows, xKey, xLabel, series, format, labelFormat }: { rows: Record<string, number | string>[]; xKey: string; xLabel: string; series: Series[]; format: Fmt; labelFormat?: (l: string) => string }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-slate-500">Show as table</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full">
          <thead><tr className="text-left text-slate-500"><th className="py-1 pr-3">{xLabel}</th>{series.map((s) => <th key={s.key} className="py-1 pr-3 text-right">{s.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[xKey])} className="border-t border-slate-100">
                <td className="py-1 pr-3">{labelFormat ? labelFormat(String(r[xKey])) : r[xKey]}</td>
                {series.map((s) => <td key={s.key} className="py-1 pr-3 text-right">{fmt(format, Number(r[s.key]), true)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Grouped bars (+ optional line) on ONE shared axis. */
export function BarsChart({
  rows, xKey, xLabel, series, format = "money", height = 260, xFormat = "none",
}: {
  rows: Record<string, number | string>[];
  xKey: string;
  xLabel: string;
  series: Series[];
  format?: Fmt;
  height?: number;
  xFormat?: XFormat;
}) {
  const labelFormat = LABELERS[xFormat];
  if (!rows.length) return <p className="py-10 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={xKey} tickFormatter={labelFormat} tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis tickFormatter={(v) => fmt(format, v)} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<ChartTooltip format={format} labelFormat={labelFormat} />} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
            {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: MUTED }} itemSorter={(item) => series.findIndex((x) => x.key === item.dataKey)} />}
            {series.map((s, i) =>
              s.kind === "line" ? (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 5 }} />
              ) : (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i % SERIES.length]} radius={[4, 4, 0, 0]} maxBarSize={28} stroke="#fff" strokeWidth={1} />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <TableView rows={rows} xKey={xKey} xLabel={xLabel} series={series} format={format} labelFormat={labelFormat} />
    </div>
  );
}

/** Single-series area over time (works per day). */
export function TrendChart({ rows, xKey, yKey, label, height = 220, xFormat = "none" }: { rows: Record<string, number | string>[]; xKey: string; yKey: string; label: string; height?: number; xFormat?: XFormat }) {
  const labelFormat = LABELERS[xFormat];
  if (!rows.length) return <p className="py-10 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey={xKey} tickFormatter={labelFormat} tick={{ fontSize: 11, fill: MUTED }} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={28} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={32} />
            <Tooltip content={<ChartTooltip format="count" labelFormat={labelFormat} />} cursor={{ stroke: MUTED, strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey={yKey} name={label} stroke={SERIES[0]} strokeWidth={2} fill={SERIES[0]} fillOpacity={0.12} activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <TableView rows={rows.filter((r) => Number(r[yKey]) > 0)} xKey={xKey} xLabel="Date" series={[{ key: yKey, label }]} format="count" labelFormat={labelFormat} />
    </div>
  );
}

/** Horizontal single-series bars with direct value labels (works by status). */
export function RankedBars({ rows, label }: { rows: { name: string; value: number }[]; label: string }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <div style={{ height: Math.max(120, rows.length * 30 + 20) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip format="count" />} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
          <Bar dataKey="value" name={label} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18}>
            <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: INK }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
