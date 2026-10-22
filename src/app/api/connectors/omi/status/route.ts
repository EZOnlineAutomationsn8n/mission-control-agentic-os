import { NextResponse } from "next/server";
import { readOmiBridgeStatus } from "@/lib/connectors/live/omi-bridge";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readOmiBridgeStatus());
}
