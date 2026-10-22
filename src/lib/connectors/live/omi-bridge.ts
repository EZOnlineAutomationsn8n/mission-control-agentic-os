import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
  type AuthProvider,
  type CallToolResult,
} from "@modelcontextprotocol/client";

const DEFAULT_MCP_URL = "https://api.omi.me/v1/mcp/sse";
const DEFAULT_KEY_FILE = "/workspace/runtime-data/secrets/omi-mcp-key";
const DEFAULT_INTAKE_DIR = "/workspace/runtime-data/omi-obsidian-intake";
const DETAIL_MAX_SEGMENTS = 120;
const DETAIL_MAX_CHARS = 24_000;

type OmiCollectionName = "memories" | "conversations";
type OmiRecord = Record<string, unknown>;

export interface OmiBridgeStatus {
  systemId: "omi";
  status: "connected" | "blocked" | "rate_limited" | "error";
  mode: "official-mcp-streamable-http-readonly";
  endpoint: string;
  authentication: "authorized" | "configured_unverified" | "missing" | "rejected";
  availableTools: string[];
  counts: Record<OmiCollectionName, number | null>;
  intakeDirectory: string;
  canonicalVaultMutation: false;
  lastCheckedAt: string;
  errors: string[];
}

export interface OmiIntakeReceipt {
  receiptVersion: 3;
  createdAt: string;
  source: "omi-official-mcp";
  classification: "candidate";
  canonicalVaultMutation: false;
  counts: Record<OmiCollectionName, number>;
  conversationDetails: number;
  contentBearingConversationDetails: number;
  filesWritten: string[];
  receiptPath: string;
}

function mcpUrl(): string {
  return process.env.OMI_MCP_URL?.trim() || DEFAULT_MCP_URL;
}

function keyFile(): string {
  return process.env.OMI_MCP_KEY_FILE || DEFAULT_KEY_FILE;
}

function intakeDirectory(): string {
  return process.env.OMI_OBSIDIAN_INTAKE_DIR || DEFAULT_INTAKE_DIR;
}

async function readApiKey(): Promise<string> {
  const fromEnvironment = process.env.OMI_MCP_KEY?.trim();
  const key = fromEnvironment || (await fs.readFile(/* turbopackIgnore: true */ keyFile(), "utf8")).trim();
  if (!key.startsWith("omi_mcp_")) throw new Error("OMI MCP key is missing or invalid");
  return key;
}

async function withOmiClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
  const key = await readApiKey();
  const authProvider: AuthProvider = { token: async () => key };
  const client = new Client({ name: "mission-control-omi-bridge", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl()), { authProvider });
  try {
    await client.connect(transport);
    return await operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function payloadFromToolResult(result: CallToolResult): unknown {
  if (result.isError) {
    const message = result.content
      .map((item) => item.type === "text" ? item.text : "")
      .filter(Boolean)
      .join("\n") || "OMI MCP tool returned an error";
    throw new Error(message);
  }
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content) {
    if (item.type !== "text") continue;
    try {
      return JSON.parse(item.text) as unknown;
    } catch {
      // Continue until a JSON text block is found.
    }
  }
  return {};
}

function recordsFromPayload(kind: OmiCollectionName, payload: unknown): OmiRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const value = payload[kind];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is OmiRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The Omi MCP server can reject non-default memory orderings with
// {"error":{"code":"unavailable","message":"Memory cursor unavailable"}} (observed 2026-10-02
// for `updated_desc` and `scoring_desc`). Prefer `updated_desc`, then fall back to the
// server default ordering. The privacy filters are identical in every attempt.
function memoryQueryAttempts(limit: number): Record<string, unknown>[] {
  const base = { limit, offset: 0, include_sensitive: false, include_activity: false };
  return [{ ...base, sort: "updated_desc" }, { ...base, sort: "created_desc" }];
}

function isSortUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cursor unavailable|"code"\s*:\s*"unavailable"/i.test(message);
}

