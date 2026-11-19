import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { AppError } from "@/server/lib/errors";
import { canRunReport, getReport, totalsOf, type Filters } from "@/server/modules/reports/definitions";
import { toCsv, toPdf } from "@/server/modules/reports/export";
import { describeFilters } from "@/server/modules/reports/filters";
import { getSetting } from "@/server/modules/settings/service";

export const runtime = "nodejs";

/** Export a report as CSV (opens in Excel) or PDF. Same permissions and branch scope as the screen. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const actor = await getActor();
  if (!actor || actor.portal !== "ADMIN") return new NextResponse("Unauthorized", { status: 401 });
  const { key } = await params;
  const def = getReport(key);
  if (!def || !canRunReport(actor, def)) return new NextResponse("Not found", { status: 404 });
  const sp = req.nextUrl.searchParams;
  const f: Filters = Object.fromEntries(["from", "to", "branchId", "agentId", "workerId", "customerId", "workStatus", "paymentStatus", "itemId", "categoryId"].map((k) => [k, sp.get(k) || undefined]));
  try {
    const rows = await def.run(actor, f);
    const totals = totalsOf(def, rows);
    const format = sp.get("format") === "pdf" ? "pdf" : "csv";
    await prisma.auditLog.create({ data: { userId: actor.id, action: `report.export_${format}`, entityType: "Report", entityId: key, after: { filters: JSON.parse(JSON.stringify(f)), rows: rows.length } } });
    const name = `${key}-${new Date().toISOString().slice(0, 10)}`;
    if (format === "pdf") {
      const company = await getSetting("company");
      const pdf = await toPdf(def, rows, totals, { company: company.name, filters: await describeFilters(def, f), generatedBy: actor.name });
      return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store" } });
    }
    return new NextResponse(toCsv(def, rows, totals), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: 400 });
    throw e;
  }
}
