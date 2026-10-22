import { NextResponse } from "next/server";
import { teamSessions } from "@/lib/acf/control-adapter";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

/**
 * GET /api/acf/team-room/sessions?roles=builder:openclaw,reviewer:claude-code[&pin.builder=<sessionId>][&excludeRun=<run>]
 * ACF's team-sessions over Mission Control's own session index (handoff R4). A read: no session is started, stopped
 * or created (R7). Answers { ok, enabled, roles, answer } with ACF's answer as it is.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let roles: Record<string, string> | undefined;
  const rolesParam = params.get("roles");
  if (rolesParam) {
    roles = {};
    for (const pair of rolesParam.split(",")) {
      const [role, agent] = pair.split(":");
      if (!role || !agent) return NextResponse.json({ ok: false, code: "ARGUMENTS", detail: "roles=role:agent,..." }, { status: 400, headers });
      roles[role] = agent;
    }
  }
  const pins: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key.startsWith("pin.") && value) pins[key.slice(4)] = value;
  }
  const result = await teamSessions({ roles, pins, excludeRun: params.get("excludeRun") ?? undefined });
  if (!result.ok) {
    const status = result.code === "ARGUMENTS" ? 400 : result.code === "ACF_UNAVAILABLE" ? 503 : 409;
    return NextResponse.json(result, { status, headers });
  }
  return NextResponse.json({ ok: true, enabled: result.enabled, roles: result.roles, answer: result.answer }, { headers });
}
