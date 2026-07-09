// ─────────────────────────────────────────────────────────────────────────
// AGENTIC OS — CORE CONNECTOR CONTRACTS
// Every UI surface renders from these types. No agent-specific logic may
// live outside a connector implementation. UI → adapter interface → mock
// (now) / real service (later). Do not add fields here for one system only.
// ─────────────────────────────────────────────────────────────────────────

export type ConnectionMode =
  | "api"
  | "cli"
  | "mcp"
  | "webhook"
  | "filesystem"
  | "browser";

export type ConnectorStatus =
  | "connected"
  | "degraded"
  | "disconnected"
  | "mock"
  | "pending-setup";

export type RunState =
  | "idle"
  | "running"
  | "paused"
  | "blocked"
  | "waiting-approval"
  | "error"
  | "stopped";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type SystemType =
  | "agent"
  | "orchestrator"
  | "automation"
  | "memory"
  | "browser-agent"
  | "integration"
  | "governance";

// The 13 groupings the System Registry organizes every connector under,
// active or future. A connector's `category` is its display grouping; its
// `type` is its functional role in the OS (agent vs orchestrator vs ...).
export type ConnectorCategory =
  | "AI Agents"
  | "Orchestrators"
  | "Automation"
  | "Browser Agents"
  | "Knowledge / Memory"
  | "Project Management"
  | "Communication"
  | "Code / Dev Tools"
  | "Databases"
  | "File Systems"
  | "APIs / Webhooks"
  | "Governance / Proof"
  | "Monitoring / Logs";

export interface ConnectorDescriptor {
  id: string;
  name: string;
  type: SystemType;
  category: ConnectorCategory;
  connectionModes: ConnectionMode[];
  activeMode: ConnectionMode;
  status: ConnectorStatus;
  capabilities: string[];
  permissions: string[];
  lastSync: string | null;
  memoryWriteObligation: boolean; // must this system write to the Shared Brain?
  obsidianWriteTarget: string | null; // governed vault folder, e.g. "Reports/Hermes"
  /** Fields for the real connection this system will use later. Disabled in v1. */
  realConnectionFields: RealConnectionField[];
}

// ─────────────────────────────────────────────────────────────────────────
// FUTURE / PENDING CONNECTORS
// These are NOT AgentSystemAdapter implementations — no mock transport, no
// control room, no start/stop/approve behavior. They exist purely as
// registry-visible setup placeholders that prove the System Registry scales
// to a large connector catalog without any UI redesign. Promoting one to a
// real connector means: write one adapter file implementing
// AgentSystemAdapter, add one line to registry.ts, optionally add seed mock
// data — then remove its entry from future-connectors.ts. Nothing else
// changes.
// ─────────────────────────────────────────────────────────────────────────
export interface FutureConnectorDescriptor {
  id: string;
  name: string;
  category: ConnectorCategory;
  type: SystemType;
  status: "pending-setup";
  plannedConnectionModes: ConnectionMode[];
  capabilities: string[];
  notes: string;
}

// Unified shape the Sidebar / System Registry render from. Built by merging
// active adapters (isActive: true, openable control room) with future
// connector placeholders (isActive: false, detail panel only) — see
// src/lib/connectors/directory.ts.
export interface ConnectorSummary {
  id: string;
  name: string;
  category: ConnectorCategory;
  type: SystemType;
  status: ConnectorStatus;
  isActive: boolean;
  connectionModes: ConnectionMode[];
  capabilities: string[];
  notes: string | null;
}

export interface RealConnectionField {
  key: string;
  label: string;
  placeholder: string;
  kind: "url" | "path" | "secret" | "text";
}

export interface OutputEvent {
  id: string;
  agentId: string;
  timestamp: string;
  stream: "stdout" | "stderr" | "system" | "thought" | "tool-call";
  text: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  agentId: string;
  message: string;
  sourceRef: string | null;
}

export interface ReportRef {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  kind: "report" | "proof" | "summary" | "handover";
  savedToBrain: boolean;
  brainPath: string | null;
  excerpt: string;
}

export interface BrainWriteResult {
  ok: boolean;
  path: string;
  createdAt: string;
  note: string;
  requiresApproval?: boolean;
  approvalId?: string;
}

export interface ApprovalRequest {
  id: string;
  agentId: string;
  requestedCapability: string;
  context: string;
  riskLevel: RiskLevel;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  auditTrail: AuditEvent[];
}

export interface AuditEvent {
  at: string;
  actor: string;
  action: string;
  reason?: string;
}

export type WorkItemState =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "failed";

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  state: WorkItemState;
  assignedAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  history: { at: string; event: string }[];
}

