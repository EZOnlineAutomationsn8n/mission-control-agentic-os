import { execFile } from "child_process";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { CliAgentSession } from "./session-store";

const execFileAsync = promisify(execFile);
const GEMINI_BINARY = process.env.GEMINI_AGENT_BINARY || "/usr/bin/gemini";
const GEMINI_RUNTIME = "Gemini CLI 0.50.0";

interface GeminiEvent {
  type?: string;
  role?: string;
  session_id?: string;
  sessionId?: string;
  model?: string;
  content?: string;
  response?: string;
  result?: string;
  error?: { message?: string } | string;
}

export function parseGeminiStreamEvents(stdout: string, expectedSessionId: string): { text: string; sessionId: string; model: string | null } {
  let sessionId = expectedSessionId;
  let text = "";
  let model: string | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: GeminiEvent;
    try { event = JSON.parse(line) as GeminiEvent; } catch { continue; }
    sessionId = event.session_id || event.sessionId || sessionId;
    model = event.model || model;
    // Gemini stream-json includes the submitted user prompt as a message event.
    // Only assistant-role messages are agent output; other roles are never echoed.
    if (event.type === "message" && event.role === "assistant" && event.content) text += event.content;
    if (event.type === "result") text = event.response || event.result || text;
    if (event.type === "error" && !text) text = typeof event.error === "string" ? event.error : event.error?.message || "";
  }
  if (!sessionId) throw new Error("Gemini returned no persistent session ID");
  if (!text.trim()) throw new Error("Gemini returned no final agent message");
  return { text: text.trim(), sessionId, model };
}

export async function runGeminiTurn(options: {
  session: CliAgentSession;
  prompt: string;
  create: boolean;
}): Promise<ConnectorConversationResult> {
  if (!options.session.runtimeSessionId) throw new Error("Gemini runtime session ID is missing");
  const args = [
    "--skip-trust",
    ...(process.env.GEMINI_AGENT_OUTER_SANDBOX === "1" ? [] : ["--sandbox"]),
    "--approval-mode", "yolo",
    "--output-format", "stream-json",
    ...(options.create ? ["--session-id", options.session.runtimeSessionId] : ["--resume", options.session.runtimeSessionId]),
    "--prompt", options.prompt,
  ];

  try {
    const { stdout } = await execFileAsync(GEMINI_BINARY, args, {
      cwd: options.session.workspace,
      env: { ...process.env },
      timeout: Number(process.env.GEMINI_AGENT_TIMEOUT_MS || 660_000),
      maxBuffer: 40 * 1024 * 1024,
      encoding: "utf8",
    });
    const parsed = parseGeminiStreamEvents(String(stdout), options.session.runtimeSessionId);
    return {
      status: "completed",
      text: parsed.text,
      error: null,
      transportModelAlias: parsed.model ?? undefined,
      actualRuntimeModel: parsed.model,
      attempts: [],
      agentIdentity: "Gemini",
      agentRuntime: GEMINI_RUNTIME,
      agentSessionId: parsed.sessionId,
      workspace: options.session.workspace,
      sessionState: "idle",
      executionMode: options.session.executionMode,
      permissionMode: options.session.permissionMode,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/auth method|GEMINI_API_KEY|GOOGLE_GENAI_USE/i.test(detail)) {
      throw new Error("Gemini login required on the VPS. Authenticate Gemini CLI or configure its own supported API key.");
    }
    throw error;
  }
}
