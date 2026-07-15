import { randomUUID } from "node:crypto";
import { databaseEnabled, databaseQuery } from "@/lib/persistence/database";

export type BrainSourceClassification = "canonical" | "candidate" | "legacy" | "archive" | "duplicate";

export interface BrainSource {
  id: string;
  sourcePath: string;
  artifactKind: string;
  scope: string;
  classification: BrainSourceClassification;
  sha256: string;
  sizeBytes: number;
  sourceModifiedAt: string;
  duplicateOf: string | null;
  notes: string;
  scannedAt: string;
}

export interface BrainEvent {
  id: string;
  eventAt: string;
  actor: string;
  eventType: string;
  scope: string;
  summary: string;
  evidence: string[];
}

interface SourceRow {
  id: string; source_path: string; artifact_kind: string; scope: string;
  classification: BrainSourceClassification; sha256: string; size_bytes: string | number;
  source_modified_at: Date | string; duplicate_of: string | null; notes: string; scanned_at: Date | string;
}
interface EventRow {
  id: string; event_at: Date | string; actor: string; event_type: string;
  scope: string; summary: string; evidence: string[];
}

function requireDatabase() {
  if (!databaseEnabled()) throw new Error("Shared Brain persistence requires DATABASE_URL");
}
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

function sourceFromRow(row: SourceRow): BrainSource {
  return {
    id: row.id, sourcePath: row.source_path, artifactKind: row.artifact_kind, scope: row.scope,
    classification: row.classification, sha256: row.sha256, sizeBytes: Number(row.size_bytes),
    sourceModifiedAt: iso(row.source_modified_at), duplicateOf: row.duplicate_of, notes: row.notes,
    scannedAt: iso(row.scanned_at),
  };
}

function eventFromRow(row: EventRow): BrainEvent {
  return {
    id: row.id, eventAt: iso(row.event_at), actor: row.actor, eventType: row.event_type,
    scope: row.scope, summary: row.summary, evidence: row.evidence ?? [],
  };
}

export async function listBrainSources(): Promise<BrainSource[]> {
  requireDatabase();
  const result = await databaseQuery<SourceRow>(
    `SELECT * FROM shared_brain_sources
     ORDER BY scope ASC,
       CASE classification WHEN 'canonical' THEN 0 WHEN 'candidate' THEN 1 WHEN 'legacy' THEN 2 WHEN 'archive' THEN 3 ELSE 4 END,
       source_modified_at DESC`
  );
  return result.rows.map(sourceFromRow);
}

export async function upsertBrainSource(source: Omit<BrainSource, "scannedAt">): Promise<BrainSource> {
  requireDatabase();
  const result = await databaseQuery<SourceRow>(
    `INSERT INTO shared_brain_sources
       (id, source_path, artifact_kind, scope, classification, sha256, size_bytes, source_modified_at, duplicate_of, notes, scanned_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (source_path) DO UPDATE SET
       artifact_kind=EXCLUDED.artifact_kind, scope=EXCLUDED.scope, classification=EXCLUDED.classification,
       sha256=EXCLUDED.sha256, size_bytes=EXCLUDED.size_bytes, source_modified_at=EXCLUDED.source_modified_at,
       duplicate_of=EXCLUDED.duplicate_of, notes=EXCLUDED.notes, scanned_at=NOW()
     RETURNING *`,
    [source.id, source.sourcePath, source.artifactKind, source.scope, source.classification, source.sha256,
      source.sizeBytes, source.sourceModifiedAt, source.duplicateOf, source.notes]
  );
  return sourceFromRow(result.rows[0]);
}

export async function listBrainEvents(limit = 100): Promise<BrainEvent[]> {
  requireDatabase();
  const result = await databaseQuery<EventRow>(
    "SELECT id, event_at, actor, event_type, scope, summary, evidence FROM shared_brain_events ORDER BY sequence DESC LIMIT $1",
    [limit]
  );
  return result.rows.map(eventFromRow);
}

export async function appendBrainEvent(input: Omit<BrainEvent, "id" | "eventAt">): Promise<BrainEvent> {
  requireDatabase();
  const id = `brain-${randomUUID()}`;
  const eventAt = new Date().toISOString();
  const result = await databaseQuery<EventRow>(
    `INSERT INTO shared_brain_events (id, event_at, actor, event_type, scope, summary, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id, event_at, actor, event_type, scope, summary, evidence`,
    [id, eventAt, input.actor, input.eventType, input.scope, input.summary, JSON.stringify(input.evidence)]
  );
  return eventFromRow(result.rows[0]);
}
