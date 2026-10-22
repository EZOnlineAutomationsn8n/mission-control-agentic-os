import { NextResponse } from "next/server";
import { listCockpitSessions } from "@/lib/cockpit/session-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ sessions: await listCockpitSessions() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "cockpit session discovery failed" },
      { status: 500 }
    );
  }
}
