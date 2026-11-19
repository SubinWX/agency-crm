import Link from "next/link";
import type { Portal } from "@prisma/client";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { getActor, PORTAL_HOME } from "@/server/auth/session";
import { getSetting } from "@/server/modules/settings/service";
import { LoginForm } from "./login-form";

const PORTALS: { portal: Portal; href: string; label: string; title: string; hint: string }[] = [
  { portal: "ADMIN", href: "/login", label: "Office", title: "Welcome back", hint: "Super Admin, Admin and Staff sign in here." },
  { portal: "AGENT", href: "/agent/login", label: "Agent", title: "Agent sign in", hint: "Add new works and follow their progress." },
  { portal: "WORKER", href: "/worker/login", label: "Worker", title: "Worker sign in", hint: "See your jobs and submit completion photos." },
  { portal: "CUSTOMER", href: "/portal/login", label: "Customer", title: "Customer sign in", hint: "Track your works, invoices and payments." },
];

/** Split-screen sign in: brand image on the left (editable by Super Admin), form on the right. */
export async function LoginPage({ portal }: { portal: Portal }) {
  const actor = await getActor();
  if (actor) redirect(PORTAL_HOME[actor.portal]);
  const [company, brand] = await Promise.all([getSetting("company"), getSetting("loginPage")]);
  const current = PORTALS.find((p) => p.portal === portal) ?? PORTALS[0];
  const initials = company.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-2">
      {/* Brand panel */}
      <section className="relative isolate flex min-h-56 flex-col justify-between overflow-hidden bg-slate-900 p-6 text-white sm:p-10 lg:min-h-screen">
        {brand.imageKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/branding/login-image" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        ) : (
          <DefaultArt />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-slate-950/90 via-slate-900/40 to-slate-900/20" />

        <div className="flex items-center gap-3">
          {company.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/branding/logo" alt="" className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-sm font-bold ring-1 ring-white/30 backdrop-blur">{initials}</span>
          )}
          <span className="text-lg font-semibold tracking-tight">{company.name}</span>
        </div>

        <div className="hidden max-w-lg lg:block">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">{brand.headline}</h2>
          {brand.subtext && <p className="mt-4 text-lg text-white/80">{brand.subtext}</p>}
          <div className="mt-10 flex gap-8 text-sm text-white/70">
            <span>Works &amp; scheduling</span>
            <span>Workers &amp; approvals</span>
            <span>Multi-branch</span>
          </div>
        </div>
        <p className="mt-6 text-base font-medium text-white/90 lg:hidden">{brand.headline}</p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <nav className="mb-8 grid grid-cols-4 rounded-xl bg-slate-100 p-1 text-sm" aria-label="Choose portal">
            {PORTALS.map((p) => (
              <Link
                key={p.portal}
                href={p.href}
                aria-current={p.portal === current.portal ? "page" : undefined}
                className={`rounded-lg px-1 py-2 text-center font-medium transition ${p.portal === current.portal ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{current.title}</h1>
          <p className="mt-2 text-sm text-slate-500">{current.hint}</p>
          <div className="mt-8">
            <LoginForm action={loginAction.bind(null, current.portal)} />
          </div>
          <p className="mt-10 text-center text-xs text-slate-400">
            Trouble signing in? Contact your administrator.
          </p>
        </div>
      </section>
    </main>
  );
}

/** Built-in artwork used until Super Admin uploads a login image. */
function DefaultArt() {
  return (
    <div className="absolute inset-0 -z-20 bg-gradient-to-br from-blue-600 via-indigo-700 to-slate-900">
      <svg className="absolute inset-0 h-full w-full opacity-25" aria-hidden="true">
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="white" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="absolute -right-24 top-16 h-96 w-96 rounded-full bg-sky-400/30 blur-3xl" />
      <div className="absolute -left-20 bottom-10 h-80 w-80 rounded-full bg-violet-500/30 blur-3xl" />
      {/* Floating "calendar" card */}
      <div className="absolute right-[12%] top-[22%] hidden w-64 rotate-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur-md lg:block">
        <p className="text-xs font-medium text-white/70">Today&apos;s capacity</p>
        <p className="mt-1 text-3xl font-semibold">7 / 10</p>
        <div className="mt-3 h-2 rounded-full bg-white/20"><div className="h-2 w-[70%] rounded-full bg-emerald-300" /></div>
        <div className="mt-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} className={`h-5 rounded ${i % 5 === 2 ? "bg-rose-300/70" : i % 3 === 0 ? "bg-amber-200/70" : "bg-emerald-200/60"}`} />
          ))}
        </div>
      </div>
      <div className="absolute right-[30%] top-[48%] hidden w-56 -rotate-2 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur-md lg:block">
        <p className="text-xs font-medium text-white/70">WRK-000128</p>
        <p className="mt-1 text-sm font-semibold">Completion approved</p>
        <p className="mt-2 inline-block rounded-full bg-emerald-300/30 px-2 py-0.5 text-[11px] text-emerald-100">Approved</p>
      </div>
    </div>
  );
}
