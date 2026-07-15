import { execFile } from "child_process";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { CliAgentSession } from "./session-store";

const execFileAsync = promisify(execFile);
const OPENCLAW_BINARY = process.env.OPENCLAW_AGENT_BINARY || "/usr/bin/openclaw";
const OPENCLAW_RUNTIME = "OpenClaw 2026.6.9";

interface OpenClawResult {
  status?: string;
  result?: {
    payloads?: Array<{ text?: string | null }>;
    meta?: {
      agentMeta?: {
        sessionId?: string;
        provider?: string;
        model?: string;
      };
      systemPromptReport?: { workspaceDir?: string };
    };
  };
}

export async function runOpenClawTurn(options: {
  session: CliAgentSession;
  prompt: string;
}): Promise<ConnectorConversationResult> {
  if (!options.session.runtimeSessionId) throw new Error("OpenClaw runtime session ID is missing");
  const { stdout } = await execFileAsync(OPENCLAW_BINARY, [
    "agent",
    "--agent", process.env.OPENCLAW_AGENT_ID || "main",
    "--session-id", options.session.runtimeSessionId,
    "--message", options.prompt,
    "--json",
    "--timeout", process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS || "600",
  ], {
    cwd: options.session.workspace,
    env: { ...process.env },
    timeout: Number(process.env.OPENCLAW_AGENT_TIMEOUT_MS || 660_000),
    maxBuffer: 30 * 1024 * 1024,
    encoding: "utf8",
  });

  const payload = JSON.parse(String(stdout)) as OpenClawResult;
  const meta = payload.result?.meta?.agentMeta;
  const text = (payload.result?.payloads ?? []).map((entry) => entry.text ?? "").filter(Boolean).join("\n").trim();
  if (payload.status !== "ok" || !text) throw new Error("OpenClaw agent turn returned no successful response");
  const providerModel = meta?.provider && meta?.model ? `${meta.provider}/${meta.model}` : undefined;

  return {
    status: "completed",
    text,
    error: null,
    transportModelAlias: providerModel,
    actualRuntimeModel: meta?.model ?? null,
    attempts: [],
    agentIdentity: "OpenClaw",
    agentRuntime: OPENCLAW_RUNTIME,
    agentSessionId: meta?.sessionId ?? options.session.runtimeSessionId,
    workspace: payload.result?.meta?.systemPromptReport?.workspaceDir ?? options.session.workspace,
    sessionState: "idle",
    executionMode: options.session.executionMode,
    permissionMode: options.session.permissionMode,
  };
}
