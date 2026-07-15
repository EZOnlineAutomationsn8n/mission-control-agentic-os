import { NextResponse } from "next/server";
import { listBrainSources } from "@/lib/shared-brain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ sources: await listBrainSources() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "source register read failed" }, { status: 503 });
  }
}
