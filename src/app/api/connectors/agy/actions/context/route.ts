import { NextResponse } from "next/server";
import { fetchAgyProjectContext } from "@/lib/connectors/live/agy-actions";

// Safe, explicit, read-only projectContext action for AGY: GETs AGY's own
// /status registry snapshot. No job/task is dispatched. Only invoked by
// explicit UI submission.
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(await fetchAgyProjectContext());
}
