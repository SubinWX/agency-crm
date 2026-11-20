import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDES } from "@/server/modules/help/guides";
import { ALL_PERMISSION_KEYS } from "@/server/rbac/permissions";
import { can } from "@/server/rbac/actor";
import { TOURS } from "@/components/tour-steps";
import { actor } from "./helpers";

/** Map a link like /admin/works/new to its page file (ignores query strings). */
function pageExists(href: string) {
  const clean = href.split("?")[0].replace(/^\//, "");
  const candidates = [clean, clean.replace(/^(agent|worker|portal)(\/|$)/, "$1/(app)$2")];
  return candidates.some((c) => existsSync(path.join("src/app", c, "page.tsx")));
}

describe("help & tour", () => {
  it("only references real permissions and real pages", () => {
    for (const g of GUIDES) {
      if (g.perm) expect(ALL_PERMISSION_KEYS).toContain(g.perm);
      for (const l of g.links ?? []) expect(pageExists(l.href), `${g.id}: ${l.href}`).toBe(true);
    }
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
  });

  it("shows office guides by permission", async () => {
    const staff = await actor("staff@crm.test");
    const visible = GUIDES.filter((g) => g.portal === "ADMIN" && (!g.perm || can(staff, g.perm))).map((g) => g.id);
    expect(visible).toContain("add-work");
    expect(visible).not.toContain("invoice");
    expect(visible).not.toContain("notify");
  });

  it("has a tour for every portal", () => {
    for (const p of ["ADMIN", "AGENT", "WORKER", "CUSTOMER"] as const) expect(TOURS[p].length).toBeGreaterThan(3);
  });
});
