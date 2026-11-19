import { PageHeader, Stat } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { myAgentScore } from "@/server/modules/analytics/service";
import { formatINR } from "@/server/modules/billing/calc";
import { getSetting } from "@/server/modules/settings/service";

export const metadata = { title: "My score" };

const TIER: Record<string, [string, string]> = {
  Gold: ["bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950", "Excellent work — keep it up!"],
  Silver: ["bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900", "Good — a few more on-time completions to reach Gold."],
  Bronze: ["bg-gradient-to-br from-orange-200 to-orange-400 text-orange-950", "Fair — fewer cancellations and faster completion will lift your score."],
  "Needs attention": ["bg-gradient-to-br from-red-200 to-red-400 text-red-950", "Talk to the office about what's holding your works back."],
  New: ["bg-gradient-to-br from-sky-200 to-sky-400 text-sky-950", "Not enough works yet to calculate a score."],
};

export default async function AgentScorePage() {
  const actor = await requirePortal("AGENT");
  const [s, cfg] = await Promise.all([myAgentScore(actor), getSetting("agentScore")]);
  const tier = s?.tier ?? "New";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <>
      <PageHeader title="My score" subtitle="Based on your works in the last 90 days." />
      <div className={`mb-5 rounded-2xl p-6 shadow-sm ${TIER[tier][0]}`}>
        <p className="text-sm font-medium uppercase tracking-wide opacity-80">Status</p>
        <p className="text-3xl font-bold">{tier}</p>
        <p className="mt-1 text-5xl font-black">{s?.score ?? "—"}<span className="text-xl font-semibold opacity-70"> / 100</span></p>
        <p className="mt-3 text-sm">{TIER[tier][1]}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Works" value={s?.works ?? 0} />
        <Stat label="Completed" value={s ? `${s.completed} (${pct(s.completionRate)})` : 0} tone="emerald" />
        <Stat label="On time" value={s && s.completed ? pct(s.onTimeRate) : "—"} tone="blue" />
        <Stat label="Cancelled" value={s?.cancelled ?? 0} tone={s?.cancelled ? "orange" : "slate"} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="Work value (excl. GST)" value={formatINR(s?.revenue ?? 0)} />
        <Stat label="Commission earned" value={formatINR(s?.commission ?? 0)} tone="emerald" />
      </div>
      <p className="mt-5 text-xs text-slate-500">
        How it&apos;s calculated: completion {cfg.completionWeight}% · on-time (approved within {cfg.graceDays} day{cfg.graceDays === 1 ? "" : "s"} of the work date) {cfg.onTimeWeight}% · few cancellations {cfg.cancellationWeight}% · work value vs. top agent {cfg.revenueWeight}%. At least {cfg.minWorks} works needed.
      </p>
    </>
  );
}
