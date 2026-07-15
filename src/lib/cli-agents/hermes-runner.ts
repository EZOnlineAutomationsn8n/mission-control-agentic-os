import { execFile } from "child_process";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { CliAgentSession } from "./session-store";

const execFileAsync = promisify(execFile);
const HERMES_BINARY = process.env.HERMES_AGENT_BINARY || "/usr/local/bin/hermes";
const HERMES_RUNTIME = "Hermes Agent v0.18.0";

export async function runHermesTurn(options: {
  session: CliAgentSession;
  prompt: string;
  create: boolean;
}): Promise<ConnectorConversationResult> {
  const args = [
    "chat", "-q", options.prompt, "-Q",
    "--source", "mission-control",
    "--pass-session-id",
    "--max-turns", process.env.HERMES_AGENT_MAX_TURNS || "90",
  ];
  if (!options.create) {
    if (!options.session.runtimeSessionId) throw new Error("Hermes runtime session ID is missing");
    args.push("--resume", options.session.runtimeSessionId);
  }

  const { stdout, stderr } = await execFileAsync(HERMES_BINARY, args, {
    cwd: options.session.workspace,
    env: { ...process.env },
    timeout: Number(process.env.HERMES_AGENT_TIMEOUT_MS || 600_000),
    maxBuffer: 20 * 1024 * 1024,
    encoding: "utf8",
  });
  const output = `${String(stdout)}\n${String(stderr)}`;
  const match = output.match(/session_id:\s*([A-Za-z0-9_-]+)/i);
  const runtimeSessionId = match?.[1] || options.session.runtimeSessionId;
  if (!runtimeSessionId) throw new Error("Hermes returned no persistent session ID");
  const text = String(stdout).split("\n").filter((line) => !/^session_id:/i.test(line.trim())).join("\n").trim();
  if (!text) throw new Error("Hermes returned no response text");

  return {
    status: "completed",
    text,
    error: null,
    transportModelAlias: undefined,
    actualRuntimeModel: null,
    attempts: [],
    agentIdentity: "Hermes Agent",
    agentRuntime: HERMES_RUNTIME,
    agentSessionId: runtimeSessionId,
    workspace: options.session.workspace,
    sessionState: "idle",
    executionMode: options.session.executionMode,
    permissionMode: options.session.permissionMode,
  };
}
