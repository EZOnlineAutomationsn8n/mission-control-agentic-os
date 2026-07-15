import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isValidConversationKey } from "@/lib/agent-conversations/store";
import type { AttachmentReference } from "./types";
import { databaseEnabled, databaseQuery, withDatabaseTransaction } from "@/lib/persistence/database";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".txt", ".md", ".json", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".svg", ".zip",
]);

function rootDirectory(): string {
  return process.env.ATTACHMENT_DATA_DIR || path.join(process.cwd(), "data", "attachments");
}

function metadataFile(): string {
  return path.join(rootDirectory(), "attachments.jsonl");
}

function safeName(value: string): string {
  const normalized = path.basename(value).normalize("NFKC").replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return normalized.slice(0, 160) || "attachment";
}

function validateScope(agentId: string, sessionId: string): void {
  if (!isValidConversationKey(agentId) || !isValidConversationKey(sessionId)) {
    throw new Error("invalid attachment scope");
  }
}

export async function storeAttachments(options: {
  agentId: string;
  sessionId: string;
  files: File[];
}): Promise<AttachmentReference[]> {
  validateScope(options.agentId, options.sessionId);
  if (options.files.length < 1 || options.files.length > MAX_FILES) {
    throw new Error(`attach between 1 and ${MAX_FILES} files per upload`);
  }

  const records: AttachmentReference[] = [];
  for (const file of options.files) {
    const name = safeName(file.name);
    const extension = path.extname(name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`unsupported attachment type: ${extension || "unknown"}`);
    if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error(`${name} must be between 1 byte and 25 MB`);

    const id = randomUUID();
    const directory = path.join(rootDirectory(), options.agentId, options.sessionId, id);
    const storagePath = path.join(directory, name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(storagePath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    records.push({
      id,
      agentId: options.agentId,
      sessionId: options.sessionId,
      name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storagePath,
      createdAt: new Date().toISOString(),
    });
  }

  try {
    if (databaseEnabled()) {
      await withDatabaseTransaction(async (client) => {
        for (const record of records) {
          await client.query(
            `INSERT INTO attachment_records (id, agent_id, session_id, payload, created_at)
             VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
            [record.id, record.agentId, record.sessionId, JSON.stringify(record), record.createdAt]
          );
        }
      });
    } else {
      await fs.mkdir(rootDirectory(), { recursive: true });
      await fs.appendFile(metadataFile(), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
    }
  } catch (error) {
    await Promise.all(records.map((record) => fs.rm(path.dirname(record.storagePath), { recursive: true, force: true })));
    throw error;
  }
  return records;
}

async function readMetadata(): Promise<AttachmentReference[]> {
  try {
    const raw = await fs.readFile(metadataFile(), "utf8");
    return raw.split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as AttachmentReference]; } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function resolveAttachments(options: {
  agentId: string;
  sessionId: string;
  ids: unknown;
}): Promise<AttachmentReference[]> {
  validateScope(options.agentId, options.sessionId);
  if (options.ids === undefined) return [];
  if (!Array.isArray(options.ids) || options.ids.length > MAX_FILES || options.ids.some((id) => typeof id !== "string")) {
    throw new Error("attachments must be an array of at most five attachment IDs");
  }
  const requested = new Set(options.ids as string[]);
  const records = databaseEnabled()
    ? (await databaseQuery<{ payload: AttachmentReference }>(
        `SELECT payload
           FROM attachment_records
          WHERE agent_id = $1 AND session_id = $2 AND id = ANY($3::text[])`,
        [options.agentId, options.sessionId, [...requested]]
      )).rows.map((row) => row.payload)
    : (await readMetadata()).filter(
        (record) => requested.has(record.id) && record.agentId === options.agentId && record.sessionId === options.sessionId
      );
  if (records.length !== requested.size) throw new Error("one or more attachments are missing or outside this agent session");
  await Promise.all(records.map((record) => fs.access(record.storagePath)));
  return records;
}

export function promptWithAttachments(prompt: string, attachments: AttachmentReference[]): string {
  if (attachments.length === 0) return prompt;
  const lines = attachments.map((attachment) =>
    `- ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes): ${attachment.storagePath}`
  );
  return `${prompt}\n\nMission Control supplied these operator-approved attachment paths:\n${lines.join("\n")}\nRead only the files needed for this request.`;
}
