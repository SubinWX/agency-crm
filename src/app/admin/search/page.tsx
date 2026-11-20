import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePortal } from "@/server/auth/session";
import { globalSearch } from "@/server/modules/search/service";
import { STATUS_LABELS } from "@/server/modules/works/access";

export const metadata = { title: "Search" };

function Section({ title, children, count }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="card">
      <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold">{title} <span className="text-slate-400">({count})</span></h2>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  );
}
const Row = ({ href, main, sub }: { href: string; main: string; sub?: string | null }) => (
  <li><Link href={href} className="block px-5 py-2.5 text-sm hover:bg-slate-50"><span className="font-medium text-slate-900">{main}</span>{sub && <span className="ml-2 text-slate-500">{sub}</span>}</Link></li>
);

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePortal("ADMIN");
  const { q = "" } = await searchParams;
  const r = await globalSearch(actor, q);
  const total = r ? r.works.length + r.customers.length + r.invoices.length + r.payments.length + r.items.length + r.people.length + r.branches.length : 0;
  return (
    <>
      <PageHeader title="Search" subtitle={r ? `${total} result${total === 1 ? "" : "s"} for “${r.q}”` : "Search customers, phone numbers, works, invoices, payments, products, staff and branches."} />
      <form className="mb-5 flex max-w-xl gap-2">
        <input name="q" defaultValue={q} autoFocus className="input" placeholder="Name, phone, WRK-…, INV-…, UTR…" />
        <button className="btn-primary">Search</button>
      </form>
      {!r ? null : total === 0 ? (
        <EmptyState title="Nothing found." hint="Try a shorter word, a phone number or a reference like WRK-000001." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Works" count={r.works.length}>{r.works.map((w) => <Row key={w.id} href={`/admin/works/${w.id}`} main={w.reference} sub={`${w.customer.name} · ${STATUS_LABELS[w.status]}`} />)}</Section>
          <Section title="Customers" count={r.customers.length}>{r.customers.map((c) => <Row key={c.id} href={`/admin/customers/${c.id}`} main={c.name} sub={c.phone} />)}</Section>
          <Section title="Invoices" count={r.invoices.length}>{r.invoices.map((i) => <Row key={i.id} href={`/admin/invoices/${i.id}`} main={i.number} sub={i.customer.name} />)}</Section>
          <Section title="Payments" count={r.payments.length}>{r.payments.map((p) => <Row key={p.id} href={`/admin/invoices/${p.invoiceId}`} main={p.number} sub={`${p.invoice.number}${p.reference ? ` · ref ${p.reference}` : ""}`} />)}</Section>
          <Section title="Products & materials" count={r.items.length}>{r.items.map((i) => <Row key={i.id} href={`/admin/inventory/items/${i.id}`} main={i.name} sub={i.code} />)}</Section>
          <Section title="Staff, agents & workers" count={r.people.length}>{r.people.map((u) => <Row key={u.id} href={`/admin/users/${u.id}`} main={u.name} sub={`${u.role.name} · ${u.email}`} />)}</Section>
          <Section title="Branches" count={r.branches.length}>{r.branches.map((b) => <Row key={b.id} href={`/admin/branches/${b.id}`} main={b.name} sub={b.code} />)}</Section>
        </div>
      )}
    </>
  );
}
