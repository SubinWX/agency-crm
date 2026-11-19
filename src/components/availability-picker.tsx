"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Day = { date: string; capacity: number; booked: number; remaining: number; status: "available" | "full" | "blocked" | "past"; blockReason?: string | null };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthStart(iso: string) {
  return iso.slice(0, 8) + "01";
}
function addMonths(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
}
function monthEnd(iso: string) {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

/**
 * Calendar date picker showing company-wide capacity per day. Full, blocked
 * and past dates cannot be selected. The final check still happens on the
 * server inside a locked transaction — this is only guidance for the user.
 */
export function AvailabilityPicker({ name = "workDate", today, defaultValue }: { name?: string; today: string; defaultValue?: string }) {
  const [month, setMonth] = useState(monthStart(defaultValue || today));
  const [days, setDays] = useState<Day[]>([]);
  const [selected, setSelected] = useState(defaultValue ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/availability?from=${m}&to=${monthEnd(m)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setDays((await res.json()).days);
    } catch {
      setError("Could not load availability. Please retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [month, load]);

  // When the server suggests another date (full-slot error), jump to it.
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    const onPick = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      setSelected(d);
      setMonth(monthStart(d));
    };
    form?.addEventListener("crm:date-picked", onPick);
    return () => form?.removeEventListener("crm:date-picked", onPick);
  }, []);

  const first = new Date(`${month}T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const selectedDay = days.find((d) => d.date === selected);

  return (
    <div ref={rootRef} className="rounded-xl border border-slate-200 bg-white p-3">
      <input type="hidden" name={name} value={selected} />
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="btn-secondary px-3 py-1" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= monthStart(today)} aria-label="Previous month">
          ‹
        </button>
        <span className="text-sm font-semibold">
          {first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
        </span>
        <button type="button" className="btn-secondary px-3 py-1" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className={`mt-1 grid grid-cols-7 gap-1 ${loading ? "opacity-50" : ""}`}>
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {days.map((d) => {
          const disabled = d.status !== "available";
          const isSel = d.date === selected;
          const tone =
            d.status === "past"
              ? "bg-slate-50 text-slate-300"
              : d.status === "blocked"
                ? "bg-slate-200 text-slate-500"
                : d.status === "full"
                  ? "bg-red-50 text-red-400"
                  : d.remaining <= Math.max(1, Math.floor(d.capacity * 0.2))
                    ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
          return (
            <button
              key={d.date}
              type="button"
              disabled={disabled}
              onClick={() => setSelected(d.date)}
              title={d.status === "blocked" ? `Blocked: ${d.blockReason ?? ""}` : `${d.booked}/${d.capacity} booked`}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition ${tone} ${isSel ? "ring-2 ring-blue-600 ring-offset-1" : ""} disabled:cursor-not-allowed`}
            >
              <span className="font-semibold">{Number(d.date.slice(8))}</span>
              {d.status !== "past" && (
                <span className="text-[10px] leading-none">{d.status === "full" ? "Full" : d.status === "blocked" ? "Closed" : `${d.remaining} left`}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-emerald-200" /> Available</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-amber-200" /> Few left</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-red-200" /> Full</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-slate-300" /> Closed</span>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error} <button type="button" className="underline" onClick={() => load(month)}>Retry</button></p>}
      <p className="mt-2 text-sm">
        {selected ? (
          <>
            Selected: <strong>{selected}</strong>
            {selectedDay && ` · ${selectedDay.remaining} of ${selectedDay.capacity} slots left`}
          </>
        ) : (
          <span className="text-slate-500">Tap an available date.</span>
        )}
      </p>
    </div>
  );
}
