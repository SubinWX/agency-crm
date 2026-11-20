"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/clock";

/** Date + time in the business time zone, ticking every few seconds. */
export function LiveClock({ timeZone, hour12, initial }: { timeZone: string; hour12: boolean; initial: { date: string; time: string; zone: string } }) {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const tick = () => setNow(formatClock(new Date(), timeZone, hour12));
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [timeZone, hour12]);
  return (
    <span className="hidden items-center gap-2 whitespace-nowrap text-sm text-slate-500 lg:inline-flex" title={`Time zone: ${timeZone}`}>
      <span className="hidden xl:inline">{now.date}</span>
      <span className="hidden h-4 w-px bg-slate-200 xl:inline-block" />
      <span className="font-medium tabular-nums text-slate-700">{now.time}</span>
      <span className="text-xs text-slate-400">{now.zone}</span>
    </span>
  );
}
