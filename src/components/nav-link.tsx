"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STYLES = {
  side: ["block rounded-lg px-3 py-2 text-sm", "bg-blue-50 font-medium text-blue-700", "text-slate-600 hover:bg-slate-100"],
  tab: ["whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", "bg-blue-50 font-medium text-blue-700", "text-slate-600"],
  bottom: ["flex flex-col items-center py-3 text-xs", "font-semibold text-blue-700", "text-slate-500"],
} as const;

export function NavLink({ href, exact, variant, children }: { href: string; exact?: boolean; variant: keyof typeof STYLES; children: React.ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  const [base, on, off] = STYLES[variant];
  return (
    <Link href={href} className={`${base} ${active ? on : off}`} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
