/** Small puppeteer helpers shared by the tutorial scripts (uses the installed Chrome). */
import puppeteer, { type Browser, type Page } from "puppeteer-core";

export type Role = "admin" | "agent" | "worker" | "customer";
export const BASE = (process.env.TUTORIAL_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Demo accounts from prisma/seed.ts and scripts/tutorials/demo-data.ts (local demo database only).
const LOGINS: Record<Role, { path: string; email: string }> = {
  admin: { path: "/login", email: "superadmin@crm.test" },
  agent: { path: "/agent/login", email: "agent@crm.test" },
  worker: { path: "/worker/login", email: "worker1@crm.test" },
  customer: { path: "/portal/login", email: "ravi.customer@example.com" },
};
const DEMO_PASSWORD = process.env.TUTORIAL_PASSWORD || "Password@123";

export const VIEWPORTS = {
  desktop: { width: 1366, height: 860, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

export async function launch(): Promise<Browser> {
  return puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
}

/** One signed-in page per role (separate browser contexts so cookies don't mix). */
export async function signedIn(browser: Browser, role: Role, device: keyof typeof VIEWPORTS): Promise<Page> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(VIEWPORTS[device]);
  // tsx/esbuild wraps named functions with __name(); define it inside the page too.
  await page.evaluateOnNewDocument("globalThis.__name = (f) => f;");
  // Treat the first-visit guided tour as already seen, so it doesn't cover the screenshots.
  await page.evaluateOnNewDocument(`(() => { const get = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { return String(k).startsWith("crm.tour.") ? "seen" : get.call(this, k); }; })();`);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const { path, email } = LOGINS[role];
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", DEMO_PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click("button[type=submit]")]);
  if (page.url().includes("/login")) throw new Error(`Sign-in failed for ${role} (${email}). Is the demo database loaded?`);
  return page;
}
