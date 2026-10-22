import { NextResponse } from "next/server";
import { runAcfControl, startTeamStep, stepRunning, stepStatus } from "@/lib/acf/control-adapter";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

/** Status of the background step of one run: { running, startedAt, finishedAt, last }. */
export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId") ?? "";
  return NextResponse.json({ runId, step: stepStatus(runId) }, { headers });
}

/**
 * { verb: "team-open", args: { objective, success_criterion, roles?, pins? } }
 * | { verb: "team-step" | "team-reconcile", args: { run_id } }
 * | { verb: "team-intervene", args: { run_id, reason } }
 * | { verb: "team-say", args: { run_id, to, text, kind?, reply? } }
 * | { verb: "team-resume", args: { run_id, abandon_owed_replies? } }
 * | { verb: "team-rebind", args: { run_id, role, session_ref, agent_id? } }
 * | { verb: "team-continue", args: { run_id (= predecessor), instruction } }
 * The operator claim (`by` / `created_by`) and every binding are filled on the server, never by the browser.
 */
export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, verb: null, code: "ARGUMENTS", detail: "JSON body required" }, { status: 400, headers });
  }
  const data = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const args = data.args && typeof data.args === "object" ? (data.args as Record<string, unknown>) : {};
  if (data.verb !== "team-step" && data.verb !== "team-open" && stepRunning(args.run_id)) {
    return NextResponse.json({ ok: false, verb: data.verb ?? null, code: "STEP_ALREADY_RUNNING",
                               detail: "a participant turn of this run is still running" }, { status: 409, headers });
  }
  const result = data.verb === "team-step" ? startTeamStep(args.run_id) : await runAcfControl(data.verb, data.args);
  const status = result.ok ? 200 : result.code === "ARGUMENTS" ? 400 : result.code === "ACF_UNAVAILABLE" ? 503 : 409;
  return NextResponse.json(result, { status, headers });
}
