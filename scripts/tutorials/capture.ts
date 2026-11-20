/**
 * Captures the Help & tutorials walk-through screenshots from a server running
 * on the DEMO database, highlights what to click, and writes:
 *   public/help/<guide>-<step>.webp
 *   src/server/modules/help/walkthroughs.generated.ts
 *
 *   npm run tutorials:capture            (server on http://localhost:3100)
 *   npm run tutorials:capture -- invoice (only some guides)
 */
import "../load-env";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Page } from "puppeteer-core";
import { prisma } from "../../src/server/db";
import { GUIDES } from "../../src/server/modules/help/guides";
import { BASE, launch, signedIn, type Role } from "./browser";
import { SHOTS } from "./shots";

const OUT = path.join(process.cwd(), "public", "help");
const MANIFEST = path.join(process.cwd(), "src", "server", "modules", "help", "walkthroughs.generated.ts");

const db = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
if (!db.includes("demo")) {
  console.error(`DATABASE_URL points at "${db}". Run the server and this script on the demo database so no real customer data ends up in the help pictures.`);
  process.exit(1);
}

/** {WRK-000001} → work id, etc. */
async function resolver() {
  const [works, invoices, tickets, items, customers] = await Promise.all([
    prisma.work.findMany({ select: { id: true, reference: true } }),
    prisma.invoice.findMany({ select: { id: true, number: true } }),
    prisma.supportTicket.findMany({ select: { id: true, number: true } }),
    prisma.item.findMany({ select: { id: true, code: true } }),
    prisma.customer.findMany({ select: { id: true, name: true } }),
  ]);
  const map = new Map<string, string>([
    ...works.map((w) => [w.reference, w.id] as [string, string]),
    ...invoices.map((i) => [i.number, i.id] as [string, string]),
    ...tickets.map((t) => [t.number, t.id] as [string, string]),
    ...items.map((i) => [i.code, i.id] as [string, string]),
    ...customers.map((c) => [`customer:${c.name}`, c.id] as [string, string]),
  ]);
  return (url: string) =>
    url.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const id = map.get(key);
      if (!id) throw new Error(`Demo data has no ${key} — run npm run tutorials:demo first.`);
      return id;
    });
}

