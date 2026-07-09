import { NextResponse } from "next/server";
import { readBrowserAgentsLiveStatus } from "@/lib/connectors/live/browser-agents-status";

// Read-only status endpoint. Only performs a local GET against the standard
// Chrome DevTools discovery endpoint (`/json/version`, short timeout) — never
// opens a CDP WebSocket, never issues a CDP command, never reads page/tab
// content. Not cached: must always reflect the current-moment check.
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readBrowserAgentsLiveStatus();
  return NextResponse.json(status);
}
