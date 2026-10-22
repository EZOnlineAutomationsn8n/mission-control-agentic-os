import { NextResponse } from "next/server";
import { storeAttachments } from "@/lib/attachments/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const agentId = form.get("agentId");
    const sessionId = form.get("sessionId");
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (typeof agentId !== "string" || typeof sessionId !== "string") {
      return NextResponse.json({ error: "agentId and sessionId are required" }, { status: 400 });
    }
    const attachments = await storeAttachments({ agentId, sessionId, files });
    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "attachment upload failed" }, { status: 400 });
  }
}

