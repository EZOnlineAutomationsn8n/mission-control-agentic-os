import { NextResponse } from "next/server";
import { readPaperclipLiveStatus } from "@/lib/connectors/live/paperclip-status";

// Read-only status endpoint. Only performs a local GET against Paperclip's
// own /api/health endpoint (short timeout) and a /proc cmdline scan — never
// sends a prompt/command, never reads user/document content. Not cached:
// must always reflect the current-moment check.
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readPaperclipLiveStatus();
  return NextResponse.json(status);
}
