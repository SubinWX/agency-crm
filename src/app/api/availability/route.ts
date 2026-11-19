import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { getAvailability } from "@/server/modules/capacity/service";
import { can } from "@/server/rbac/actor";

export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!can(actor, "calendar.view") && !can(actor, "works.create")) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  try {
    return NextResponse.json({ days: await getAvailability(from, to) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
