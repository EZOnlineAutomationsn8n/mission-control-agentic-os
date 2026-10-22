import { NextResponse } from "next/server";
import { readVaultNote } from "@/lib/brain/vault-graph";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const note = await readVaultNote(id);
  if (!note) return NextResponse.json({ error: "note not found in the read-only vault projection" }, { status: 404 });
  return NextResponse.json(note);
}
