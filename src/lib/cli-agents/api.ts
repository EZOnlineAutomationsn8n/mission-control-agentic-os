import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { promptWithAttachments, resolveAttachments } from "@/lib/attachments/store";
import { executeConversationRequest, type ConnectorConversationResult } from "@/lib/agent-conversations/service";
import { auditInitiatorFields, parseConversationInitiator } from "@/lib/agent-conversations/initiator";
import { isValidConversationKey } from "@/lib/agent-conversations/store";
import { runAgyTurn } from "./agy-runner";
import { runHermesTurn } from "./hermes-runner";
import { runOpenClawTurn } from "./openclaw-runner";
import { runGeminiTurn } from "./gemini-runner";
import { runCodexTurn } from "./codex-runner";
import {
  createCliAgentSession,
  readCliAgentSession,
  stopCliAgentSession,
  updateCliAgentSession,
  type CliAgentId,
  type CliAgentSession,
} from "./session-store";

const LABELS: Record<CliAgentId, string> = {
  hermes: "Hermes Agent",
  openclaw: "OpenClaw",
  agy: "Antigravity",
  gemini: "Gemini CLI",
  codex: "Codex CLI",
};

function bootstrapPrompt(agentId: CliAgentId): string {
  if (agentId === "openclaw") {
    return [
      "Initialize this Mission Control OpenClaw session.",
      "Your OpenClaw agent profile is mission-control, never main or another project profile.",
      "Read AGENTS.md completely from the current Mission Control repository.",
      "Read the PRODUCT_POLICY path declared by AGENTS.md.",
      "Report your agent identity, exact workspace, active profile, and that no standing historical assignment is current authority.",
      "Do not execute a historical assignment or edit files; use only read-only file access needed for this bootstrap.",
    ].join("\n");
  }
  return `Initialize this Mission Control ${LABELS[agentId]} session. Report your agent identity and exact workspace. Do not edit files or use tools.`;
}

export function codexUsesChatGptSubscriptionAuth(stdout: string): boolean {
  return /^Logged in using ChatGPT\s*$/m.test(stdout.trim()) &&
    !/api.key|pay.as.you.go|openai_api_key/i.test(stdout);
}

function sessionKey(request: Request): string {
  return new URL(request.url).searchParams.get("sessionId") || "operator-default";
}


async function runAgentTurn(agentId: CliAgentId, session: CliAgentSession, prompt: string, create: boolean): Promise<ConnectorConversationResult> {
  if (agentId === "hermes") return runHermesTurn({ session, prompt, create });
  if (agentId === "agy") return runAgyTurn({ session, prompt, create });
  if (agentId === "gemini") return runGeminiTurn({ session, prompt, create });
  if (agentId === "codex") return runCodexTurn({ session, prompt, create });
  return runOpenClawTurn({ session, prompt });
}

