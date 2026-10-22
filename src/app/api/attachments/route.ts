import { NextResponse } from "next/server";
import { storeAttachments } from "@/lib/attachments/store";
import { inspectLocalImagePixels } from "@/lib/attachments/local-pixel-observation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const agentId = form.get("agentId");
    const sessionId = form.get("sessionId");
    if (typeof agentId !== "string" || typeof sessionId !== "string") {
      return NextResponse.json({ error: "agentId and sessionId required" }, { status: 400 });
    }
    const files = form.getAll("files");
    if (files.some((file) => !(file instanceof File))) {
      return NextResponse.json({ error: "files must be uploads" }, { status: 400 });
    }
    const attachments = await storeAttachments({ agentId, sessionId, files: files as File[] });
    const localImageObservations = await Promise.all(attachments.map(async (attachment) => {
      if (!/\.(?:png|jpe?g|webp|gif|heic|svg)$/i.test(attachment.name)) return null;
      try {
        const text = await inspectLocalImagePixels(attachment);
        return { id: attachment.id, status: text ? "measured" : "unsupported", text: text ?? "Local pixel inspection not available for this format." };
      } catch {
        return { id: attachment.id, status: "unsupported", text: "Image stored; pixel inspection failed or format is not supported. No model saw this image." };
      }
    }));
    return NextResponse.json({ attachments, localImageObservations: localImageObservations.filter(Boolean) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "attachment upload failed" }, { status: 400 });
  }
}
