import { NextResponse } from "next/server";
import { readFccLiveStatus } from "@/lib/connectors/live/fcc-status";

// Read-only status endpoint. Only performs a local GET against FCC's own
// /health endpoint (short timeout) and a file-presence check — never sends
// a prompt/command to FCC. Not cached: this must always reflect the
// current-moment health check.
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readFccLiveStatus();
  return NextResponse.json(status);
}