export async function getCliAgentSession(request: Request, agentId: CliAgentId) {
  const key = sessionKey(request);
  if (!isValidConversationKey(key)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  return NextResponse.json({ session: await readCliAgentSession(agentId, key) });
}

export async function changeCliAgentSession(request: Request, agentId: CliAgentId) {
  const key = sessionKey(request);
  if (!isValidConversationKey(key)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const action = (body as { action?: unknown } | null)?.action;
  const parsedInitiator = parseConversationInitiator((body as { initiator?: unknown } | null)?.initiator);
  if (!parsedInitiator.ok) return NextResponse.json({ error: parsedInitiator.error }, { status: 400 });
  const initiator = parsedInitiator.initiator;

  if (action === "stop") {
    const session = await stopCliAgentSession(agentId, key);
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(),
      connectorId: agentId,
      actionType: `${agentId}-session-stop`,
      status: "completed",
      resultSummary: session ? `session ${session.runtimeSessionId} stopped` : "no active session",
      ...auditInitiatorFields(initiator),
      source: "cli-agents/api.ts:changeCliAgentSession",
    });
    return NextResponse.json({ session, auditRecorded: audit.ok, auditError: audit.error ?? null });
  }
  if (action !== "start") return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });

  const existing = await readCliAgentSession(agentId, key);
  if (existing?.active && existing.status !== "stopped") return NextResponse.json({ session: existing, alreadyActive: true });

  // Gemini's effective "auto" backing model and unpaid account quota are
  // not independently proven. In the isolated workshop even an operator
  // Start must not issue the hidden Gemini bootstrap/model prompt.
  if (process.env.MC_PREVIEW === "1" && agentId === "gemini") {
    return NextResponse.json({error:"GEMINI_ZERO_COST_AUTH_AND_MODEL_UNVERIFIED",
      detail:"Gemini CLI is installed; CLI auth mode, actual model behind auto, and cost-free quota remain unverified. No session reset or provider call."},
      {status:409});
  }
  // WORKPLAATS ONLY: Codex subscription auth is checked without model traffic.
  // The operator's first actual prompt opens the native thread, rather than
  // a hidden model bootstrap on Start. No session is created on failed auth.
  if (process.env.MC_PREVIEW === "1" && agentId === "codex") {
    if (existing) return NextResponse.json({error:"STAGE_SESSION_ALREADY_EXISTS_NO_RESET",
      session:existing},{status:409});
    try {
      const {stdout,stderr}=await promisify(execFile)(process.env.CODEX_AGENT_BINARY || "/usr/bin/codex",
        ["login","status"],{timeout:8000,encoding:"utf8",maxBuffer:1024*1024});
      // codex CLI writes the login status to STDERR in some versions.
      // Only inspect the local auth type; do not expose raw output to browser.
      if (!codexUsesChatGptSubscriptionAuth(String(stdout)+"\n"+String(stderr))) {
        return NextResponse.json({error:"CODEX_SUBSCRIPTION_AUTH_NOT_VERIFIED",authMode:"UNKNOWN"},{status:409});
      }
    } catch {
      return NextResponse.json({error:"CODEX_CLI_AUTH_UNAVAILABLE_IN_STAGE"},{status:409});
    }
    const created=await createCliAgentSession(agentId,key);
    const prepared=await updateCliAgentSession(agentId,key,{
      active:true,status:"prepared",agentRuntime:"Codex CLI (subscription login verified)",
      lastError:null,
    });
    return NextResponse.json({session:prepared,prepared:true,firstTurnByOperator:true,
      authMode:"CHATGPT_SUBSCRIPTION",modelCalls:0,requiresFirstOperatorMessage:true,
      // Codex native thread id is created on Dennis's first prompt, NOT now.
      stageOnly:true,previousRuntimeSessionId:created.runtimeSessionId||null});
  }
  const session = await createCliAgentSession(agentId, key);
  try {
    const bootstrap = await runAgentTurn(agentId, session, bootstrapPrompt(agentId), true);
    if (bootstrap.status !== "completed" || !bootstrap.text || !bootstrap.agentSessionId) {
      throw new Error(bootstrap.error || `${LABELS[agentId]} bootstrap did not complete`);
    }
    const ready = await updateCliAgentSession(agentId, key, {
      runtimeSessionId: bootstrap.agentSessionId,
      status: "idle",
      active: true,
      lastError: null,
      assignmentPath: null,
      agentRuntime: bootstrap.agentRuntime ?? null,
      transportModelAlias: bootstrap.transportModelAlias ?? null,
      actualRuntimeModel: bootstrap.actualRuntimeModel ?? null,
    });
    const audit = await appendAuditEvent({
      timestamp: new Date().toISOString(),
      connectorId: agentId,
      actionType: `${agentId}-session-start`,
      status: "completed",
      resultSummary: `session ${ready.runtimeSessionId} started - ${ready.workspace}`,
      ...auditInitiatorFields(initiator),
      source: "cli-agents/api.ts:changeCliAgentSession",
    });
    return NextResponse.json({
      session: ready,
      bootstrap: bootstrap.text,
      agentIdentity: bootstrap.agentIdentity,
      agentRuntime: bootstrap.agentRuntime,
      transportModelAlias: bootstrap.transportModelAlias ?? null,
      actualRuntimeModel: bootstrap.actualRuntimeModel ?? null,
      auditRecorded: audit.ok,
      auditError: audit.error ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${LABELS[agentId]} session start failed`;
    const failed = await updateCliAgentSession(agentId, key, { status: "error", active: false, lastError: message });
    await appendAuditEvent({
      timestamp: new Date().toISOString(),
      connectorId: agentId,
      actionType: `${agentId}-session-start`,
      status: "failed",
      resultSummary: message,
      ...auditInitiatorFields(initiator),
      source: "cli-agents/api.ts:changeCliAgentSession",
    });
    return NextResponse.json({ session: failed, error: message }, { status: 502 });
  }
}

export async function askCliAgent(request: Request, agentId: CliAgentId) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  const key = (body as { sessionId?: unknown } | null)?.sessionId ?? "operator-default";
  if (typeof prompt !== "string" || !prompt.trim()) return NextResponse.json({ error: "prompt must be non-empty text" }, { status: 400 });
  if (typeof key !== "string" || !isValidConversationKey(key)) return NextResponse.json({ error: "invalid session identifier" }, { status: 400 });
  const parsedInitiator = parseConversationInitiator((body as { initiator?: unknown } | null)?.initiator);
  if (!parsedInitiator.ok) return NextResponse.json({ error: parsedInitiator.error }, { status: 400 });
  let attachments;
  try {
    attachments = await resolveAttachments({
      agentId,
      sessionId: key,
      ids: (body as { attachments?: unknown } | null)?.attachments,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid attachments" }, { status: 400 });
  }
  const effectivePrompt = promptWithAttachments(prompt.trim(), attachments);

  const session = await readCliAgentSession(agentId, key);
  if (!session?.active) return NextResponse.json({ error: `${LABELS[agentId]} session is stopped; start it before sending a prompt` }, { status: 409 });
  if (session.status === "running" || session.status === "starting") {
    return NextResponse.json({ error: `${LABELS[agentId]} session is already busy` }, { status: 409 });
  }

  await updateCliAgentSession(agentId, key, { status: "running", lastError: null });
  const persisted = await executeConversationRequest({
    agentId,
    sessionId: key,
    prompt: prompt.trim(),
    attachments,
    actionType: `${agentId}-agent-turn`,
    initiator: parsedInitiator.initiator ?? undefined,
    run: () => runAgentTurn(agentId, session, effectivePrompt,
      process.env.MC_PREVIEW === "1" && agentId === "codex" &&
      session.status === "prepared" && !session.runtimeSessionId),
  });
  await updateCliAgentSession(agentId, key, {
    runtimeSessionId: persisted.entry.agentSessionId ?? session.runtimeSessionId,
    status: persisted.entry.status === "completed" ? "idle" : "error",
    lastError: persisted.entry.error,
    agentRuntime: persisted.entry.agentRuntime ?? session.agentRuntime ?? null,
    transportModelAlias: persisted.entry.transportModelAlias ?? session.transportModelAlias ?? null,
    actualRuntimeModel: persisted.entry.actualRuntimeModel ?? session.actualRuntimeModel ?? null,
  });
  return NextResponse.json(
    { ...persisted.entry, auditRecorded: persisted.auditRecorded, auditError: persisted.auditError },
    { status: persisted.auditRecorded ? 200 : 500 }
  );
}
