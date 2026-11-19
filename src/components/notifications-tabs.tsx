import Link from "next/link";

export function NotificationsTabs({ active }: { active: "providers" | "templates" | "log" }) {
  const tabs = [
    ["providers", "/admin/notifications", "Providers"],
    ["templates", "/admin/notifications/templates", "Templates"],
    ["log", "/admin/notifications/log", "Delivery log"],
  ] as const;
  return (
    <nav className="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
      {tabs.map(([k, href, label]) => (
        <Link key={k} href={href} className={`rounded-lg px-4 py-2 ${k === active ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>{label}</Link>
      ))}
    </nav>
  );
}
