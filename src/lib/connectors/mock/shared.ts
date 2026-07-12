import type {
  AgentSystemAdapter,
  AgentSystemState,
  ApprovalRequest,
  ConnectorDescriptor,
  LogEntry,
  LogLevel,
  OutputEvent,
  ReportRef,
  RunState,
} from "../types";
import { vaultEngine } from "./obsidian-instance";
import { recordAction } from "@/lib/action-log-store";

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

// ─── Persisted approval decisions ────────────────────────────────────────
// Approval ids are regenerated on every module init, so a page refresh
// used to resurrect decided approvals as "pending". Decisions are now
// persisted server-side (data/approval-decisions.jsonl via
// /api/approvals/decisions) under the STABLE key
// `${agentId}::${requestedCapability}`, loaded once per tab, and applied
// to the in-memory approvals on every getState() — a decided approval
// stays decided across reloads.

interface PersistedDecision {
  decision: "approved" | "rejected";
  reason: string;
  at: string;
}

let decisionsCache: Record<string, PersistedDecision> | null = null;
let decisionsFetch: Promise<void> | null = null;

async function ensureDecisionsLoaded(): Promise<void> {
  if (typeof window === "undefined") return; // never fetch during SSR
  if (decisionsCache) return;
  if (!decisionsFetch) {
    decisionsFetch = (async () => {
      try {
        const res = await fetch("/api/approvals/decisions", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { decisions?: Record<string, PersistedDecision> };
        decisionsCache = data.decisions ?? {};
      } catch (e) {
        console.error("approval decisions load failed (will retry on next poll):", e);
        decisionsFetch = null; // allow retry — do NOT fake an empty decided set permanently
      }
    })();
  }
  await decisionsFetch;
}

function decisionKey(agentId: string, requestedCapability: string): string {
  return `${agentId}::${requestedCapability}`;
}

/** Apply persisted decisions to still-pending in-memory approvals (idempotent). */
function applyPersistedDecisions(approvals: ApprovalRequest[]): void {
  if (!decisionsCache) return;
  for (const a of approvals) {
    if (a.status !== "pending") continue;
    const rec = decisionsCache[decisionKey(a.agentId, a.requestedCapability)];
    if (!rec) continue;
    a.status = rec.decision;
    a.auditTrail.push({
      at: rec.at,
      actor: "operator",
      action: `${rec.decision} (persisted decision restored after reload)`,
      reason: rec.reason || undefined,
    });
  }
}

/** Persist a fresh operator decision; best-effort, failure logged, never faked. */
function persistDecision(agentId: string, requestedCapability: string, decision: "approved" | "rejected", reason: string, at: string): void {
  if (decisionsCache) {
    decisionsCache[decisionKey(agentId, requestedCapability)] = { decision, reason, at };
  }
  if (typeof window === "undefined") return;
  void fetch("/api/approvals/decisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId, requestedCapability, decision, reason, at }),
  })
    .then((res) => {
      if (!res.ok) console.error("approval decision persistence failed: HTTP", res.status);
    })
    .catch((e) => console.error("approval decision persistence request failed:", e));
}

export interface MockAdapterConfig {
  descriptor: ConnectorDescriptor;
  modelOrService: string;
  taskLines: string[]; // rotating "currentTask" flavor text
  streamLines: string[]; // rotating output lines
  seedLogs?: Omit<LogEntry, "id" | "timestamp">[];
  seedReports?: Omit<ReportRef, "id" | "createdAt">[];
  seedApprovals?: Omit<ApprovalRequest, "id" | "requestedAt" | "auditTrail">[];
  initialRunState?: RunState;
  readActions: string[];
  writeActions: string[];
}

/**
 * Generic mock-backed implementation of AgentSystemAdapter. Every
 * "connector" in v1 is created by calling this factory with system-specific
 * flavor data. This is the layer that proves the UI never needs to know
 * about a specific tool: swap this factory's internals for a real
 * transport and every consumer above it keeps working unmodified.
 */
