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

interface PersistedApprovalDecision {
  approvalId: string;
  connectorId: string;
  status: "approved" | "rejected";
  reason: string;
  decidedAt: string;
  actor: "operator";
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

  const approvals: ApprovalRequest[] = (config.seedApprovals ?? []).map((a, index) => ({
    ...a,
    id: `${id}-approval-${index + 1}`,
    requestedAt: nowISO(),
    auditTrail: [
      { at: nowISO(), actor: "system", action: "requested" },
    ],
  }));

  const subscribers = new Set<(e: OutputEvent) => void>();

  function applyDecision(decision: PersistedApprovalDecision) {
    const approval = approvals.find((candidate) => candidate.id === decision.approvalId);
    if (!approval) return;
    approval.status = decision.status;
    if (!approval.auditTrail.some((event) => event.at === decision.decidedAt && event.action === decision.status)) {
      approval.auditTrail.push({
        at: decision.decidedAt,
        actor: decision.actor,
        action: decision.status,
        reason: decision.reason,
      });
    }
  }

  async function syncApprovalDecisions() {
    if (typeof window === "undefined" || approvals.length === 0) return;
    const response = await fetch(`/api/approvals?connectorId=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`approval sync failed (${response.status})`);
    const data = (await response.json()) as { decisions: PersistedApprovalDecision[] };
    data.decisions.forEach(applyDecision);
  }

  async function persistDecision(
    approval: ApprovalRequest,
    status: "approved" | "rejected",
    reason: string
  ): Promise<PersistedApprovalDecision> {
    if (typeof window === "undefined") throw new Error("approval decisions require the operator UI");
    const response = await fetch("/api/approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvalId: approval.id,
        connectorId: id,
        requestedCapability: approval.requestedCapability,
        context: approval.context,
        riskLevel: approval.riskLevel,
        requestedAt: approval.requestedAt,
        status,
        reason,
      }),
    });
    const data = (await response.json()) as {
      ok: boolean;
      decision?: PersistedApprovalDecision;
      error?: string;
    };
    if (!response.ok || !data.ok || !data.decision) {
      throw new Error(data.error ?? `approval persistence failed (${response.status})`);
    }
    return data.decision;
  }

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
      await syncApprovalDecisions();
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
      if (!a || a.status !== "pending") return;
      const decision = await persistDecision(a, "approved", reason?.trim() || "approved by operator");
      applyDecision(decision);
      if (decision.status !== "approved") return;
      pushLog("info", `approval ${approvalId} approved`);
      if (runState === "waiting-approval") runState = "running";
      const write = await vaultEngine.appendToNote(
        "Governance/approvals-log.md",
        `- ${nowISO()} — **APPROVED** ${a.requestedCapability} for ${config.descriptor.name} (${approvalId})${
          reason ? ` — reason: ${reason}` : ""
        }\n`
      );
      recordAction({
        timestamp: decision.decidedAt,
        connectorId: id,
        actionType: `approval:${a.requestedCapability}`,
        status: "approved",
        resultSummary: write.ok ? `approved — ${decision.reason}` : `approved — ${decision.reason}; Brain write failed`,
      }, { persist: false });
    },
    async reject(approvalId, reason) {
      const a = approvals.find((x) => x.id === approvalId);
      const trimmedReason = reason.trim();
      if (!a || a.status !== "pending") return;
      if (!trimmedReason) throw new Error("rejection reason is required");
      const decision = await persistDecision(a, "rejected", trimmedReason);
      applyDecision(decision);
      if (decision.status !== "rejected") return;
      pushLog("warn", `approval ${approvalId} rejected: ${decision.reason}`);
      if (runState === "waiting-approval") runState = "blocked";
      const write = await vaultEngine.appendToNote(
        "Governance/approvals-log.md",
        `- ${decision.decidedAt} — **REJECTED** ${a.requestedCapability} for ${config.descriptor.name} (${approvalId}) — reason: ${decision.reason}\n`
      );
      recordAction({
        timestamp: decision.decidedAt,
        connectorId: id,
        actionType: `approval:${a.requestedCapability}`,
        status: "rejected",
        resultSummary: write.ok ? `rejected — ${decision.reason}` : `rejected — ${decision.reason}; Brain write failed`,
      }, { persist: false });
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
