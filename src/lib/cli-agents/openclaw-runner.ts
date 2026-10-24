import { execFile } from "child_process";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { CliAgentSession } from "./session-store";
import {stageNativeExecEnvironment,stageNativeExecWorkspace,STAGE_NATIVE_MODEL} from "./stage-native-free-gate";

const execFileAsync = promisify(execFile);
const OPENCLAW_BINARY = process.env.OPENCLAW_AGENT_BINARY || "/usr/bin/openclaw";

export interface OpenClawResult {
  status?: string;
  result?: {
    payloads?: Array<{
      text?: string | null;
      isError?: boolean;
    }>;
    meta?: {
      agentMeta?: {
        sessionId?: string;
        provider?: string;
        model?: string;
      };
      systemPromptReport?: { workspaceDir?: string };
      error?: {
        kind?: string;
        message?: string;
        fallbackSafe?: boolean;
        terminalPresentation?: boolean;
      };
    };
  };
}

export function readSuccessfulOpenClawText(payload: OpenClawResult): string {
  if (payload.status !== "ok") {
    throw new Error("OpenClaw agent turn returned no successful response");
  }

  const structuralError = payload.result?.meta?.error;
  if (structuralError?.kind) {
    const message = structuralError.message?.trim() || "OpenClaw returned a structural terminal error";
    throw new Error(`OpenClaw agent turn failed: ${structuralError.kind}: ${message}`);
  }

  const payloads = payload.result?.payloads ?? [];
  const errorPayload = payloads.find((entry) => entry.isError === true);
  if (errorPayload) {
    const detail = errorPayload.text?.trim();
    throw new Error(
      detail
        ? `OpenClaw agent turn failed: error payload: ${detail}`
        : "OpenClaw agent turn failed: error payload without a model response"
    );
  }

  const text = payloads
    .map((entry) => entry.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("OpenClaw agent turn returned no successful response");
  }
  return text;
}

export async function runOpenClawTurn(options: {
  session: CliAgentSession;
  prompt: string;
}): Promise<ConnectorConversationResult> {
  if (!options.session.runtimeSessionId) throw new Error("OpenClaw runtime session ID is missing");
  const preview=process.env.MC_PREVIEW==="1";
  const effectiveCwd=preview
    ?await stageNativeExecWorkspace("openclaw"):options.session.workspace;
  const nativeEnv=preview
    ?await stageNativeExecEnvironment("openclaw",options.session.sessionKey):{...process.env};
  const versionResult = await execFileAsync(OPENCLAW_BINARY, ["--version"], {
    cwd: effectiveCwd, env: nativeEnv, timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8",
  }).catch(() => null);
  const installedVersion = versionResult ? String(versionResult.stdout).trim() || null : null;
  const { stdout } = await execFileAsync(OPENCLAW_BINARY, [
    "agent",
    ...(preview?["--local","--model",STAGE_NATIVE_MODEL]:[]),
    "--agent", process.env.OPENCLAW_AGENT_ID || "mission-control",
    "--session-id", options.session.runtimeSessionId,
    "--message", options.prompt,
    "--json",
    "--timeout", process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS || "600",
  ], {
    cwd: effectiveCwd,
    env: nativeEnv,
    timeout: Number(process.env.OPENCLAW_AGENT_TIMEOUT_MS || 660_000),
    maxBuffer: 30 * 1024 * 1024,
    encoding: "utf8",
  });

  const payload = JSON.parse(String(stdout)) as OpenClawResult;
  const meta = payload.result?.meta?.agentMeta;
  const text = readSuccessfulOpenClawText(payload);
  const providerModel = meta?.provider && meta?.model ? `${meta.provider}/${meta.model}` : undefined;

  return {
    status: "completed",
    text,
    error: null,
    transportModelAlias: providerModel,
    actualRuntimeModel: meta?.model ?? null,
    attempts: [],
    agentIdentity: "OpenClaw",
    agentRuntime: "OpenClaw CLI agent route",
    installedVersion,
    provider: meta?.provider ?? null,
    runtimeVerifiedAt: new Date().toISOString(),
    responseProvenance: "Mission Control OpenClaw profile -> sandbox gateway relay -> OpenClaw agent JSON response",
    agentSessionId: meta?.sessionId ?? options.session.runtimeSessionId,
    workspace: preview?effectiveCwd:(payload.result?.meta?.systemPromptReport?.workspaceDir ?? options.session.workspace),
    sessionState: "idle",
    executionMode: options.session.executionMode,
    permissionMode: options.session.permissionMode,
  };
}