export function createMockAdapter(config: MockAdapterConfig): AgentSystemAdapter {
  const id = config.descriptor.id;
  let runState: RunState = config.initialRunState ?? "idle";
  let currentTaskIdx = 0;
  let streamIdx = 0;
  let lastOutput: OutputEvent | null = null;
  const health: AgentSystemState["health"] = "ok";

  const logs: LogEntry[] = (config.seedLogs ?? []).map((l) => ({
    ...l,
    id: nextId("log"),
    timestamp: nowISO(),
  }));

  const reports: ReportRef[] = (config.seedReports ?? []).map((r) => ({
    ...r,
    id: nextId("report"),
    createdAt: nowISO(),
  }));

  const approvals: ApprovalRequest[] = (config.seedApprovals ?? []).map((a) => ({
    ...a,
    id: nextId("appr"),
    requestedAt: nowISO(),
    auditTrail: [
      { at: nowISO(), actor: "system", action: "requested" },
    ],
  }));

  const subscribers = new Set<(e: OutputEvent) => void>();

  function pushLog(level: LogLevel, message: string) {
    logs.unshift({
      id: nextId("log"),
      timestamp: nowISO(),
      level,
      agentId: id,
      message,
      sourceRef: null,
    });
    if (logs.length > 200) logs.length = 200;
  }

  function emitOutput(stream: OutputEvent["stream"], text: string) {
    const e: OutputEvent = {
      id: nextId("out"),
      agentId: id,
      timestamp: nowISO(),
      stream,
      text,
    };
    lastOutput = e;
    subscribers.forEach((cb) => cb(e));
  }

  // Background "aliveness" tick — simulates streaming output while running.
  if (typeof window !== "undefined") {
    setInterval(() => {
      if (runState !== "running") return;
      const line = config.streamLines[streamIdx % config.streamLines.length];
      streamIdx += 1;
      emitOutput("stdout", line);
      if (streamIdx % 5 === 0) {
        currentTaskIdx = (currentTaskIdx + 1) % config.taskLines.length;
        pushLog("info", `advanced task → ${config.taskLines[currentTaskIdx]}`);
      }
    }, 3200 + Math.random() * 1800);
  }

  const adapter: AgentSystemAdapter = {
    descriptor() {
      return config.descriptor;
    },

    async getState(): Promise<AgentSystemState> {
      // Reconcile persisted operator decisions before reporting pending
      // approvals — a decision must survive a page refresh.
      await ensureDecisionsLoaded();
      applyPersistedDecisions(approvals);
      return {
        id,
        name: config.descriptor.name,
        type: config.descriptor.type,
        status: config.descriptor.status,
        runState,
        currentTask:
          runState === "idle" || runState === "stopped"
            ? null
            : config.taskLines[currentTaskIdx],
        modelOrService: config.modelOrService,
        health,
        lastOutput,
        pendingApprovals: approvals.filter((a) => a.status === "pending"),
        logs: logs.slice(0, 50),
        reports,
        memoryWriteTarget: config.descriptor.obsidianWriteTarget,
        sessionIndexStatus: "current",
        connectorMode: config.descriptor.activeMode,
        commandExecution: true,
        outputKind: "mock-stream",
        statusDetail: null,
        controlledAction: null,
        capabilities: [{ kind: "status", available: true }],
        externalUrl: null,
      };
    },

    async healthCheck() {
      const ok: boolean = (health as string) !== "fail";
      return { ok, detail: `${config.descriptor.name} adapter mock: ${health}` };
    },

    async sendCommand(input: string) {
      pushLog("info", `command received: "${input}"`);
      emitOutput("system", `> ${input}`);
      if (runState === "idle" || runState === "stopped") runState = "running";
      await new Promise((r) => setTimeout(r, 400));
      emitOutput("stdout", `${config.descriptor.name} acknowledged: "${input}"`);
    },

    subscribeOutput(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    async start() {
      runState = "running";
      pushLog("info", "start requested by operator");
      emitOutput("system", "system started");
    },
    async pause() {
      runState = "paused";
      pushLog("info", "paused by operator");
      emitOutput("system", "system paused");
    },
    async resume() {
      runState = "running";
      pushLog("info", "resumed by operator");
      emitOutput("system", "system resumed");
    },
    async stop() {
      runState = "stopped";
      pushLog("warn", "stopped by operator");
      emitOutput("system", "system stopped");
    },

    async approve(approvalId, reason) {
      const a = approvals.find((x) => x.id === approvalId);
      if (!a) return;
      const decidedAt = nowISO();
      a.status = "approved";
      a.auditTrail.push({ at: decidedAt, actor: "operator", action: "approved", reason });
      persistDecision(a.agentId, a.requestedCapability, "approved", reason ?? "", decidedAt);
      pushLog("info", `approval ${approvalId} approved`);
      if (runState === "waiting-approval") runState = "running";
      const write = await vaultEngine.appendToNote(
        "Governance/approvals-log.md",
        `- ${nowISO()} — **APPROVED** ${a.requestedCapability} for ${config.descriptor.name} (${approvalId})${
          reason ? ` — reason: ${reason}` : ""
        }\n`
      );
      recordAction({
        timestamp: nowISO(),
        connectorId: id,
        actionType: `approval:${a.requestedCapability}`,
        status: write.ok ? "approved" : "brain-write-failed",
        resultSummary: reason ? `approved — ${reason}` : "approved",
      });
    },
    async reject(approvalId, reason) {
      const a = approvals.find((x) => x.id === approvalId);
      if (!a) return;
      const decidedAt = nowISO();
      a.status = "rejected";
      a.auditTrail.push({ at: decidedAt, actor: "operator", action: "rejected", reason });
      persistDecision(a.agentId, a.requestedCapability, "rejected", reason, decidedAt);
      pushLog("warn", `approval ${approvalId} rejected: ${reason}`);
      if (runState === "waiting-approval") runState = "blocked";
      const write = await vaultEngine.appendToNote(
        "Governance/approvals-log.md",
        `- ${nowISO()} — **REJECTED** ${a.requestedCapability} for ${config.descriptor.name} (${approvalId}) — reason: ${reason}\n`
      );
      recordAction({
        timestamp: nowISO(),
        connectorId: id,
        actionType: `approval:${a.requestedCapability}`,
        status: write.ok ? "rejected" : "brain-write-failed",
        resultSummary: `rejected — ${reason}`,
      });
    },

    async listReports() {
      return reports;
    },

    async saveReportToBrain(reportId) {
      const report = reports.find((r) => r.id === reportId);
      if (!report) {
        return { ok: false, path: "", createdAt: nowISO(), note: "report not found" };
      }
      const result = await vaultEngine.writeReportToGovernedFolder(report);
      if (result.ok) {
        report.savedToBrain = true;
        report.brainPath = result.path;
        pushLog("info", `report "${report.title}" saved to Brain at ${result.path}`);
      }
      return result;
    },

    readActions: config.readActions,
    writeActions: config.writeActions,
  };

  return adapter;
}
