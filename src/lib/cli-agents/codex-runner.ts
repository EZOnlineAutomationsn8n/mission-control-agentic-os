import { execFile } from "child_process";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { CliAgentSession } from "./session-store";
import { effectiveWerkplaatsWorkspace } from "@/lib/acf/runtime-root";
import { stageCliProfileEnvironment } from "./stage-cli-profile";

const execFileAsync = promisify(execFile);
const CODEX_BINARY = process.env.CODEX_AGENT_BINARY || "/usr/bin/codex";
const CODEX_RUNTIME = "Codex CLI 0.144.3";

function execCodex(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(CODEX_BINARY, args, {
      cwd,
      env,
      timeout: Number(process.env.CODEX_AGENT_TIMEOUT_MS || 660_000),
      maxBuffer: 40 * 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        if (stderr) error.message = `${error.message}\n${stderr}`;
        reject(error);
        return;
      }
      resolve(String(stdout));
    });

    // Codex reads stdin in addition to the prompt while it remains open.
    // The server has no interactive stdin, so close it immediately.
    child.stdin?.end();
  });
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  item?: { type?: string; text?: string };
}

function parseEvents(stdout: string, previousSessionId: string): { text: string; sessionId: string } {
  let sessionId = previousSessionId;
  let text = "";
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: CodexEvent;
    try { event = JSON.parse(line) as CodexEvent; } catch { continue; }
    if (event.type === "thread.started" && event.thread_id) sessionId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) text = event.item.text;
    if (event.type === "error" && event.message && !text) text = event.message;
  }
  if (!sessionId) throw new Error("Codex returned no persistent thread ID");
  if (!text.trim()) throw new Error("Codex returned no final agent message");
  return { text: text.trim(), sessionId };
}

export async function runCodexTurn(options: {
  session: CliAgentSession;
  prompt: string;
  create: boolean;
}): Promise<ConnectorConversationResult> {
  const effectiveWorkspace=effectiveWerkplaatsWorkspace(options.session.workspace);
  const nativeEnv=await stageCliProfileEnvironment("codex");
  try {
    await execFileAsync(CODEX_BINARY, ["login", "status"], {
      cwd: effectiveWorkspace,
      env: nativeEnv,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
  } catch {
    throw new Error("Codex login required on the VPS. Run: codex login --device-auth");
  }
  const args = options.create
    ? ["exec", "--json", "--sandbox", "workspace-write", "--cd", effectiveWorkspace, "--skip-git-repo-check", options.prompt]
    : ["exec", "resume", "--json", "--skip-git-repo-check", options.session.runtimeSessionId, options.prompt];
  if (!options.create && !options.session.runtimeSessionId) throw new Error("Codex runtime thread ID is missing");

  try {
    const stdout = await execCodex(args, effectiveWorkspace, nativeEnv);
    const parsed = parseEvents(stdout, options.session.runtimeSessionId);
    return {
      status: "completed",
      text: parsed.text,
      error: null,
      transportModelAlias: undefined,
      actualRuntimeModel: null,
      attempts: [],
      agentIdentity: "Codex",
      agentRuntime: CODEX_RUNTIME,
      agentSessionId: parsed.sessionId,
      workspace: effectiveWorkspace,
      sessionState: "idle",
      executionMode: options.session.executionMode,
      permissionMode: options.session.permissionMode,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/not logged in|login required|codex login/i.test(detail)) {
      throw new Error("Codex login required on the VPS. Run: codex login --device-auth");
    }
    throw error;
  }
}
