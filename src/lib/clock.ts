/** Shared (server + browser) clock formatting: "Fri, 20 Nov 2026" and "10:54 AM IST". */
export function formatClock(d: Date, timeZone: string, hour12: boolean) {
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12, timeZone }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`;
  let hour = get("hour");
  if (!hour12) hour = hour.padStart(2, "0").replace(/^24/, "00");
  const time = `${hour}:${get("minute")}${hour12 ? ` ${get("dayPeriod").toUpperCase()}` : ""}`;
  return { date, time, zone: tzLabel(timeZone, d) };
}

/** "IST" / "GMT+4" style short name. India shows as IST rather than GMT+5:30. */
export function tzLabel(timeZone: string, d = new Date()) {
  if (timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta") return "IST";
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/** "(GMT+05:30) Asia/Kolkata" for pickers; `minutes` sorts by offset. */
export function tzOption(timeZone: string, d = new Date()) {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = raw === "GMT" ? "GMT+00:00" : raw;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
  const minutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return { value: timeZone, minutes, label: `(${offset}) ${timeZone.replace(/_/g, " ")}` };
}