/** Runs in the page: find the element, scroll to it and draw the spotlight + step badge. */
async function highlight(page: Page, spec: string, step: number) {
  return page.evaluate(
    (spec, step) => {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (e: Element) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === "fixed";
      let el: Element | null = null;
      if (/^[.#[]/.test(spec)) el = document.querySelector(spec);
      else {
        const m = /^(h1|h2|h3|a|button|label|legend|th):(.*)$/.exec(spec);
        const tags = m ? m[1] : "h1,h2,h3,legend,button,a,label,th";
        const want = norm(m ? m[2] : spec);
        const all = [...document.querySelectorAll(tags)].filter(visible);
        const inMain = (e: Element) => (e.closest("main") ? 0 : 1);
        const score = (e: Element) => {
          const t = norm((e as HTMLElement).innerText);
          return t === want ? 0 : t.startsWith(want) ? 1 : t.includes(want) ? 2 : 9;
        };
        el = all.map((e) => ({ e, s: score(e) * 2 + inMain(e) })).filter((x) => x.s < 18).sort((a, b) => a.s - b.s)[0]?.e ?? null;
      }
      if (!el) return false;
      let target = el as HTMLElement;
      if (/^(H2|H3|LEGEND)$/.test(el.tagName)) target = (el.closest(".card, section, fieldset") as HTMLElement) ?? target;
      if (el.tagName === "LABEL" && el.parentElement && el.parentElement.getBoundingClientRect().height < 220) target = el.parentElement;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      const r = target.getBoundingClientRect();
      const pad = 6;
      const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
      const width = Math.min(window.innerWidth - left - 4, r.width + pad * 2), height = Math.min(window.innerHeight - top - 4, r.height + pad * 2);
      const ring = document.createElement("div");
      ring.setAttribute("data-tutorial-mark", "");
      Object.assign(ring.style, {
        position: "fixed", top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px`, zIndex: "2147483646", pointerEvents: "none",
        border: "3px solid #2563eb", borderRadius: "12px", boxShadow: "0 0 0 6px rgba(37,99,235,.25), 0 0 0 9999px rgba(15,23,42,.30)",
      });
      const badge = document.createElement("div");
      badge.textContent = String(step);
      Object.assign(badge.style, {
        position: "fixed", top: `${Math.max(2, top - 14)}px`, left: `${Math.max(2, left - 14)}px`, width: "30px", height: "30px", borderRadius: "999px", zIndex: "2147483647",
        background: "#2563eb", color: "#fff", font: "700 15px/30px system-ui, sans-serif", textAlign: "center", boxShadow: "0 2px 6px rgba(0,0,0,.3)", pointerEvents: "none",
      });
      document.body.append(ring, badge);
      return true;
    },
    spec,
    step,
  );
}

async function main() {
  const only = process.argv.slice(2);
  const resolve = await resolver();
  mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const pages = new Map<string, Page>();
  const pageFor = async (as: Role, device: "desktop" | "phone") => {
    const key = `${as}-${device}`;
    if (!pages.has(key)) pages.set(key, await signedIn(browser, as, device));
    return pages.get(key)!;
  };
  const manifest: Record<string, { step: number; src: string; device: "desktop" | "phone" }[]> = {};
  const written = new Set<string>();
  let fails = 0;

  for (const guide of GUIDES) {
    const plan = SHOTS[guide.id];
    if (!plan || (only.length && !only.includes(guide.id))) continue;
    manifest[guide.id] = [];
    for (const [i, shot] of plan.entries()) {
      if (!shot || i >= guide.steps.length) continue;
      const device = shot.device ?? "desktop";
      const page = await pageFor(shot.as, device);
      const url = BASE + resolve(shot.go);
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
        await page.addStyleTag({ content: "nextjs-portal{display:none!important} *{caret-color:transparent!important; transition:none!important; animation:none!important}" });
        await page.evaluate(() => document.querySelectorAll("[data-tutorial-mark]").forEach((e) => e.remove()));
        const marks = shot.mark ? (Array.isArray(shot.mark) ? shot.mark : [shot.mark]) : [];
        let ok = marks.length === 0;
        for (const m of marks) if (!ok) ok = await highlight(page, m, i + 1);
        if (!ok) {
          fails++;
          console.warn(`  ! ${guide.id} step ${i + 1}: couldn't find "${marks.join(" / ")}" on ${shot.go}`);
        }
        await new Promise((r) => setTimeout(r, 250));
        const png = Buffer.from(await page.screenshot({ type: "png" }));
        const file = `${guide.id}-${i + 1}.webp`;
        await sharp(png).resize({ width: device === "phone" ? 600 : 1366, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(OUT, file));
        written.add(file);
        manifest[guide.id].push({ step: i + 1, src: `/help/${file}`, device });
        console.log(`  ✓ ${file}`);
      } catch (e) {
        fails++;
        console.warn(`  ! ${guide.id} step ${i + 1}: ${(e as Error).message}`);
      }
    }
  }
  await browser.close();

  if (!only.length) {
    for (const f of readdirSync(OUT)) if (f.endsWith(".webp") && !written.has(f)) unlinkSync(path.join(OUT, f));
  } else {
    // Keep entries for guides we didn't re-capture.
    const prev = await import(MANIFEST).then((m) => m.WALKTHROUGHS as typeof manifest).catch(() => ({}));
    for (const [k, v] of Object.entries(prev)) if (!(k in manifest)) manifest[k] = v;
  }
  writeFileSync(
    MANIFEST,
    `/** Generated by scripts/tutorials/capture.ts — do not edit by hand. */\nexport type WalkthroughShot = { step: number; src: string; device: "desktop" | "phone" };\n\nexport const WALKTHROUGHS: Record<string, WalkthroughShot[]> = ${JSON.stringify(manifest, null, 2)};\n`,
  );
  console.log(`\n${written.size} screenshots, ${fails} warning(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
