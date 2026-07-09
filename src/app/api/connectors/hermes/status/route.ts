import { NextResponse } from "next/server";
import { readHermesLiveStatus } from "@/lib/connectors/live/hermes-status";

// Read-only status endpoint. Never accepts a body, never triggers any
// action against the real Hermes gateway — it only reads local state files
// and checks /proc for pid liveness. Not cached (route handler GET is
// uncached by default in this Next.js version, but the flag is kept
// explicit since this must always reflect current-moment state).
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await readHermesLiveStatus();
  return NextResponse.json(status);
}
