import { NextResponse } from "next/server";
import { buildVaultGraph } from "@/lib/brain/vault-graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const graph = await buildVaultGraph(force);
  if (!graph) return NextResponse.json({ error: "No Obsidian vault projection is mounted for Mission Control." }, { status: 503 });
  return NextResponse.json(graph);
}
