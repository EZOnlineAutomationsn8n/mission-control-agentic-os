import { NextResponse } from "next/server";
import { readObsidianLiveStatus } from "@/lib/connectors/live/obsidian-status";

// Read-only status endpoint. Only inspects filesystem existence/metadata
// (vault path, .obsidian marker, a note count) and a /proc cmdline scan for
// the read-only MCP bridge — never reads note content, never calls the MCP
// server, never touches secrets. Not cached: must always reflect the
// current-moment check.
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readObsidianLiveStatus();
  return NextResponse.json(status);
}
