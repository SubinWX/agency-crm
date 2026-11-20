import Link from "next/link";
import { GUIDES } from "@/server/modules/help/guides";
import { can, type Actor } from "@/server/rbac/actor";
import { WALKTHROUGHS } from "@/server/modules/help/walkthroughs.generated";
import { TourButton } from "./tour-button";
import { Walkthrough } from "./walkthrough";
import { PageHeader } from "./ui";

/** Help & tutorials: role-specific step-by-step guides + the guided tour. */
export function HelpPage({ actor, q }: { actor: Actor; q?: string }) {
  const term = q?.trim().toLowerCase() ?? "";
  const guides = GUIDES.filter((g) => g.portal === actor.portal && (!g.perm || can(actor, g.perm))).filter(
    (g) => !term || [g.title, g.summary, ...g.steps].join(" ").toLowerCase().includes(term),
  );
  const topics = [...new Set(guides.map((g) => g.topic))];
  return (
    <>
      <PageHeader title="Help & tutorials" subtitle="Short step-by-step guides for the things you do every day." actions={<TourButton />} />
      <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-[#0f1b3d] to-indigo-800 p-6 text-white">
        <p className="text-lg font-semibold">New here? Take the 1-minute guided tour.</p>
        <p className="mt-1 text-sm text-indigo-100">It highlights each part of the screen and explains what it is for.</p>
        <div className="mt-4"><TourButton light /></div>
      </div>
      <form className="mb-5 flex max-w-xl gap-2">
        <input name="q" defaultValue={q} placeholder="Search the guides, e.g. invoice, photos, holiday" className="input" />
        <button className="btn-secondary">Search</button>
      </form>
      {guides.length === 0 && <p className="text-sm text-slate-500">No guides match “{q}”.</p>}
      <div className="space-y-6">
        {topics.map((t) => (
          <section key={t}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t}</h2>
            <div className="space-y-2">
              {guides.filter((g) => g.topic === t).map((g) => (
                <details key={g.id} id={g.id} className="card group open:shadow-md" open={guides.length <= 3}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                    <span className="flex min-w-0 items-center gap-4">
                      {WALKTHROUGHS[g.id]?.[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={WALKTHROUGHS[g.id][0].src} alt="" loading="lazy" className="hidden h-14 w-24 shrink-0 rounded-md border border-slate-200 object-cover object-top sm:block" />
                      )}
                      <span className="min-w-0">
                        <span className="font-semibold text-slate-900">{g.title}</span>
                        <span className="block text-sm text-slate-500">{g.summary}</span>
                        {(WALKTHROUGHS[g.id]?.length ?? 0) > 0 && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">▶ Walk-through · {WALKTHROUGHS[g.id].length} pictures</span>}
                      </span>
                    </span>
                    <span className="text-slate-400 transition group-open:rotate-180">▾</span>
                  </summary>
                  <div className="border-t border-slate-100 px-5 py-4">
                    <Walkthrough title={g.title} steps={g.steps} shots={WALKTHROUGHS[g.id] ?? []} />
                    {g.tips && (
                      <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                        {g.tips.map((tip, i) => <li key={i}>💡 {tip}</li>)}
                      </ul>
                    )}
                    {g.links && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {g.links.map((l) => <Link key={l.href} href={l.href} className="btn-secondary px-3 py-1.5 text-xs">{l.label} →</Link>)}
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
