import { NextResponse } from "next/server";
import { readOpenClawLiveStatus } from "@/lib/connectors/live/openclaw-status";

// Read-only status endpoint. Only performs a local GET against OpenClaw's
// own /health endpoint (short timeout) and a /proc cmdline scan — never
// sends a prompt/command, never opens a session, never touches the
// heartbeat loop. Not cached: must always reflect the current-moment check.
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readOpenClawLiveStatus();
  return NextResponse.json(status);
}
