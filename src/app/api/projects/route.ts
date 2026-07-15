import { NextResponse } from "next/server";
import { createOperatorProject, listOperatorProjects } from "@/lib/operator-work";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ projects: await listOperatorProjects() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "project read failed" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    const project = await createOperatorProject({
      name,
      summary: typeof body.summary === "string" ? body.summary.trim() : "",
      workspacePath: typeof body.workspacePath === "string" ? body.workspacePath.trim() : null,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "project create failed" }, { status: 503 });
  }
}
