import { NextResponse } from "next/server";
import { triggerN8nWorkflow } from "@/lib/connectors/live/n8n-actions";

// Controlled workflowTrigger action for n8n. Accepts no user input (a fixed
// test/demo trigger, not a prompt channel). Only ever invoked by explicit
// UI submission. Returns "blocked" until a safe webhook path is configured
// server-side — see n8n-actions.ts.
export const dynamic = "force-dynamic";

export async function POST() {
  const result = await triggerN8nWorkflow();
  return NextResponse.json(result);
}
