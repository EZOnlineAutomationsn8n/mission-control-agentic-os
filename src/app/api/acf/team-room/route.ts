import { NextResponse } from "next/server";
import { readAcfTeamRoomSnapshot } from "@/lib/acf/read-adapter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId");
  const snapshot = await readAcfTeamRoomSnapshot({ runId });
  const status = snapshot.availability === "malformed" ? 502 : snapshot.availability === "unavailable" ? 503 : 200;
  return NextResponse.json(snapshot, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}
