import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { readFccLiveStatus } from "@/lib/connectors/live/fcc-status";
import { inspectNativeStageTransport, type StageTransportStatus } from "@/lib/cli-agents/stage-native-transport-gate";
import { werkplaatsRuntimeRoot } from "./runtime-root";

const execFileAsync = promisify(execFile);
export const FIRST_TURN_CONTRACT = "MC_PREPARED_FIRST_TURN_V1" as const;

export type FirstTurnReadiness = {
  contract: typeof FIRST_TURN_CONTRACT;
  ready: boolean;
  code: string;
  providerCalls: 0;
  checkedAt: string;
};

type SessionLike = {
  agentId?: unknown;
  sessionId?: unknown;
  status?: unknown;
  active?: unknown;
};

function result(ready: boolean, code: string): FirstTurnReadiness {
  return { contract: FIRST_TURN_CONTRACT, ready, code, providerCalls: 0, checkedAt: new Date().toISOString() };
}

function codexUsesChatGptSubscriptionAuth(output: string): boolean {
  return /^Logged in using ChatGPT\s*$/m.test(output.trim()) &&
    !/api.key|pay.as.you.go|openai_api_key/i.test(output);
}

export async function readFirstTurnReadiness(
  row: SessionLike,
  transportOverride?: StageTransportStatus | null,
): Promise<FirstTurnReadiness | null> {
  if (row.status !== "prepared") return null;
  const stage = werkplaatsRuntimeRoot();
  // AGENTS MODE uses the real shared executor; native-stage readiness checks
  // are inapplicable. ACF must judge eligibility from the actual session index.
  if (process.env.MC_PREVIEW === "1" && process.env.GAOS_STAGE_NATIVE_ISOLATED !== "1") return null;
  if (!stage || process.env.GAOS_STAGE_NATIVE_ISOLATED !== "1") {
    return result(false, "WERKPLAATS_RUNTIME_NOT_ISOLATED");
  }
  const agentId = typeof row.agentId === "string" ? row.agentId : "";
  const sessionId = typeof row.sessionId === "string" ? row.sessionId : "";
  if (row.active !== true) return result(false, "PREPARED_SESSION_NOT_ACTIVE");
  if (!/^acf-werkplaats-[A-Za-z0-9_-]{1,48}$/.test(sessionId)) {
    return result(false, "WERKPLAATS_SESSION_ID_INVALID");
  }

  if (agentId === "claude-code") {
    const launcher=process.env.CLAUDE_CODE_LAUNCHER || "/runtime/bin/start-claude-fcc.sh";
    try { await access(launcher,constants.X_OK); }
    catch { return result(false,"CLAUDE_STAGE_LAUNCHER_DISABLED"); }
    const fcc = await readFccLiveStatus();
    return fcc.status === "connected"
      ? result(true, "FCC_STAGE_RELAY_CONNECTED_AND_LAUNCHER_READY")
      : result(false, "FCC_STAGE_RELAY_" + fcc.status.toUpperCase());
  }

  if (agentId === "hermes" || agentId === "openclaw") {
    const transport = transportOverride ?? await inspectNativeStageTransport(agentId, sessionId);
    return result(transport.canSend, transport.code);
  }

  if (agentId === "codex") {
    try {
      const { stdout, stderr } = await execFileAsync(process.env.CODEX_AGENT_BINARY || "/usr/bin/codex",
        ["login", "status"], {
          cwd: stage,
          timeout: 8_000,
          maxBuffer: 1024 * 1024,
          encoding: "utf8",
          env: { ...process.env },
        });
      return codexUsesChatGptSubscriptionAuth(String(stdout) + "\n" + String(stderr))
        ? result(true, "CODEX_CHATGPT_SUBSCRIPTION_AUTH_READY")
        : result(false, "CODEX_SUBSCRIPTION_AUTH_NOT_VERIFIED");
    } catch {
      return result(false, "CODEX_CLI_AUTH_UNAVAILABLE_IN_STAGE");
    }
  }

  return result(false, "FIRST_TURN_CONTRACT_NOT_AVAILABLE_FOR_AGENT");
}
