import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { CliAgentSession } from "./session-store";

const execFileAsync = promisify(execFile);
const AGY_BINARY = process.env.AGY_AGENT_BINARY || "/root/.local/bin/agy";
const AGY_RUNTIME = "Antigravity CLI 1.0.12";
const AGY_PROJECT_ID = process.env.AGY_AGENT_PROJECT_ID || "d05562cc-1039-47b1-a562-109f98779234";
const IDENTITY_CONTEXT =
  "Your product name and agent identity is Antigravity. " +
  "You are an Agentic AI coding assistant. " +
  "Do not identify yourself as a governance orchestrator or as a separate AGY system.";

export async function runAgyTurn(options: {
  session: CliAgentSession;
  prompt: string;
  create: boolean;
}): Promise<ConnectorConversationResult> {
  const logFile = path.join(os.tmpdir(), `mission-control-agy-${randomUUID()}.log`);
  const agentPrompt = `${IDENTITY_CONTEXT}

Operator request:
${options.prompt}`;
  const args = [
    "--sandbox",
    "--project", AGY_PROJECT_ID,
    "--print", agentPrompt,
    "--print-timeout", process.env.AGY_AGENT_PRINT_TIMEOUT || "10m",
    "--log-file", logFile,
  ];
  if (!options.create) {
    if (!options.session.runtimeSessionId) throw new Error("AGY conversation ID is missing");
    args.push("--conversation", options.session.runtimeSessionId);
  }

  let stdout = "";
  let log = "";
  try {
    const result = await execFileAsync(AGY_BINARY, args, {
      cwd: options.session.workspace,
      env: { ...process.env, PATH: `/root/.local/bin:${process.env.PATH || ""}` },
      timeout: Number(process.env.AGY_AGENT_TIMEOUT_MS || 660_000),
      maxBuffer: 20 * 1024 * 1024,
      encoding: "utf8",
    });
    stdout = String(result.stdout);
    log = await fs.readFile(logFile, "utf8").catch(() => "");
  } finally {
    await fs.unlink(logFile).catch(() => undefined);
  }

  const created = log.match(/Created conversation\s+([A-Fa-f0-9-]{36})/);
  const resumed = log.match(/Print mode: conversation=([A-Fa-f0-9-]{36})/);
  const runtimeSessionId = created?.[1] || resumed?.[1] || options.session.runtimeSessionId;
  if (!runtimeSessionId) throw new Error("AGY returned no persistent conversation ID");
  const text = stdout.trim();
  if (!text) throw new Error("AGY returned no response text");
  const model = log.match(/selected model override.*label="([^"]+)"/i)?.[1] ?? null;

  return {
    status: "completed",
    text,
    error: null,
    transportModelAlias: model ?? undefined,
    actualRuntimeModel: model,
    attempts: [],
    agentIdentity: "Antigravity",
    agentRuntime: AGY_RUNTIME,
    agentSessionId: runtimeSessionId,
    workspace: options.session.workspace,
    sessionState: "idle",
    executionMode: options.session.executionMode,
    permissionMode: options.session.permissionMode,
  };
}
