import { NextResponse } from "next/server";

/** The company website (any domain) may read the product feed. Read-only, no cookies. */
export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function publicBase(req: Request) {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
}
export function options() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