export interface AgentSystemState {
  id: string;
  name: string;
  type: SystemType;
  status: ConnectorStatus;
  runState: RunState;
  currentTask: string | null;
  modelOrService: string;
  health: "ok" | "warn" | "fail";
  lastOutput: OutputEvent | null;
  pendingApprovals: ApprovalRequest[];
  logs: LogEntry[];
  reports: ReportRef[];
  memoryWriteTarget: string | null;
  sessionIndexStatus: "current" | "stale" | "missing";
  connectorMode: ConnectionMode;
  /**
   * Whether this connector currently accepts operator commands / run
   * controls. False marks a connector with no command channel yet (e.g. a live read-only
   * integration): the command input and start/pause/resume/stop controls
   * must be disabled in the UI, not merely discouraged. Generic flag, not
   * tied to any specific connector id.
   */
  commandExecution: boolean;
  /**
   * What the output panel is showing: a simulated mock transport, or a
   * real read-only status snapshot (no fabricated conversation/output).
   * The UI must never present "mock-stream" content as "live-status".
   */
  outputKind: "mock-stream" | "live-status";
  /** Structured key/value lines rendered instead of the output stream when outputKind is "live-status". */
  statusDetail: Record<string, string> | null;
  /**
   * Opt-in, explicit-submission-only controlled action surface. Null for
   * every connector by default (including read-only ones) — only an
   * adapter that has been given a specific, reviewed, single-purpose
   * override populates this. When present, the control room renders a
   * form posting free-text input to `endpoint`; nothing here is polled,
   * scheduled, or triggered automatically.
   */
  controlledAction: {
    id: string;
    label: string;
    endpoint: string;
    /** False for a fixed no-input trigger (e.g. a workflow test run) rather than a free-text prompt. Defaults true. */
    requiresInput?: boolean;
  } | null;
  /** Declared capability surface — UI renders/enables only entries with available:true. */
  capabilities: CapabilityEntry[];
  /** External URL for an "Open <system>" link, when the real service has one. Null otherwise. */
  externalUrl: string | null;
}

export type CapabilityKind =
  | "status"
  | "controlledPrompt"
  | "readOnlyData"
  | "graphRead"
  | "workflowTrigger"
  | "projectContext"
  | "blocked";

export interface CapabilityEntry {
  kind: CapabilityKind;
  available: boolean;
  reason?: string;
}

export interface AgentSystemAdapter {
  descriptor(): ConnectorDescriptor;
  getState(): Promise<AgentSystemState>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
  sendCommand(input: string): Promise<void>;
  subscribeOutput(cb: (e: OutputEvent) => void): () => void;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  approve(approvalId: string, reason?: string): Promise<void>;
  reject(approvalId: string, reason: string): Promise<void>;
  listReports(): Promise<ReportRef[]>;
  saveReportToBrain(reportId: string): Promise<BrainWriteResult>;
  readActions: string[];
  writeActions: string[];
}

// ─── Obsidian / Shared Brain specific contracts ───────────────────────────

export interface VaultNote {
  path: string;
  title: string;
  folder: string;
  updatedAt: string;
  tags: string[];
  frontmatter: Record<string, string>;
  body: string;
  backlinks: string[];
  kind: "project" | "proof" | "governance" | "session" | "handover" | "note";
}

export interface SessionIndexEntry {
  sessionNumber: string; // "SESSION-0001"
  date: string;
  agent: string;
  system: string;
  topic: string;
  sessionId: string | null;
  title: string;
  summary: string;
  relatedFiles: string[];
  obsidianLinks: string[];
  status: "open" | "closed" | "handover-pending";
  nextAction: string;
  handover: string | null;
}

export interface HandoverRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string | null;
  createdAt: string;
  reason: string;
  contextSummary: string;
  obsidianPath: string;
}

export interface ObsidianAdapter extends AgentSystemAdapter {
  listVaultNotes(): Promise<VaultNote[]>;
  readNote(path: string): Promise<VaultNote | null>;
  searchNotes(query: string): Promise<VaultNote[]>;
  createNote(note: Omit<VaultNote, "backlinks">): Promise<BrainWriteResult>;
  appendToNote(path: string, content: string): Promise<BrainWriteResult>;
  updateFrontmatter(
    path: string,
    frontmatter: Record<string, string>
  ): Promise<BrainWriteResult>;
  followBacklinks(path: string): Promise<VaultNote[]>;
  extractProjectNotes(): Promise<VaultNote[]>;
  extractSourceProofNotes(): Promise<VaultNote[]>;
  writeReportToGovernedFolder(report: ReportRef): Promise<BrainWriteResult>;
  createSessionRegistryEntry(
    entry: Omit<SessionIndexEntry, "sessionNumber">
  ): Promise<BrainWriteResult>;
  readPreviousSessions(query: {
    byAgent?: string;
    byTopic?: string;
    bySessionNumber?: string;
  }): Promise<SessionIndexEntry[]>;
  writeDailyContinuityFile(content: string): Promise<BrainWriteResult>;
  writeWeeklyContinuityFile(content: string): Promise<BrainWriteResult>;
  createHandover(
    record: Omit<HandoverRecord, "id" | "createdAt" | "obsidianPath">
  ): Promise<BrainWriteResult>;
}
