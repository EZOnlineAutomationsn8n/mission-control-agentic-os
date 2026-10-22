import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { importOmiToObsidianIntake } from "@/lib/connectors/live/omi-bridge";
import { appendBrainEvent, upsertBrainSource } from "@/lib/shared-brain";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const receipt = await importOmiToObsidianIntake();
    let brainRegistration: { status: "registered" | "unavailable"; error?: string } = { status: "registered" };
    try {
      for (const sourcePath of [...receipt.filesWritten, receipt.receiptPath]) {
        const [content, metadata] = await Promise.all([fs.readFile(sourcePath), fs.stat(sourcePath)]);
        await upsertBrainSource({
          id: `omi-${randomUUID()}`,
          sourcePath,
          artifactKind: sourcePath.endsWith(".json") ? "omi-intake-receipt" : "omi-memory-candidate",
          scope: "omi-obsidian-intake",
          classification: "candidate",
          sha256: createHash("sha256").update(content).digest("hex"),
          sizeBytes: metadata.size,
          sourceModifiedAt: metadata.mtime.toISOString(),
          duplicateOf: null,
          notes: "Read-only OMI import into sandbox intake; not promoted to the canonical Obsidian vault.",
        });
      }
      await appendBrainEvent({
        actor: "omi-bridge",
        eventType: "candidate-intake",
        scope: "omi-obsidian-intake",
        summary: `OMI candidate intake completed: ${receipt.counts.memories} memories and ${receipt.counts.conversations} conversations. No canonical vault mutation occurred.`,
        evidence: [receipt.receiptPath],
      });
    } catch (error) {
      brainRegistration = {
        status: "unavailable",
        error: error instanceof Error ? error.message : "Shared Brain registration failed",
      };
    }
    return NextResponse.json({ receipt, brainRegistration }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OMI intake failed" },
      { status: 503 }
    );
  }
}
