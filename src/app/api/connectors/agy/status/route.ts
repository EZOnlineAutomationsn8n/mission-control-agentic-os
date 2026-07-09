import { NextResponse } from "next/server";
import { readAgyLiveStatus } from "@/lib/connectors/live/agy-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readAgyLiveStatus());
}
