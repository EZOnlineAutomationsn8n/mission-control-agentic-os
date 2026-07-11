import { NextResponse } from "next/server";
import { sendFccControlledPrompt, FCC_ROUTE_COUNT } from "@/lib/connectors/live/fcc-actions";

// Controlled-action endpoint for FCC / OwlAlpha only. Only ever invoked by
// an explicit POST from the operator's UI form submission — nothing polls
// or schedules calls to this route. No shell execution, no filesystem
// writes, no service mutation happen here or in the reader it calls.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const timestamp = new Date().toISOString();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        status: "failed",
        text: null,
        error: "invalid JSON body",
        transportModelAlias: "open_router/openrouter/owl-alpha",
        actualRuntimeModel: null,
        attempts: [],
        routeCount: FCC_ROUTE_COUNT,
        skippedRouteNumbers: [],
        timestamp,
      },
      { status: 400 }
    );
  }

  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  const result = await sendFccControlledPrompt(prompt);
  return NextResponse.json(result);
}
