import { execFile } from "child_process";
import { promises as fs } from "fs";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { CliAgentSession } from "./session-store";
import {stageNativeExecEnvironment} from "./stage-native-free-gate";

const execFileAsync = promisify(execFile);
const HERMES_BINARY = process.env.HERMES_AGENT_BINARY || "/usr/local/bin/hermes";

async function readHermesRuntimeMetadata(session: CliAgentSession, runtimeEnv:NodeJS.ProcessEnv): Promise<{
  agentRuntime: string;
  installedVersion: string | null;
  provider: string | null;
  transportModelAlias: string | null;
  actualRuntimeModel: string | null;
  runtimeVerifiedAt: string;
}> {
  try {
    const options = {
      cwd: session.workspace,
      env: runtimeEnv,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8" as const,
    };
    const [versionResult, modelResult, providerResult, installStamp] = await Promise.all([
      execFileAsync(HERMES_BINARY, ["--version"], options),
      execFileAsync(HERMES_BINARY, ["config", "get", "model.default"], options),
      execFileAsync(HERMES_BINARY, ["config", "get", "model.provider"], options),
      fs.readFile(`${session.workspace}/runtime-evidence/live-host.json`, "utf8")
        .catch(() => fs.readFile("/usr/local/lib/hermes-agent/install-stamp.json", "utf8"))
        .catch(() => ""),
    ]);
    let stampedVersion: string | null = null;
    try {
      const parsed = JSON.parse(installStamp) as { displayVersion?: unknown; hermes?: { installedVersion?: unknown } };
      stampedVersion = String(parsed.hermes?.installedVersion ?? parsed.displayVersion ?? "").trim() || null;
    } catch {}
    const commandVersion = String(versionResult.stdout).split("\n").map((line) => line.trim()).find(Boolean) ?? null;
    const actualRuntimeModel = String(modelResult.stdout).trim() || null;
    const provider = String(providerResult.stdout).trim() || null;
    return {
      agentRuntime: "Hermes Agent CLI",
      installedVersion: stampedVersion ?? commandVersion,
      provider,
      actualRuntimeModel,
      transportModelAlias: provider && actualRuntimeModel ? `${provider}/${actualRuntimeModel}` : actualRuntimeModel,
      runtimeVerifiedAt: new Date().toISOString(),
    };
  } catch {
    return {
      agentRuntime: "Hermes Agent CLI",
      installedVersion: null,
      provider: null,
      transportModelAlias: null,
      actualRuntimeModel: null,
      runtimeVerifiedAt: new Date().toISOString(),
    };
  }
}

export async function runHermesTurn(options: {
  session: CliAgentSession;
  prompt: string;
  create: boolean;
}): Promise<ConnectorConversationResult> {
  const nativeEnv=process.env.MC_PREVIEW==="1"
    ?await stageNativeExecEnvironment("hermes",options.session.sessionKey):{...process.env};
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

  const [turnResult, runtimeMetadata] = await Promise.all([
    execFileAsync(HERMES_BINARY, args, {
      cwd: options.session.workspace,
      env: nativeEnv,
      timeout: Number(process.env.HERMES_AGENT_TIMEOUT_MS || 600_000),
      maxBuffer: 20 * 1024 * 1024,
      encoding: "utf8",
    }),
    readHermesRuntimeMetadata(options.session,nativeEnv),
  ]);
  const { stdout, stderr } = turnResult;
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
    transportModelAlias: runtimeMetadata.transportModelAlias ?? undefined,
    actualRuntimeModel: runtimeMetadata.actualRuntimeModel,
    attempts: [],
    agentIdentity: "Hermes Agent",
    agentRuntime: runtimeMetadata.agentRuntime,
    installedVersion: runtimeMetadata.installedVersion,
    provider: runtimeMetadata.provider,
    runtimeVerifiedAt: runtimeMetadata.runtimeVerifiedAt,
    responseProvenance: "Hermes Agent CLI chat --source mission-control -> persistent Hermes runtime session",
    agentSessionId: runtimeSessionId,
    workspace: options.session.workspace,
    sessionState: "idle",
    executionMode: options.session.executionMode,
    permissionMode: options.session.permissionMode,
  };
}
