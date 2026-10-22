import { NextResponse } from "next/server";
import { readRuntimeTruth } from "@/lib/cockpit/runtime-truth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ runtimes: await readRuntimeTruth() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "runtime truth unavailable" },
      { status: 500 }
    );
  }
}
