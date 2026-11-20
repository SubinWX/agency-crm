import { afterEach, describe, expect, it } from "vitest";
import { formatClock, tzOption } from "@/lib/clock";
import { AppError } from "@/server/lib/errors";
import { businessToday, businessTz, dayStart, setBusinessTz, systemTimeZone } from "@/server/lib/dates";
import { transaction } from "@/server/db";
import { getSetting, loadBusinessTz, updateSetting } from "@/server/modules/settings/service";
import { prisma } from "@/server/db";
import { actor } from "./helpers";

afterEach(() => setBusinessTz("Asia/Kolkata"));

describe("business time zone", () => {
  // 20 Nov 2026 20:00 UTC = 21 Nov 01:30 in India, still 20 Nov in New York.
  const t = new Date("2026-11-20T20:00:00Z");

  it("decides which day 'today' is", () => {
    setBusinessTz("Asia/Kolkata");
    expect(businessToday(t)).toBe("2026-11-21");
    setBusinessTz("America/New_York");
    expect(businessToday(t)).toBe("2026-11-20");
    expect(dayStart("2026-11-20").toISOString()).toBe("2026-11-20T05:00:00.000Z");
  });

  it("supports the server's system zone and ignores bad values", () => {
    expect(setBusinessTz("system")).toBe(systemTimeZone());
    expect(setBusinessTz("Mars/Olympus")).toBe("Asia/Kolkata");
  });

  it("formats the top-bar clock", () => {
    expect(formatClock(t, "Asia/Kolkata", true)).toEqual({ date: "Sat, 21 Nov 2026", time: "1:30 AM", zone: "IST" });
    expect(formatClock(t, "Asia/Kolkata", false).time).toBe("01:30");
    expect(tzOption("Asia/Kolkata", t).label).toBe("(GMT+05:30) Asia/Kolkata");
  });

  it("is saved in settings by admins only and loaded into the app", async () => {
    const before = await getSetting("dateTime");
    const sa = await actor("superadmin@crm.test");
    try {
      await transaction((tx) => updateSetting(sa, "dateTime", { timeZone: "Asia/Dubai", clockFormat: "24h" }, tx));
      expect(await loadBusinessTz()).toBe("Asia/Dubai");
      expect(businessTz()).toBe("Asia/Dubai");
      const bad = await transaction((tx) => updateSetting(sa, "dateTime", { timeZone: "Nowhere/City", clockFormat: "12h" }, tx)).catch((e) => e);
      expect(bad).toBeInstanceOf(AppError);
      const agent = await actor("agent@crm.test");
      const denied = await transaction((tx) => updateSetting(agent, "dateTime", { timeZone: "UTC", clockFormat: "12h" }, tx)).catch((e) => e);
      expect((denied as AppError).code).toBe("FORBIDDEN");
    } finally {
      await prisma.setting.upsert({ where: { key: "dateTime" }, create: { key: "dateTime", value: before }, update: { value: before } });
    }
  });
});
