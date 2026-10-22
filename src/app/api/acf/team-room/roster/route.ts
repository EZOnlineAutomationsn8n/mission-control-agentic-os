import { NextRequest, NextResponse } from "next/server";
import { readAcfTeamRoster } from "@/lib/acf/control-adapter";

export const dynamic = "force-dynamic";

/** ACF §13: live roster is a read, never a session create or model turn. */
export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.getAll("runId");
  if (ids.length > 1) return NextResponse.json({ error: "ARGUMENTS", detail: "Only one runId permitted" }, { status: 400 });
  const runId = ids[0] || undefined;
  const result = await readAcfTeamRoster(runId);
  if (!result.ok) return NextResponse.json({ error: result.code, detail: result.detail }, { status: result.code === "ARGUMENTS" ? 400 : 503 });
  return NextResponse.json(result.answer, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
