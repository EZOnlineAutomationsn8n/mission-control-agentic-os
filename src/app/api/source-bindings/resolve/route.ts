import { NextResponse } from "next/server";
import { resolveSourceBinding } from "@/lib/source-binding/resolver";
import type { SourceBindingCandidate, SourceBindingRequest } from "@/lib/source-binding/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "request object required" }, { status: 400 });
  const candidateBody = body as { request?: SourceBindingRequest; candidates?: SourceBindingCandidate[] };
  if (!candidateBody.request || !Array.isArray(candidateBody.candidates)) {
    return NextResponse.json({ error: "request and candidates are required" }, { status: 400 });
  }
  const result = resolveSourceBinding(candidateBody.request, candidateBody.candidates);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
