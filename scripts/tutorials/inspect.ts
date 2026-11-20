/** Lists visible headings / buttons / labels on pages — used to write shots.ts. */
import { BASE, launch, signedIn, type Role } from "./browser";

const [role, device, ...paths] = process.argv.slice(2) as [Role, "desktop" | "phone", ...string[]];
(async () => {
  const browser = await launch();
  const page = await signedIn(browser, role, device);
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil: "networkidle2", timeout: 60000 });
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll("main h1, main h2, main h3, main legend, main label, main button, main a, main th, [role=dialog] *")]
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => `${e.tagName.toLowerCase()}:${(e as HTMLElement).innerText.trim().replace(/\s+/g, " ").slice(0, 50)}`)
        .filter((t) => !t.endsWith(":")),
    );
    console.log(`\n== ${p}\n${[...new Set(texts)].join(" | ")}`);
  }
  await browser.close();
})();
