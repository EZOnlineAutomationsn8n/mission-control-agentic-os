import { NextResponse } from "next/server";
import { readN8nLiveStatus } from "@/lib/connectors/live/n8n-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readN8nLiveStatus());
}
