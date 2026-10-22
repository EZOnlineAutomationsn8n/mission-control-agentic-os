import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ preview: process.env.MC_PREVIEW === "1" }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
