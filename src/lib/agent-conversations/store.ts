import { promises as fs } from "fs";
import path from "path";
import type { AgentConversationEntry } from "./types";

const DEFAULT_MAX_READ = 200;

function dataDirectory(): string {
  return process.env.AGENT_CONVERSATION_DATA_DIR || path.join(process.cwd(), "data");
}

function conversationFile(): string {
  return path.join(dataDirectory(), "agent-conversations.jsonl");
}

export function isValidConversationKey(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
}

export async function appendConversationEntry(entry: AgentConversationEntry): Promise<void> {
  await fs.mkdir(dataDirectory(), { recursive: true });
  await fs.appendFile(conversationFile(), `${JSON.stringify(entry)}\n`, "utf8");
}

async function readAll(): Promise<AgentConversationEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(conversationFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return raw.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as AgentConversationEntry];
    } catch {
      return [];
    }
  });
}

export async function readConversation(
  agentId: string,
  sessionId: string,
  limit = DEFAULT_MAX_READ
): Promise<AgentConversationEntry[]> {
  const entries = await readAll();
  return entries.filter((entry) => entry.agentId === agentId && entry.sessionId === sessionId).slice(-limit);
}

export async function clearConversation(agentId: string, sessionId: string): Promise<number> {
  const entries = await readAll();
  const retained = entries.filter((entry) => entry.agentId !== agentId || entry.sessionId !== sessionId);
  const removed = entries.length - retained.length;
  await fs.mkdir(dataDirectory(), { recursive: true });
  const replacement = retained.length > 0 ? `${retained.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
  const temporary = `${conversationFile()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, replacement, "utf8");
  await fs.rename(temporary, conversationFile());
  return removed;
}