async function fetchCollection(client: Client, name: OmiCollectionName, limit = 100): Promise<OmiRecord[]> {
  const tool = name === "memories" ? "get_memories" : "get_conversations";
  const attempts = name === "memories" ? memoryQueryAttempts(limit) : [{ limit, offset: 0 }];
  let lastError: unknown;
  for (const args of attempts) {
    try {
      const result = await client.callTool({ name: tool, arguments: args }, { timeout: 30_000 });
      return recordsFromPayload(name, payloadFromToolResult(result));
    } catch (error) {
      lastError = error;
      if (!isSortUnavailableError(error)) throw error;
    }
  }
  throw lastError;
}

function recordIdentity(record: OmiRecord): string {
  for (const key of ["id", "uuid", "memory_id", "conversation_id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return createHash("sha256").update(JSON.stringify(record)).digest("hex").slice(0, 20);
}

function conversationDetailRecord(payload: unknown): OmiRecord {
  if (!isRecord(payload)) throw new Error("OMI conversation detail payload is not an object");
  if (isRecord(payload.conversation)) return payload.conversation;
  return payload;
}

function validateConversationDetailIdentity(detail: OmiRecord, requestedId: string): OmiRecord {
  const returnedId = recordIdentity(detail);
  if (returnedId !== requestedId) {
    throw new Error(`OMI conversation detail ID mismatch: requested=${requestedId} returned=${returnedId}`);
  }
  return detail;
}

async function fetchConversationDetail(client: Client, conversationId: string): Promise<OmiRecord> {
  const result = await client.callTool({
    name: "get_conversation_by_id",
    arguments: {
      conversation_id: conversationId,
      max_segments: DETAIL_MAX_SEGMENTS,
      max_chars: DETAIL_MAX_CHARS,
    },
  }, { timeout: 30_000 });
  return validateConversationDetailIdentity(
    conversationDetailRecord(payloadFromToolResult(result)),
    conversationId,
  );
}

function semanticConversationDetail(detail: OmiRecord): OmiRecord {
  const projection: OmiRecord = {};

  for (const key of ["id", "uuid", "conversation_id", "created_at", "started_at", "finished_at", "language"]) {
    if (detail[key] !== undefined) projection[key] = detail[key];
  }

  if (isRecord(detail.structured)) {
    const structured: OmiRecord = {};
    for (const key of ["title", "overview", "summary", "category", "emoji"]) {
      if (detail.structured[key] !== undefined) structured[key] = detail.structured[key];
    }
    if (Object.keys(structured).length) projection.structured = structured;
  }

  for (const key of ["transcript", "text", "content", "summary", "overview"]) {
    const value = detail[key];
    if (typeof value === "string") projection[key] = value;
  }

  for (const key of ["transcript_segments", "segments", "utterances"]) {
    const value = detail[key];
    if (!Array.isArray(value)) continue;
    projection[key] = value.map((segment) => {
      if (!isRecord(segment)) return segment;
      const kept: OmiRecord = {};
      for (const segmentKey of [
        "id", "speaker", "speaker_id", "speaker_name", "text", "transcript", "content",
        "start", "end", "start_time", "end_time", "started_at", "finished_at", "timestamp",
      ]) {
        if (segment[segmentKey] !== undefined) kept[segmentKey] = segment[segmentKey];
      }
      return kept;
    });
  }

  return projection;
}

function semanticTextLength(value: unknown): number {
  if (typeof value === "string") return value.trim().length;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + semanticTextLength(item), 0);
  if (!isRecord(value)) return 0;
  return Object.entries(value).reduce((sum, [key, item]) =>
    /text|transcript|content|summary|overview/i.test(key)
      ? sum + semanticTextLength(item)
      : sum, 0);
}

function detailProjectionHash(detail: OmiRecord): string {
  return createHash("sha256").update(JSON.stringify(semanticConversationDetail(detail))).digest("hex");
}

function safeIdentity(identity: string): string {
  return identity.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "record";
}

function detailArtifactFileName(detail: OmiRecord): string {
  const identity = recordIdentity(detail);
  const hash = detailProjectionHash(detail);
  return `${safeIdentity(identity)}.detail.${hash.slice(0, 16)}.md`;
}

function classifyConnectionError(error: unknown): Pick<OmiBridgeStatus, "status" | "authentication"> & { message: string } {
  const message = error instanceof Error ? error.message : "OMI MCP connection failed";
  if (/429|rate exceeded|rate.?limit/i.test(message)) {
    return { status: "rate_limited", authentication: "configured_unverified", message };
  }
  if (/401|unauthorized|forbidden|invalid.*key/i.test(message)) {
    return { status: "blocked", authentication: "rejected", message };
  }
  return { status: "error", authentication: "configured_unverified", message };
}

export async function readOmiBridgeStatus(): Promise<OmiBridgeStatus> {
  const counts: OmiBridgeStatus["counts"] = { memories: null, conversations: null };
  const errors: string[] = [];
  let availableTools: string[] = [];
  let status: OmiBridgeStatus["status"] = "blocked";
  let authentication: OmiBridgeStatus["authentication"] = "missing";

  try {
    await readApiKey();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "OMI MCP key is unavailable");
    return {
      systemId: "omi",
      status,
      mode: "official-mcp-streamable-http-readonly",
      endpoint: mcpUrl(),
      authentication,
      availableTools,
      counts,
      intakeDirectory: intakeDirectory(),
      canonicalVaultMutation: false,
      lastCheckedAt: new Date().toISOString(),
      errors,
    };
  }

  try {
    await withOmiClient(async (client) => {
      availableTools = (await client.listTools()).tools.map((tool) => tool.name).sort();
      const [memories, conversations] = await Promise.all([
        fetchCollection(client, "memories", 1),
        fetchCollection(client, "conversations", 1),
      ]);
      counts.memories = memories.length;
      counts.conversations = conversations.length;
    });
    status = "connected";
    authentication = "authorized";
  } catch (error) {
    const classified = classifyConnectionError(error);
    status = classified.status;
    authentication = classified.authentication;
    errors.push(classified.message);
  }

  return {
    systemId: "omi",
    status,
    mode: "official-mcp-streamable-http-readonly",
    endpoint: mcpUrl(),
    authentication,
    availableTools,
    counts,
    intakeDirectory: intakeDirectory(),
    canonicalVaultMutation: false,
    lastCheckedAt: new Date().toISOString(),
    errors,
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function recordTitle(kind: OmiCollectionName, record: OmiRecord, identity: string): string {
  for (const key of ["title", "name", "summary", "content", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().replace(/\s+/g, " ").slice(0, 100);
  }
  return `OMI ${kind} ${identity}`;
}

function markdownForRecord(kind: OmiCollectionName, record: OmiRecord, createdAt: string): string {
  const identity = recordIdentity(record);
  const title = recordTitle(kind, record, identity);
  const hash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  return `---\ntitle: ${yamlString(title)}\nsource: omi\nsource_kind: ${yamlString(kind)}\nsource_id: ${yamlString(identity)}\nclassification: candidate\ncanonical: false\nimported_at: ${yamlString(createdAt)}\nsha256: ${yamlString(hash)}\n---\n\n# ${title}\n\n> Imported read-only from OMI into the Mission Control sandbox intake. This note is a candidate Shared Brain artifact and is not canonical until governed promotion.\n\n## Source record\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}

function markdownForConversationDetail(detail: OmiRecord, createdAt: string): string {
  const identity = recordIdentity(detail);
  const projection = semanticConversationDetail(detail);
  const hash = createHash("sha256").update(JSON.stringify(projection)).digest("hex");
  const textLength = semanticTextLength(projection);
  const contentPresent = textLength > 0;
  const title = recordTitle("conversations", projection, identity);
  return `---\ntitle: ${yamlString(title)}\nsource: omi\nsource_kind: "conversation_detail"\nsource_id: ${yamlString(identity)}\nclassification: candidate\ncanonical: false\nimported_at: ${yamlString(createdAt)}\nsha256: ${yamlString(hash)}\ndetail_content_present: ${contentPresent}\nsemantic_text_length: ${textLength}\n---\n\n# ${title}\n\n> Imported read-only from OMI via get_conversation_by_id. This is an append-only candidate detail snapshot and is not canonical until governed promotion.\n\n## Conversation detail projection\n\n\`\`\`json\n${JSON.stringify(projection, null, 2)}\n\`\`\`\n`;
}

export const omiBridgeTestSupport = {
  classifyConnectionError,
  conversationDetailRecord,
  detailArtifactFileName,
  detailProjectionHash,
  isSortUnavailableError,
  markdownForConversationDetail,
  markdownForRecord,
  memoryQueryAttempts,
  recordsFromPayload,
  semanticConversationDetail,
  semanticTextLength,
  validateConversationDetailIdentity,
};

export async function importOmiToObsidianIntake(): Promise<OmiIntakeReceipt> {
  const createdAt = new Date().toISOString();
  const root = intakeDirectory();

  const pulled = await withOmiClient(async (client) => {
    const memories = await fetchCollection(client, "memories");
    const conversations = await fetchCollection(client, "conversations");
    const conversationDetails: OmiRecord[] = [];

    // Deliberately sequential for bounded certification and provider rate-limit safety.
    for (const conversation of conversations) {
      const conversationId = recordIdentity(conversation);
      conversationDetails.push(await fetchConversationDetail(client, conversationId));
    }

    return { memories, conversations, conversationDetails };
  });

  const collections: Record<OmiCollectionName, OmiRecord[]> = {
    memories: pulled.memories,
    conversations: pulled.conversations,
  };
  const filesWritten: string[] = [];
  await fs.mkdir(root, { recursive: true });

  // Preserve existing metadata/list artifacts exactly as before. wx/EEXIST means an old
  // metadata-only artifact remains byte-identical and is never silently replaced.
  for (const [kind, records] of Object.entries(collections) as [OmiCollectionName, OmiRecord[]][]) {
    const directory = path.join(root, kind);
    await fs.mkdir(directory, { recursive: true });
    for (const record of records) {
      const identity = recordIdentity(record);
      const filePath = path.join(directory, `${safeIdentity(identity)}.md`);
      await fs.writeFile(filePath, markdownForRecord(kind, record, createdAt), { encoding: "utf8", flag: "wx" })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      filesWritten.push(filePath);
    }
  }

  const conversationDirectory = path.join(root, "conversations");
  await fs.mkdir(conversationDirectory, { recursive: true });
  let contentBearingConversationDetails = 0;
  for (const detail of pulled.conversationDetails) {
    const projection = semanticConversationDetail(detail);
    if (semanticTextLength(projection) > 0) contentBearingConversationDetails += 1;
    const detailPath = path.join(conversationDirectory, detailArtifactFileName(detail));
    await fs.writeFile(detailPath, markdownForConversationDetail(detail, createdAt), { encoding: "utf8", flag: "wx" })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    filesWritten.push(detailPath);
  }

  const receiptPath = path.join(root, `OMI_INTAKE_RECEIPT_${createdAt.replace(/[:.]/g, "-")}.json`);
  const receipt: OmiIntakeReceipt = {
    receiptVersion: 3,
    createdAt,
    source: "omi-official-mcp",
    classification: "candidate",
    canonicalVaultMutation: false,
    counts: {
      memories: collections.memories.length,
      conversations: collections.conversations.length,
    },
    conversationDetails: pulled.conversationDetails.length,
    contentBearingConversationDetails,
    filesWritten,
    receiptPath,
  };
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return receipt;
}
