"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type {
  AcfIdentityVerificationState,
  AcfMessageReadModel,
  AcfTeamRoomRun,
  AcfTeamRoomSnapshot,
} from "@/lib/acf/types";
import { deriveTeamRoomRoster, exactParticipantMessages, deriveCanonicalTurnState, type TeamRosterAgent } from "@/lib/acf/dynamic-roster";
import { acfReadPresentation, type AcfRefreshFailureKind } from "@/lib/acf/freshness";
import {
  buildTeamRoomDiscussion,
  collapseCurrentFocus,
  focusParticipant,
  modeDefinition,
  resolveFocusedRole,
  TEAM_ROOM_MODES,
  type TeamRoomFocusPreference,
  type TeamRoomMode,
  type TeamRoomParticipantCard,
  type TeamRoomDiscussionModel,
} from "@/lib/acf/team-room-view-model";
import { COCKPIT_AGENT_TARGETS, getCockpitAgentByApiId, type CockpitSessionSummary } from "@/lib/cockpit/agent-registry";
import {
  deriveParticipantReadiness,
  roleClassForAgent,
  type DependencyReadinessObservation,
  type ParticipantReadinessResult,
  type RuntimeReadinessObservation,
  type SessionReadinessObservation,
} from "@/lib/acf/participant-readiness";
import { FocusablePanel, PanelFocusButton, usePanelFocus } from "@/components/shell/PanelFocus";
import { OperatorDeck, TeamOpenSessions, agentLabel, refusalText } from "@/components/team-room/OperatorDeck";
import { RosterTeamComposer, type TeamDraftChoice } from "@/components/team-room/RosterTeamComposer";
import { FreeRoomPanel } from "@/components/team-room/FreeRoomPanel";
import { AcfReplyPanel } from "@/components/team-room/AcfReplyPanel";
import { activityFromAcf, type AcfActivity } from "@/components/team-room/acf-activity";
import { deriveVisibleParticipants } from "@/lib/acf/visible-participants";
import { ROOM_VIEW_KEY, roomShellKey, parseRoomView, parseShellView, verifySavedRun,
  type StoredRoomView, type StoredShellView } from "@/lib/acf/team-room-rehydration";

const POLL_MS = 5_000;
const STALE_AFTER_MS = 15_000;
const READINESS_POLL_MS = 5_000;
const READINESS_STALE_AFTER_MS = 20_000;

type ReadinessAgentId = "hermes" | "claude-code" | "openclaw" | "antigravity" | "gemini" | "codex";

interface RuntimeTruthClient {
  targetId: ReadinessAgentId;
  installedVersion: string | null;
  runningServiceVersion: string | null;
  lastVerifiedAt: string;
}

interface ConnectorStatusClient {
  status?: "connected" | "degraded" | "disconnected" | "unknown";
  lastCheckedAt?: string;
  errors?: string[];
  pidAlive?: boolean;
  gatewayReachable?: boolean;
  healthReachable?: boolean;
}

interface AgentOperationalEvidence {
  runtime: RuntimeReadinessObservation | null;
  requiredTransport: DependencyReadinessObservation | null;
  session: SessionReadinessObservation | null;
}

type OperationalEvidenceMap = Record<string, AgentOperationalEvidence>; // agent pool + "participant:<handle>" slots

function normalizedReadinessAgentId(agentId: string | null): ReadinessAgentId | null {
  if (agentId === "agy" || agentId === "antigravity") return "antigravity";
  if (agentId === "hermes" || agentId === "claude-code" || agentId === "openclaw" || agentId === "gemini" || agentId === "codex") return agentId;
  return null;
}

function connectorStatusEndpoint(agentId: ReadinessAgentId): string {
  if (agentId === "claude-code") return "/api/connectors/fcc/status";
  if (agentId === "antigravity") return "/api/connectors/agy/status";
  return `/api/connectors/${agentId}/status`;
}

function observationIsStale(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const at = Date.parse(value);
  return Number.isNaN(at) || now - at > READINESS_STALE_AFTER_MS;
}

function runtimeObservation(
  agentId: ReadinessAgentId,
  truth: RuntimeTruthClient | null,
  status: ConnectorStatusClient | null,
  observedAt: number
): { runtime: RuntimeReadinessObservation; transport: DependencyReadinessObservation | null } {
  const exists = truth ? (truth.installedVersion || truth.runningServiceVersion ? true : null) : null;
  const statusStale = status ? observationIsStale(status.lastCheckedAt, observedAt) : false;
  const truthStale = truth ? observationIsStale(truth.lastVerifiedAt, observedAt) : false;

  if (agentId === "claude-code") {
    const runtime: RuntimeReadinessObservation = {
      exists,
      reachable: truth?.installedVersion ? true : null,
      stale: truthStale,
      error: null,
      source: "GET /api/cockpit/runtime-truth · Claude launcher --version",
      observedAt,
    };
    const transport: DependencyReadinessObservation = {
      state: status?.status ?? "unknown",
      stale: statusStale,
      detail: status?.errors?.length ? status.errors.join("; ") : status?.status === "degraded" ? "FCC transport reports degraded" : null,
      source: "GET /api/connectors/fcc/status · transport dependency only",
      observedAt,
    };
    return { runtime, transport };
  }

  const reachable = status?.status === "connected"
    ? true
    : status?.status === "disconnected"
      ? false
      : null;
  return {
    runtime: {
      exists,
      reachable,
      stale: truthStale || statusStale,
      error: status?.errors?.length
        ? status.errors.join("; ")
        : status?.status === "unknown" ? "MC container cannot verify host service; UNKNOWN is not OFFLINE" : null,
      source: `GET ${connectorStatusEndpoint(agentId)} + /api/cockpit/runtime-truth`,
      observedAt,
    },
    transport: null,
  };
}

function readinessClass(readiness: ParticipantReadinessResult): string {
  return `acf-readiness-badge acf-readiness-${readiness.tone}`;
}

function ReadinessBadge({ readiness }: { readiness: ParticipantReadinessResult }) {
  return (
    <span className={readinessClass(readiness)} title={readiness.explanation}>
      <span className="acf-readiness-dot" />
      {readiness.label}
    </span>
  );
}

function ReadinessEvidenceLine({ readiness }: { readiness: ParticipantReadinessResult }) {
  return (
    <span className="acf-readiness-evidence">
      runtime {readiness.runtimeExistence.toLowerCase()} / {readiness.runtimeReachability.toLowerCase()}
      <span aria-hidden="true"> · </span>
      ACF {readiness.acfConnection.toLowerCase().replace("_", " ")}
      <span aria-hidden="true"> · </span>
      session {readiness.sessionState.toLowerCase()}
      {readiness.transportState !== "NOT_APPLICABLE" && (
        <>
          <span aria-hidden="true"> · </span>
          transport {readiness.transportState.toLowerCase()}
        </>
      )}
    </span>
  );
}

function verificationClass(state: AcfIdentityVerificationState): string {
  if (state === "VERIFIED") return "text-ok bg-ok/10 border-ok/20";
  if (state === "CLAIMED") return "text-warn bg-warn/10 border-warn/20";
  return "text-muted bg-panel-2 border-border";
}

function VerificationBadge({ state }: { state: AcfIdentityVerificationState }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] mono ${verificationClass(state)}`}>{state}</span>;
}

function labelForAgent(agentId: string | null): string {
  switch (agentId) {
    case "claude-code": return "Claude Code";
    case "hermes": return "Hermes";
    case "openclaw": return "OpenClaw";
    case "agy": return "AntiGravity 2.0";
    case "antigravity": return "AntiGravity 2.0";
    case "gemini": return "Gemini";
    case "codex": return "Codex";
    default: return agentId ?? "UNBOUND";
  }
}

function monogramForAgent(agentId: string | null): string {
  switch (agentId) {
    case "claude-code": return "CC";
    case "hermes": return "H";
    case "openclaw": return "OC";
    case "agy":
    case "antigravity": return "AG";
    case "gemini": return "G";
    case "codex": return "CX";
    default: return "?";
  }
}

function dataAgent(agentId: string | null): string | undefined {
  if (agentId === "agy") return "antigravity";
  return agentId ?? undefined;
}

function formatClock(value: string | null): string {
  if (!value) return "time not exported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function messageRelation(card: TeamRoomParticipantCard): string {
  const lineage = card.lineage;
  if (!card.latestReply || !lineage) return "No participant reply exported yet";
  if (lineage.status === "PROVEN") return `Replying to ${lineage.replyingToRole} · ${lineage.inReplyTo}`;
  if (lineage.status === "UNKNOWN_NOT_EXPORTED") return `Lineage UNKNOWN / NOT EXPORTED · ${lineage.inReplyTo}`;
  return `To ${card.latestReply.to}`;
}

function blockerForRole(run: AcfTeamRoomRun | null, role: string): string | null {
  if (!run) return null;
  const blocked = run.taskState.filter((task) =>
    task.role === role && (task.taskState === "NEEDS_DECISION" || Boolean(task.needsDecisionReason))
  );
  if (blocked.length === 0) return null;
  return blocked.map((task) => task.needsDecisionReason || `${task.taskId} is ${task.taskState}`).join(" | ");
}

function readinessForParticipant(
  card: TeamRoomParticipantCard,
  run: AcfTeamRoomRun | null,
  acfReadStale: boolean,
  operationalEvidence: OperationalEvidenceMap
): ParticipantReadinessResult {
  const targetId = normalizedReadinessAgentId(card.agentId);
  // D8: two independent sessions of one agent must never overwrite each other.
  const evidence = targetId ? operationalEvidence[`participant:${card.role}`] ?? null : null;
  return deriveParticipantReadiness({
    agentId: card.agentId,
    role: card.role,
    roleClass: roleClassForAgent(card.agentId),
    acfRunPresent: Boolean(run),
    acfBound: Boolean(card.agentId && card.sessionRef),
    acfSessionRef: card.sessionRef,
    acfReadStale,
    blocker: blockerForRole(run, card.role),
    runtime: evidence?.runtime ?? null,
    requiredTransport: evidence?.requiredTransport ?? null,
    session: evidence?.session ?? null,
  });
}

function shellReadiness(
  agentId: string,
  operationalEvidence: OperationalEvidenceMap
): ParticipantReadinessResult {
  const evidence = operationalEvidence[agentId as ReadinessAgentId];
  return deriveParticipantReadiness({
    agentId: agentId === "antigravity" ? "agy" : agentId,
    role: agentId === "antigravity" ? "ORCHESTRATOR" : "WORKER",
    roleClass: agentId === "antigravity" ? "ORCHESTRATOR" : "WORKER",
    acfRunPresent: false,
    acfBound: false,
    acfSessionRef: null,
    acfReadStale: false,
    blocker: null,
    runtime: evidence?.runtime ?? null,
    requiredTransport: evidence?.requiredTransport ?? null,
    session: null,
  });
}

function ParticipantMark({ card, compact = false }: { card: TeamRoomParticipantCard; compact?: boolean }) {
  return (
    <span className={compact ? "acf-agent-orb acf-agent-orb-sm" : "acf-agent-orb"} data-agent={dataAgent(card.agentId)}>
      {monogramForAgent(card.agentId)}
    </span>
  );
}

function ParticipantCard({
  card,
  readiness,
  focused,
  onFocus,
}: {
  card: TeamRoomParticipantCard;
  readiness: ParticipantReadinessResult;
  focused: boolean;
  onFocus: () => void;
}) {
  const message = card.latestReply;
  return (
    <button
      type="button"
      data-agent={dataAgent(card.agentId)}
      className={`acf-participant-card text-left ${focused ? "acf-participant-card-under-focus" : ""}`}
      onClick={onFocus}
      aria-label={`Focus ${card.role}`}
    >
      <div className="flex items-center gap-2.5">
        <ParticipantMark card={card} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="acf-participant-name font-semibold truncate">{labelForAgent(card.agentId)}</span>
            <span className="text-[10px] font-medium" style={{ color: "var(--agent-primary)" }}>({card.role})</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            <ReadinessBadge readiness={readiness} />
            <VerificationBadge state={card.identityVerificationState} />
            {readiness.roleClass === "ORCHESTRATOR" && (
              <span className="acf-orchestrator-role-badge">ORCHESTRATOR</span>
            )}
          </div>
        </div>
        <span className="mono text-[10px] text-muted">{card.latestTurn ? `T${card.latestTurn}` : "—"}</span>
      </div>

      <div className="mt-2">
        <ReadinessEvidenceLine readiness={readiness} />
        <div className="mt-1 text-[10px] leading-4 text-muted/90">{readiness.explanation}</div>
      </div>

      <div className="mt-3 min-h-20">
        {focused ? (
          <div className="rounded-md border border-border/60 bg-background/30 px-3 py-4 text-xs text-muted">
            Focused reply is enlarged in the room.
          </div>
        ) : message ? (
          <>
            <div className="acf-card-reply-clamp text-sm leading-5 text-foreground/90">{message.body}</div>
            <div className="mt-2 text-[10px] text-muted">{messageRelation(card)}</div>
          </>
        ) : (
          <div className="text-xs text-muted">No message from this participant is exported yet.</div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted">
        <span>{message ? formatClock(message.at) : "No reply timestamp"}</span>
        <span>{card.previousReplyCount > 0 ? `+${card.previousReplyCount} previous` : "latest only"}</span>
      </div>
    </button>
  );
}

function FocusedParticipant({
  card,
  readiness,
  onCollapse,
}: {
  card: TeamRoomParticipantCard;
  readiness: ParticipantReadinessResult;
  onCollapse: () => void;
}) {
  const message = card.latestReply;
  return (
    <section
      data-agent={dataAgent(card.agentId)}
      className="acf-focused-speaker"
      aria-label={`Focused latest reply from ${card.role}`}
    >
      <header className="flex items-center gap-3 border-b border-border/70 pb-3">
        <ParticipantMark card={card} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="acf-focused-participant-name text-lg font-semibold">{labelForAgent(card.agentId)}</h3>
            <span className="text-xs font-semibold" style={{ color: "var(--agent-primary)" }}>{card.role}</span>
            {readiness.roleClass === "ORCHESTRATOR" && <span className="acf-orchestrator-role-badge">ORCHESTRATOR</span>}
            <ReadinessBadge readiness={readiness} />
            <span className="acf-focus-badge">LATEST TURN · CURRENT FOCUS</span>
          </div>
          <div className="mt-1"><ReadinessEvidenceLine readiness={readiness} /></div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>session {card.sessionRef ?? "UNKNOWN"}</span>
            <span>·</span>
            <span>{message ? `sequence ${message.sequence}` : "no reply"}</span>
            <span>·</span>
            <span>{message ? formatClock(message.at) : "time not exported"}</span>
          </div>
        </div>
        <button type="button" onClick={onCollapse} className="mc-button mc-button-secondary mc-button-sm">
          Collapse
        </button>
      </header>

      <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
        {message ? (
          <>
            <div className="acf-focused-reply whitespace-pre-wrap">{message.body}</div>
            <div className="mt-4 rounded-lg border border-border/70 bg-background/35 p-3 text-xs">
              <div className="font-semibold text-foreground/85">Conversation relation</div>
              <div className="mt-1 text-muted">{messageRelation(card)}</div>
              {message.origin && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-[10px] mono text-muted">
                  <div>turn={message.origin.turnId ?? "NOT_EXPORTED"}</div>
                  <div>via={message.origin.via ?? "NOT_EXPORTED"}</div>
                  <div>agent={message.origin.agentId ?? "NOT_EXPORTED"}</div>
                  <div>session={message.origin.sessionRef ?? "NOT_EXPORTED"}</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted">No participant message is available to focus.</div>
        )}
      </div>
    </section>
  );
}

function PreparedMode({ mode }: { mode: TeamRoomMode }) {
  const definition = modeDefinition(mode);
  return (
    <section className="acf-prepared-mode">
      <div className="text-xs font-semibold tracking-[0.12em] text-muted">TEAM ROOM MODE</div>
      <h2 className="mt-2 text-xl font-semibold">{definition.label}</h2>
      <div className="mt-3 inline-flex rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-semibold text-warn">
        PREPARED / NOT CONNECTED
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">{definition.description}</p>
      <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">
        Mission Control does not fabricate a room result for this mode. A real ACF backend contract must exist before it can be labelled live.
      </p>
    </section>
  );
}

const SHELL_AGENTS = deriveTeamRoomRoster(COCKPIT_AGENT_TARGETS);
type ShellAgentId=string;
type ShellReadingSurface = "live" | "per-agent" | "full";

function shellSessionsFor(agentId: ShellAgentId, sessions: CockpitSessionSummary[]): CockpitSessionSummary[] {
  return sessions.filter((session) => session.targetId === agentId);
}

function ShellAgentCard({
  agent,
  sessions,
  readiness,
  focused,
  onFocus,
  runCard = null,
  speaking = false,
  activity,
  membershipKind = "SHELL",
}: {
  agent: TeamRosterAgent;
  sessions: CockpitSessionSummary[];
  readiness: ParticipantReadinessResult;
  focused: boolean;
  onFocus: () => void;
  runCard?: TeamRoomParticipantCard | null;
  speaking?: boolean;
  activity: AcfActivity;
  membershipKind?: "DRAFT" | "CONFIRMED" | "SHELL";
}) {
  const observed = shellSessionsFor(agent.id, sessions);
  const latest = observed[0] ?? null;
  return (
    <button
      type="button"
      data-agent={agent.id}
      className={"acf-shell-agent-card " + (focused ? "acf-shell-agent-card-focused " : "") + (speaking ? "acf-shell-agent-speaking" : "")}
      onClick={onFocus}
      aria-label={"Focus " + (agent.id === "antigravity" ? "AntiGravity 2.0" : agent.label)}
    >
      <div className="acf-shell-card-head">
        <span className="acf-shell-agent-orb">{agent.monogram}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="acf-shell-agent-name truncate text-base font-semibold">{agent.id === "antigravity" ? "AntiGravity 2.0" : agent.label}</span>
          </span>
          {readiness.roleClass === "ORCHESTRATOR" && <span className="acf-orch-subtitle"><span aria-hidden="true">♛</span> ORCHESTRATOR</span>}
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {membershipKind === "DRAFT" ? <span className="rounded border border-cyan-400/60 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">DRAFT · nog niet in ACF-run</span> : <ReadinessBadge readiness={readiness} />}
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted">
              {membershipKind === "DRAFT" ? "ALLEEN SELECTIE · GEEN MODELTURN" : runCard ? `ACF BOUND · ${runCard.role}` : "VISUEEL VENSTER · GEEN ACF-LID GECONSTATEERD"}
            </span>
          </span>
        </span>
        <span className="acf-shell-focus-pill" data-testid={"shell-focus-pill-"+agent.id}>{focused ? "IN FOCUS" : "FOCUS"}</span>
        <PanelFocusButton asSpan className="acf-card-max" />
      </div>
      <div className="acf-shell-card-body">
        <ReadinessEvidenceLine readiness={readiness} />
        <span className="mc-acf-activity" data-activity={activity.state} data-testid={"acf-activity-"+agent.id}
          title={activity.evidence}><span aria-hidden="true">●</span>{activity.label}</span>
        <div className="mt-1 text-[10px] leading-4 text-muted/90">{readiness.explanation}</div>
        <div className="mt-3">
        {agent.id === "hermes" && (
          <p className="mb-2 text-[11px] text-warn">Hermes bewijsgrenzen: VPS hostservice ≠ MC runtime ≠ modelantwoord ≠ ACF sessiegeschiktheid ≠ bevestigd ACF-lid. De actuele ACF-status staat in het rooster.</p>
        )}
        {membershipKind === "DRAFT" ? (
          <p className="text-xs text-muted">Conceptdeelnemer. Controleer de sessie en bevestig via Team samenstellen; de bestaande run blijft onveranderd.</p>
        ) : runCard ? (
          <>
            <div className="text-sm font-medium text-foreground/90">
              {runCard.latestReply ? `Beurt ${runCard.latestTurn ?? "?"} · ${runCard.role} → ${runCard.latestReply.to}` : `${runCard.role} · nog geen beurt`}
            </div>
            {runCard.latestReply && (
              <div className="acf-shell-card-snippet mt-2 text-xs leading-5 text-foreground/80">
                {runCard.latestReply.body}
              </div>
            )}
          </>
        ) : latest ? (
          <>
            <div className="text-sm font-medium text-foreground/90">
              {observed.length} Mission Control session{observed.length === 1 ? "" : "s"} observed
            </div>
            <div className="mt-2 text-xs leading-5 text-muted">
              Latest: {latest.displayName} · {latest.status}{latest.active ? " · active session" : ""}
            </div>
          </>
        ) : (
          <div className="text-xs leading-5 text-muted">
            No Mission Control session is currently observed for this agent. The card stays available as the Team Room shell.
          </div>
        )}
        </div>
      </div>
    </button>
  );
}

function TeamRoomShell({
  sessions,
  draftSelected,
  participantReadinessByRole,
  readLabel,
  operationalEvidence,
  discussion = null,
  run = null,
  stale = false,
  runId = null,
  controls = null,
  selection = null,
  freeRoom = null,
}: {
  sessions: CockpitSessionSummary[];
  draftSelected: string[];
  participantReadinessByRole: Map<string,ParticipantReadinessResult>;
  readLabel: string;
  operationalEvidence: OperationalEvidenceMap;
  discussion?: TeamRoomDiscussionModel | null;
  run?: AcfTeamRoomRun | null;
  stale?: boolean;
  runId?: string | null;
  controls?: React.ReactNode;
  selection?: React.ReactNode;
  freeRoom?: React.ReactNode;
}) {
  const visible = deriveVisibleParticipants(SHELL_AGENTS, (discussion?.participants ?? []).map(p=>({
    role:p.role,agentId:p.agentId,sessionRef:p.sessionRef
  })),draftSelected);
  // Four visual windows on the registry/session pool, NOT four fixed ACF seats.
  // All six registered agents remain addressable through the slot switcher.
  const [visualSlotOffset, setVisualSlotOffset] = useState(0);
  const visualSlots = useMemo(() => Array.from({length:Math.min(4,SHELL_AGENTS.length)},(_,i)=>
    SHELL_AGENTS[(visualSlotOffset+i)%SHELL_AGENTS.length]),[visualSlotOffset]);
  const speaker = discussion?.participants.find(p=>p.role===discussion.latestParticipantRole) ?? null;
  const speakerAgent = SHELL_AGENTS.find(agent=>agent.apiAgentId===speaker?.agentId || agent.id===speaker?.agentId) ?? null;
  const speakerKey = !draftSelected.length ? speakerAgent?.id ?? null : null;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [shellRestored, setShellRestored] = useState(false);
  const latestMessageId = discussion?.latestParticipantMessage?.messageId ?? null;
  useEffect(() => {
    // A refresh is not a new reply: never overwrite the operator's restored focus.
    if (!shellRestored || !latestMessageId || !speakerKey) return;
    if (initialSpeaker.current === latestMessageId)return;
    initialSpeaker.current = latestMessageId;
    setFocusedId(speakerKey);
  }, [latestMessageId, speakerKey, shellRestored]);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [readingSurface, setReadingSurface] = useState<ShellReadingSurface>("live");
  const initialSpeaker = useRef(latestMessageId);
  useEffect(() => {
    try {
      const saved = parseShellView(window.localStorage.getItem(roomShellKey(runId)));
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted user viewport on initial mount
        setVisualSlotOffset(saved.visualSlotOffset);
        setFocusedId(saved.focusedId);
        setReadingSurface(saved.readingSurface);
      }
    } catch { /* storage disabled: normal in-memory controls still work */ }
    setShellRestored(true);
  }, [runId]);
  useEffect(() => {
    if (!shellRestored)return;
    const state:StoredShellView = {version:1,visualSlotOffset,focusedId,readingSurface};
    try { window.localStorage.setItem(roomShellKey(runId),JSON.stringify(state)); } catch { /* no storage */ }
  }, [shellRestored,runId,visualSlotOffset,focusedId,readingSurface]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!previewPlaying || prefersReducedMotion || draftSelected.length || !visualSlots.length) return;
    const timer = window.setInterval(() => {
      setFocusedId((current) => {
        if (current === null) return visualSlots[0]?.id ?? null;
        const index = visualSlots.findIndex(agent=>agent.id===current);
        return visualSlots[(index + 1) % visualSlots.length]?.id ?? current;
      });
    }, 3_500);
    return () => window.clearInterval(timer);
  }, [previewPlaying, prefersReducedMotion, visualSlots, draftSelected.length]);

  const focusedAgentId = focusedId ?? speakerKey ?? visualSlots[0]?.id ?? null;
  const focusedVisible = visible.find(card=>card.id===focusedAgentId) ?? null;
  const focusedAgent = SHELL_AGENTS.find(agent=>agent.id===focusedAgentId) ?? null;
  const focusedSessions = focusedAgent ? shellSessionsFor(focusedAgent.id, sessions) : [];
  const latestFocusedSession = focusedSessions[0] ?? null;
  const focusedReadiness = focusedVisible?.kind==="CONFIRMED" && focusedVisible.role
    ? participantReadinessByRole.get(focusedVisible.role) ?? null
    : focusedAgent ? shellReadiness(focusedAgent.id, operationalEvidence) : null;
  const focusedRunCard = focusedVisible?.kind === "CONFIRMED"
    ? discussion?.participants.find(p=>p.role===focusedVisible.role) ?? null : null;
  const readingPaneMax = usePanelFocus().focusedPanelId === "acf-reading-pane";

  const focusAgent = (agentId: string) => {
    setPreviewPlaying(false);
    setFocusedId(agentId);
    setReadingSurface("live");
  };

  return (
    <section className="acf-shell">
      <div className="acf-shell-preview-bar">
        <div className="min-w-0">
          <div className="acf-shell-preview-title">
            <span className="acf-shell-preview-icon">▶</span>
            INTERACTION PREVIEW
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {draftSelected.length ? `${visible.length} DRAFT-deelnemers · alleen lokale keuze, de ACF-run is onveranderd.` : discussion ? `${visible.length} bevestigde ACF-deelnemers · focus volgt alleen werkelijk geëxporteerde berichten.` : "Selecteer agents in Team samenstellen. Er zijn nog geen canonieke ACF-deelnemers."}
          </div>
        </div>
        <button
          type="button"
          aria-pressed={previewPlaying && !prefersReducedMotion}
          disabled={prefersReducedMotion || Boolean(draftSelected.length) || !visualSlots.length}
          title={prefersReducedMotion ? "Automatic focus preview is disabled by reduced-motion preference." : undefined}
          onClick={() => setPreviewPlaying((playing) => !playing)}
          className={"mc-button " + (previewPlaying && !prefersReducedMotion ? "mc-button-primary" : "mc-button-secondary")}
        >
          {prefersReducedMotion ? "Reduced motion · manual focus" : previewPlaying ? "Stop focus preview" : "Play focus preview"}
        </button>
      </div>

      <section className="mx-4 mt-2 rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-xs"
        aria-label="Regie en ACF coördinatiebewijs" data-testid="team-room-coordination-status">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <strong>Operationele regie: Dennis (direct)</strong>
          <span>AGY: {run?.leaseHolder === "ANTIGRAVITY" ? "ACF-lease vermeldt ANTIGRAVITY; native AGY-besturing niet bevestigd" : "niet ingeschakeld als Team Room-orchestrator"}</span>
          <span className="text-muted">ACF-lease: {stale ? "ONBEKEND (verouderde status)" : run?.leaseHolder ?? "geen run / niet geëxporteerd"}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted">Directe agentcommunicatie blijft onafhankelijk van AGY. Een verbonden AGY-endpoint bewijst geen veilige besturingsoverdracht; die verschijnt pas als de bestaande executors, ACF-leases en sessiecontinuïteit dit ondersteunen.</p>
      </section>

      <section className="mc-team-original-five" aria-label="Originele Team Room met vier agentvensters en centraal leesvenster" data-testid="original-five-card-room">
        <header className="mc-team-visual-topline">
          <div>
            <h2 className="text-base font-semibold">Team Room · agentvensters & focus</h2>
            <p className="text-xs text-muted">Vier vrije vensters op de geregistreerde agentpool · geen vaste ACF-lidmaatschapszetels. Kies een kaart voor het centrale leesvenster.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Vensters {visualSlots.map(a=>a.label).join(" · ")}</span>
            <button type="button" data-testid="visual-agent-switch" className="mc-button mc-button-secondary mc-button-sm"
              disabled={SHELL_AGENTS.length<=4}
              onClick={()=>{setPreviewPlaying(false);setVisualSlotOffset(previous=>(previous+4)%SHELL_AGENTS.length);setFocusedId(null);}}>
              Andere agents
            </button>
          </div>
        </header>
          <div className="mc-team-visual-canvas">
          <div className="acf-shell-grid">
            {visualSlots.map((agent) => {
              const member=visible.find(card=>card.id===agent.id) ?? null;
              const runCard=member?.kind==="CONFIRMED" ? discussion?.participants.find(p=>p.role===member.role) ?? null : null;
              const activity=activityFromAcf(run,runCard?.role ?? null,stale);
              return <FocusablePanel
                key={agent.id}
                id={`acf-illustrated-visual-${agent.id}`}
                label={`${agent.label} · visual agent/session viewport`}
                className="acf-illustrated-focus-panel"
                inlineControls
              >
                <ShellAgentCard agent={agent} sessions={sessions}
                  readiness={runCard && member?.role
                    ? participantReadinessByRole.get(member.role) ?? shellReadiness(agent.id,operationalEvidence)
                    : shellReadiness(agent.id,operationalEvidence)}
                  membershipKind={member?.kind==="DRAFT" ? "DRAFT" : "SHELL"}
                  activity={activity}
                  focused={focusedAgentId===agent.id}
                  onFocus={()=>focusAgent(agent.id)}
                  runCard={runCard}
                  speaking={activity.state==="RUNNING"} />
              </FocusablePanel>;
            })}

          </div>

          {focusedAgent && (
            <div className="acf-shell-focus-overlay">
              <motion.section
                data-agent={focusedAgent.id}
                className={"acf-shell-focus-card" + (activityFromAcf(run,focusedRunCard?.role ?? null,stale).state === "RUNNING" ? " acf-shell-focus-speaking" : "") + (readingPaneMax ? " acf-shell-focus-card-max" : "")}
                initial={prefersReducedMotion ? false : { scale: 0.985, y: 8, opacity: 0.96 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              >
                <header className="acf-shell-focus-head">
                  <PanelFocusButton id="acf-reading-pane" label={`Leesvenster · ${focusedAgent.label}`} className="acf-reading-max" />
                  <span className="acf-shell-focus-orb">{focusedAgent.monogram}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="acf-shell-focus-name text-xl font-semibold">{focusedAgent.id === "antigravity" ? "AntiGravity 2.0" : focusedAgent.label}</h2>
                      {focusedReadiness?.roleClass === "ORCHESTRATOR" && <span className="acf-orchestrator-role-badge">ORCHESTRATOR</span>}
                      {focusedReadiness && <ReadinessBadge readiness={focusedReadiness} />}
                      <span className="mc-acf-activity" data-activity={activityFromAcf(run,focusedRunCard?.role ?? null,stale).state}
                        title={activityFromAcf(run,focusedRunCard?.role ?? null,stale).evidence}>
                        {activityFromAcf(run,focusedRunCard?.role ?? null,stale).label}
                      </span>
                      <span className="acf-shell-focus-active">{focusedReadiness?.roleClass === "ORCHESTRATOR" ? "ORCHESTRATOR VIEW" : "AGENT VIEW"}</span>
                    </div>
                    {focusedReadiness?.roleClass === "ORCHESTRATOR" && <div className="acf-orch-subtitle acf-orch-subtitle-lg"><span aria-hidden="true">♛</span> ORCHESTRATOR</div>}
                    <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-muted">
                      {focusedRunCard ? `ACF team-run · rol ${focusedRunCard.role}` : focusedReadiness?.roleClass === "ORCHESTRATOR"
                        ? "Mission Control runtime/session observation · no ACF orchestration claim"
                        : "Mission Control runtime/session observation · not yet ACF participant"}
                    </div>
                    {focusedReadiness && <div className="mt-1"><ReadinessEvidenceLine readiness={focusedReadiness} /></div>}
                  </div>
                </header>

                <div className="acf-shell-focus-reading">
                  {readingSurface === "live" && focusedRunCard?.latestReply && (
                    <div className="acf-shell-tv-copy">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Beurt {focusedRunCard.latestTurn ?? "?"} · {focusedRunCard.role} → {focusedRunCard.latestReply.to}{focusedRunCard.previousReplyCount > 0 ? ` · ${focusedRunCard.previousReplyCount} eerdere` : ""}</p>
                      <AcfReplyPanel namespace="live-focus" messageId={focusedRunCard.latestReply.messageId}
                        author={focusedRunCard.role} body={focusedRunCard.latestReply.body}>
                        <article><div className="mc-acf-reply-text whitespace-pre-wrap break-words">{focusedRunCard.latestReply.body}</div></article>
                      </AcfReplyPanel>
                    </div>
                  )}
                  {readingSurface === "live" && !focusedRunCard?.latestReply && (
                    <div className="acf-shell-tv-copy">
                      {focusedRunCard ? <p>{focusedRunCard.role} heeft in deze run nog geen beurt gehad.</p> : null}
                      {latestFocusedSession ? (
                        <>
                          <p>{focusedAgent.id === "antigravity" ? "AntiGravity 2.0" : focusedAgent.label} has {focusedSessions.length} Mission Control session record{focusedSessions.length === 1 ? "" : "s"} observed.</p>
                          <p>
                            Latest historical record: <strong>{latestFocusedSession.displayName}</strong> · stored state <strong>{latestFocusedSession.status}</strong>. Historical idle state alone is not treated as current readiness proof.
                          </p>
                        </>
                      ) : (
                        <p>No Mission Control session is currently observed for {focusedAgent.id === "antigravity" ? "AntiGravity 2.0" : focusedAgent.label}.</p>
                      )}
                      {focusedReadiness && <p><strong>Operational status:</strong> {focusedReadiness.explanation}</p>}
                      {focusedReadiness?.roleClass === "ORCHESTRATOR" && (
                        <p>AntiGravity 2.0 is the Team Room orchestrator lane. Visual emphasis never implies an orchestration decision or active work; operational state remains evidence-backed.</p>
                      )}
                      <p>
                        This is the real Team Room reading surface. When ACF exports an actual participant reply, that message will replace this truthful preview state.
                      </p>
                    </div>
                  )}

                  {readingSurface === "per-agent" && (
                    <div>
                      <div className="mb-3 text-sm font-semibold">Mission Control session history · {focusedAgent.id === "antigravity" ? "AntiGravity 2.0" : focusedAgent.label}</div>
                      <div className="space-y-2">
                        {focusedSessions.slice(0, 7).map((session) => (
                          <div key={session.sessionId} className="acf-shell-session-row">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{session.displayName}</div>
                              <div className="mt-1 truncate text-[11px] text-muted">{session.sessionId}</div>
                            </div>
                            <div className="text-right text-[11px] text-muted">
                              <div>{session.status}</div>
                              <div>{new Date(session.updatedAt).toLocaleString()}</div>
                            </div>
                          </div>
                        ))}
                        {focusedSessions.length === 0 && (
                          <div className="text-sm text-muted">No Mission Control session records are currently available for this agent.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {readingSurface === "full" && discussion && (
                    <div className="space-y-3">
                      {discussion.history.map((m) => {
                        const article=<article className="border-b border-border/60 pb-3">
                          <p className="text-[11px] text-muted mono">#{m.sequence} · {m.from} → {m.to}</p>
                          <p className="mc-acf-reply-text mt-1 whitespace-pre-wrap break-words text-sm leading-6">{m.body}</p>
                        </article>;
                        return m.from !== "OPERATOR" && m.from !== "DENNIS"
                          ? <AcfReplyPanel key={m.messageId} namespace="full" messageId={m.messageId}
                              author={m.from} body={m.body}>{article}</AcfReplyPanel>
                          : <div key={m.messageId}>{article}</div>;
                      })}
                      {discussion.history.length === 0 && <p className="text-sm text-muted">Nog geen berichten in deze run.</p>}
                    </div>
                  )}
                  {readingSurface === "full" && !discussion && (
                    <div className="acf-shell-tv-copy">
                      <p>No real ACF team run exists yet, so there is no ACF conversation transcript to display.</p>
                      <p>The full chronological transcript will appear here from ACF-owned messages when a real run exists.</p>
                    </div>
                  )}
                </div>

                <footer className="acf-shell-focus-actions">
                  <button type="button" onClick={() => setReadingSurface("live")} className={"mc-button " + (readingSurface === "live" ? "mc-button-primary" : "mc-button-secondary")}>Live</button>
                  <button type="button" onClick={() => setReadingSurface("per-agent")} className={"mc-button " + (readingSurface === "per-agent" ? "mc-button-primary" : "mc-button-secondary")}>History</button>
                  <button type="button" onClick={() => setReadingSurface("full")} className={"mc-button " + (readingSurface === "full" ? "mc-button-primary" : "mc-button-secondary")}>Transcript</button>
                  <button
                    type="button"
                    onClick={() => {
                                        setFocusedId(null);
                      setReadingSurface("live");
                    }}
                    className="mc-button mc-button-secondary ml-auto"
                  >
                    Collapse
                  </button>
                </footer>
              </motion.section>
            </div>
          )}
          </div>
      </section>

      <div className="acf-shell-layout">
        <section className="acf-shell-selection" aria-label="Selecteer deelnemers voor Team Room">{selection}</section>
        <div className="acf-shell-canvas acf-shell-canvas-preview">
          <div className="acf-shell-nebula" aria-hidden="true" />
          <section className="mc-team-shared-conversation" data-testid="acf-shared-conversation" aria-label="Gezamenlijk ACF-gesprek">
            <header className="mc-team-shared-conversation-head">
              <div>
                <h2 className="text-base font-semibold">Gezamenlijk gesprek</h2>
                <p className="mt-1 text-xs text-muted">{discussion ? `ACF · ${discussion.history.length} opgeslagen berichten · canonieke run ${runId ?? "?"}` : "Nog geen bevestigde ACF-run · er zijn geen modelantwoorden om te tonen"}</p>
              </div>
              <span className="rounded-full border border-cyan-400/40 px-2 py-1 text-[10px] text-cyan-200">ACF READ</span>
            </header>
            {draftSelected.length > 0 && <p className="mc-team-shared-draft-note" role="status">{draftSelected.length} conceptdeelnemer(s) geselecteerd. Het gesprek en de bevestigde run veranderen niet.</p>}
            <div className={freeRoom ? "min-w-0 p-3" : "mc-team-shared-conversation-messages"} data-testid="acf-shared-conversation-messages">
              {freeRoom ?? (discussion?.history.length ? discussion.history.slice(-18).map(message=>{
                const article=<article className="mc-team-shared-message" data-testid="acf-shared-message">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-xs">{message.from}</strong>
                    <span className="text-[10px] text-muted">#{message.sequence} · naar {message.to}</span>
                  </div>
                  <p className="mc-acf-reply-text mt-2 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                </article>;
                return message.from!=="OPERATOR" && message.from!=="DENNIS"
                  ? <AcfReplyPanel key={message.messageId} namespace="shared" messageId={message.messageId}
                      author={message.from} body={message.body}>{article}</AcfReplyPanel>
                  : <div key={message.messageId}>{article}</div>;
              }) : <p className="p-4 text-sm text-muted">Nog geen gedeelde berichten in deze ACF-run. Conceptselectie verzendt niets.</p>)}
            </div>
          </section>

        </div>

        <aside className="acf-shell-side">
          <details className="mc-team-extra-controls">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-cyan-200">Aanvullende bediening · sessies · technische status</summary>
            <div className="mc-team-extra-controls-body">
          {controls}
          <section className="acf-shell-side-panel">
            <div className="text-lg font-semibold">Team Room</div>
            <div className="mt-1 text-xs text-muted">{visible.length} {draftSelected.length ? "DRAFT" : "ACF CONFIRMED"} · {discussion ? `${discussion.timeline.length} beurten` : "Geen actieve ACF-run"}</div>
            {visible.some(member=>member.id==="antigravity") && <div className="acf-orchestrator-anchor mt-3" data-agent="antigravity" aria-label="AntiGravity 2.0 only when selected or canonically bound">
              <span className="acf-orchestrator-crown" aria-hidden="true">♛</span>
              <span className="min-w-0 flex-1">
                <span className="acf-orchestrator-anchor-name">AntiGravity 2.0</span>
                <span className="acf-orchestrator-anchor-role">ORCHESTRATOR · {visible.find(member=>member.id==="antigravity")?.kind}</span>
              </span>
            </div>}
            <div className="mt-4 space-y-2">
              {visible.map((member) => {
                const agent=SHELL_AGENTS.find(a=>a.id===member.id);
                if (!agent) return <p key={member.key} className="text-xs text-warn">Onbekende ACF agent: {member.agentId}</p>;
                const readiness = shellReadiness(agent.id, operationalEvidence);
                return (
                  <button
                    type="button"
                    key={member.key}
                    data-agent={agent.id}
                    onClick={() => focusAgent(agent.id)}
                    className={"acf-shell-roster-button " + (focusedAgentId === agent.id ? "acf-shell-roster-button-active" : "")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="acf-shell-roster-name truncate">{agent.id === "antigravity" ? "AntiGravity 2.0" : agent.label}</span>
                        {readiness.roleClass === "ORCHESTRATOR" && <span className="acf-orchestrator-role-badge">ORCHESTRATOR</span>}
                      </span>
                    </span>
                    <ReadinessBadge readiness={readiness} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="acf-shell-side-panel">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Reading surface</div>
            <div className="mt-3 space-y-2">
              <button type="button" onClick={() => setReadingSurface("live")} className={"acf-shell-view-button " + (readingSurface === "live" ? "acf-shell-view-button-active" : "")}>Live</button>
              <button type="button" onClick={() => setReadingSurface("per-agent")} className={"acf-shell-view-button " + (readingSurface === "per-agent" ? "acf-shell-view-button-active" : "")}>Per agent</button>
              <button type="button" onClick={() => setReadingSurface("full")} className={"acf-shell-view-button " + (readingSurface === "full" ? "acf-shell-view-button-active" : "")}>Full conversation</button>
            </div>
          </section>

          <section className="acf-shell-side-panel acf-shell-side-note">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-warn">Truth state</div>
            <div className="mt-2 text-xs leading-5 text-muted">
              {discussion ? `Echte ACF-run ${runId ?? ""}. Wat je leest komt uit ACF; het middenvak volgt de laatste spreker.` : "NO_REAL_TEAM_RUN_YET. Focus animation is view-only until ACF exports real participant messages."}
            </div>
          </section>
            </div>
          </details>
        </aside>
      </div>

      <footer className="acf-shell-status">
        <span><strong>●</strong> {discussion ? `Live run ${runId ?? ""}` : "No Real ACF Run Yet"}</span>
        <span>{visible.length} {draftSelected.length ? "DRAFT · not saved" : "confirmed ACF participants"}</span>
        <span>{discussion ? discussion.history.length : 0} ACF messages</span>
        <span>MC session source</span>
        <span>{freeRoom ? "ACF operatorbediening · " : "Read only · "}{readLabel}</span>
      </footer>
    </section>
  );
}

export function TeamRoomView() {
  const [snapshot, setSnapshot] = useState<AcfTeamRoomSnapshot | null>(null);
  const [lastGood, setLastGood] = useState<AcfTeamRoomSnapshot | null>(null);
  const [lastGoodAt, setLastGoodAt] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunIdState] = useState<string | null>(null);
  const [viewRestored, setViewRestored] = useState(false);
  const [recoveryRunId,setRecoveryRunId] = useState<string|null>(null);
  const [recoveryReason,setRecoveryReason] = useState<string|null>(null);
  // The run the operator looks at now. A read answer for any other run arrives late and is dropped, so the room never
  // shows (or steps) a run the operator just navigated away from (ACF-OPERATOR-CONTROL-DECK-REALWORLD-001).
  const wantedRunId = useRef<string | null>(null);
  const setSelectedRunId = useCallback((runId: string | null) => {
    wantedRunId.current = runId;
    setSelectedRunIdState(runId);
    setRecoveryRunId(null);
    setRecoveryReason(null);
    // Save the operator's explicit run choice immediately, even before polling.
    try {
      const previous = parseRoomView(window.localStorage.getItem(ROOM_VIEW_KEY));
      window.localStorage.setItem(ROOM_VIEW_KEY,JSON.stringify({
        ...(previous ?? {version:1}),runId,
      }));
    }catch { /* browser preference storage is optional */ }
  }, []);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshFailureKind, setRefreshFailureKind] = useState<AcfRefreshFailureKind>(null);
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<TeamRoomMode>("discuss");
  const [focusPreference, setFocusPreference] = useState<TeamRoomFocusPreference>({ role: null, sequence: null });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [operatorObjective, setOperatorObjective] = useState("");
  const [operatorSuccessCriterion, setOperatorSuccessCriterion] = useState("");
  const [openRoles, setOpenRoles] = useState<Record<string, string>>({ builder: "openclaw", reviewer: "claude-code" });
  const [openPins, setOpenPins] = useState<Record<string, string>>({});
  const [openSessions, setOpenSessions] = useState<Parameters<typeof TeamOpenSessions>[0]["answer"]>(null);
  const [cockpitSessions, setCockpitSessions] = useState<CockpitSessionSummary[]>([]);
  // One selection source: the inline composer and the visual room consume this same presentation state.
  const [draftChoices,setDraftChoices] = useState<Record<string,TeamDraftChoice>>({});
  const draftSelected = COCKPIT_AGENT_TARGETS.filter(a=>draftChoices[a.apiAgentId]?.selected).map(a=>a.apiAgentId);
  const [operationalEvidence, setOperationalEvidence] = useState<OperationalEvidenceMap>({});

  useEffect(() => {
    try {
      const saved = parseRoomView(window.localStorage.getItem(ROOM_VIEW_KEY));
      if (saved) {
        wantedRunId.current = saved.runId;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate explicit browser selection before first ACF poll
        setSelectedRunIdState(saved.runId);
        setMode(saved.mode);
        setHistoryOpen(saved.historyOpen);
        setDetailsOpen(saved.detailsOpen);
        setOperatorObjective(saved.operatorObjective);
        setOperatorSuccessCriterion(saved.operatorSuccessCriterion);
        setDraftChoices(saved.draftChoices);
        setFocusPreference(saved.focusPreference);
      }
    } catch { /* recover from canonical ACF index without browser storage */ }
    setViewRestored(true);
  }, []);
  useEffect(() => {
    if (!viewRestored)return;
    const saved:StoredRoomView = {version:1,runId:selectedRunId,mode,historyOpen,detailsOpen,
      operatorObjective,operatorSuccessCriterion,draftChoices,focusPreference};
    try { window.localStorage.setItem(ROOM_VIEW_KEY,JSON.stringify(saved)); }
    catch { /* browser preferences cannot alter the ACF journal */ }
  }, [viewRestored,selectedRunId,mode,historyOpen,detailsOpen,operatorObjective,
      operatorSuccessCriterion,draftChoices,focusPreference]);

  const refresh = useCallback(async (runId: string | null) => {
    try {
      const suffix = runId ? `?runId=${encodeURIComponent(runId)}` : "";
      const response = await fetch(`/api/acf/team-room${suffix}`, { cache: "no-store" });
      const next = await response.json() as AcfTeamRoomSnapshot;
      if (runId !== wantedRunId.current) return;   // a late answer for a run the operator left: dropped
      if (runId && response.ok && next.availability==="available" &&
          verifySavedRun(runId,next.runs.map(r=>r.runId),next.selectedRun?.runId??null)!=="VERIFIED") {
        setRecoveryRunId(runId);
        setRecoveryReason("De opgeslagen run komt niet overeen met de canonieke ACF-runindex.");
        setSnapshot({...next,selectedRun:null,availability:"empty"});
        return;
      }
      if (runId && (!response.ok || next.availability==="empty")) {
        // A stale local preference must never silently open another run. Query
        // the canonical index once for an operator-visible recovery selector.
        try {
          const indexResponse = await fetch("/api/acf/team-room",{cache:"no-store"});
          const index = await indexResponse.json() as AcfTeamRoomSnapshot;
          if (runId!==wantedRunId.current)return;
          if (indexResponse.ok && (index.availability==="empty" || index.availability==="available")) {
            setSnapshot({...index,selectedRun:null,availability:"empty"});
            setRecoveryRunId(runId);
            setRecoveryReason(index.runs.some(x=>x.runId===runId)
              ? "De opgeslagen run staat in de index, maar kon niet worden geopend. Probeer opnieuw."
              : "De opgeslagen run staat niet meer in de canonieke ACF-runindex. Kies een bestaande run.");
            setRefreshError(null);
            setRefreshFailureKind(null);
            return;
          }
        }catch { /* temporary ACF outage: retain saved id for recovery */ }
        setRecoveryRunId(runId);
        setRecoveryReason("De bestaande ACF-run is tijdelijk niet bereikbaar. De opgeslagen keuze blijft behouden.");
      }
      setSnapshot(next);
      if (response.ok && (next.availability === "available" || next.availability === "empty")) {
        setLastGood(next);
        setLastGoodAt(Date.now());
        setRefreshError(null);
        setRefreshFailureKind(null);
        setRecoveryRunId(null);
        setRecoveryReason(null);
        if (!runId && next.selectedRun?.runId) setSelectedRunId(next.selectedRun.runId);
      } else {
        setRefreshError(next.error || `ACF read failed with HTTP ${response.status}`);
        setRefreshFailureKind(next.availability === "malformed" ? "malformed" : "unavailable");
      }
    } catch (error) {
      if (runId===wantedRunId.current && runId) {
        setRecoveryRunId(runId);
        setRecoveryReason("ACF is tijdelijk niet beschikbaar. De gekozen run blijft bewaard.");
      }
      setRefreshError(error instanceof Error ? error.message : "ACF read failed");
      setRefreshFailureKind("unavailable");
    }
  }, [setSelectedRunId]);

  useEffect(() => {
    if (!viewRestored)return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external read-only ACF request (async result), not local setState
    void refresh(selectedRunId);
    const timer = window.setInterval(() => void refresh(selectedRunId), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, selectedRunId, viewRestored]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        const response = await fetch("/api/cockpit/sessions", { cache: "no-store" });
        const body = await response.json() as { sessions?: CockpitSessionSummary[] };
        if (!cancelled && response.ok) setCockpitSessions(body.sessions ?? []);
      } catch {
        if (!cancelled) setCockpitSessions([]);
      }
    }
    void loadSessions();
    const timer = window.setInterval(() => void loadSessions(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const display = snapshot && (snapshot.availability === "available" || snapshot.availability === "empty")
    ? snapshot
    : lastGood;

  const presentation = acfReadPresentation({
    hasLastGood: Boolean(lastGood),
    lastGoodAt,
    now,
    staleAfterMs: STALE_AFTER_MS,
    refreshFailureKind,
  });

  const selected = display?.selectedRun ?? null;
  const discussion = useMemo(() => selected ? buildTeamRoomDiscussion(selected) : null, [selected]);

  // ---- operator controls: Dennis's working room, no signing (2026-10-12) ----
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [controlNote, setControlNote] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  type ControlAnswer = { ok: boolean; code?: string; detail?: string; result?: Record<string, unknown>; sessions?: Record<string, unknown> };
  const callControl = useCallback(async (verb: string, args: Record<string, unknown>): Promise<ControlAnswer> => {
    // One operator stateflow: a visible DRAFT must never drive the old canonical
    // run by an incidental click in the already-mounted OperatorDeck.
    if (draftSelected.length > 0 && verb !== "team-open-participants" && verb !== "team-join") {
      return { ok: false, code: "DRAFT_SELECTION_PENDING",
        detail: "Conceptselectie actief. Bevestig Nieuw team of Toevoegen, of wis de selectie voordat je de bestaande run bedient." };
    }
    try {
      const response = await fetch("/api/acf/team-room/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verb, args }),
      });
      return (await response.json()) as ControlAnswer;
    } catch (error) {
      return { ok: false, code: "NETWORK", detail: error instanceof Error ? error.message : "request failed" };
    }
  }, [draftSelected.length]);
  const waitForStep = useCallback(async (runId: string): Promise<ControlAnswer | null> => {
    for (let i = 0; i < 160; i++) {          // up to ~8 minutes
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      void refresh(runId);
      try {
        const response = await fetch(`/api/acf/team-room/control?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
        const status = (await response.json()) as { step?: { running: boolean; last: ControlAnswer | null } | null };
        if (status.step && !status.step.running) return status.step.last;
      } catch {
        /* keep waiting */
      }
    }
    return null;
  }, [refresh]);
  const openTeam = useCallback(async () => {
    setControlBusy("team-open");
    setControlNote("Team wordt geopend…");
    const pins = Object.fromEntries(Object.entries(openPins).filter(([, value]) => value));
    const answer = await callControl("team-open", { objective: operatorObjective, success_criterion: operatorSuccessCriterion, roles: openRoles, pins });
    if (answer.ok) {
      const runId = String(answer.result?.run_id ?? "");
      setSelectedRunId(runId);
      setOperatorObjective("");
      setOperatorSuccessCriterion("");
      setControlNote(`Team geopend: ${runId}. Klik "Volgende beurt" of "Automatisch doorlopen".`);
      await refresh(runId);
    } else {
      if (answer.sessions) setOpenSessions((previous) => ({ ok: true, enabled: previous?.enabled, answer: answer.sessions as NonNullable<typeof previous>["answer"] }));
      setControlNote(`Niet geopend: ${refusalText(answer)}`);
    }
    setControlBusy(null);
  }, [callControl, operatorObjective, operatorSuccessCriterion, openRoles, openPins, refresh, setSelectedRunId]);
  /** The run's current team-view straight from the read side (used between steps; no state is written). */
  const readView = useCallback(async (runId: string): Promise<AcfTeamRoomRun["teamView"]> => {
    try {
      const response = await fetch(`/api/acf/team-room?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
      const next = (await response.json()) as AcfTeamRoomSnapshot;
      return next.selectedRun?.runId === runId ? next.selectedRun.teamView : null;
    } catch {
      return null;
    }
  }, []);
  const stepTeam = useCallback(async (runId: string, auto: boolean) => {
    setControlBusy(auto ? "auto" : "team-step");
    setAutoRun(auto);
    for (let i = 1; i <= (auto ? 12 : 1); i++) {
      setControlNote(`Beurt ${i} loopt — de agent werkt, dit kan een paar minuten duren…`);
      const started = await callControl("team-step", { run_id: runId });
      if (!started.ok) { setControlNote(`Gestopt: ${started.code ?? "FOUT"} ${started.detail ?? ""}`); break; }
      const done = await waitForStep(runId);
      await refresh(runId);
      if (!done) { setControlNote("De beurt duurt erg lang; de room ververst vanzelf zodra hij klaar is."); break; }
      if (!done.ok) { setControlNote(`Beurt ${i} niet gelukt: ${done.code ?? "FOUT"} ${done.detail ?? ""}`); break; }
      const kind = String(done.result?.kind ?? "");
      const role = done.result?.role ? ` · ${String(done.result.role)}` : "";
      const note = done.result?.holder_note ? ` · ${String(done.result.holder_note)}` : "";
      const turn = done.result?.turn as { failed?: boolean; code?: string } | undefined;
      setControlNote(`Beurt ${i}: ${kind}${role}${note}${turn?.failed ? ` · mislukt (${turn.code ?? "?"}), niet opnieuw geprobeerd` : ""}`);
      if (!auto || turn?.failed) break;
      // R9: Automatisch continues only while ACF itself names TEAM_STEP next (during an intervention: owed replies only).
      const view = await readView(runId);
      const next = view?.next_safe_action ?? "";
      if (!next.startsWith("TEAM_STEP")) {
        if (view?.autonomy === "OPERATOR_INTERVENTION") setControlNote(`Beurt ${i}: ${kind}${role}. Geen antwoorden meer open; het team blijft gepauzeerd tot je hervat.`);
        break;
      }
    }
    setAutoRun(false);
    setControlBusy(null);
  }, [callControl, readView, refresh, waitForStep]);

  useEffect(() => {
    let cancelled = false;

    async function loadOperationalEvidence() {
      const observedAt = Date.now();
      const truthPromise = fetch("/api/cockpit/runtime-truth", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`runtime truth HTTP ${response.status}`);
          return response.json() as Promise<{ runtimes?: RuntimeTruthClient[] }>;
        });

      const statusPromises = SHELL_AGENTS.filter(a=>["hermes","claude-code","openclaw","antigravity"].includes(a.id)).map(async (agent) => {
        const response = await fetch(connectorStatusEndpoint(agent.id as ReadinessAgentId), { cache: "no-store" });
        if (!response.ok) throw new Error(`${agent.id} status HTTP ${response.status}`);
        return [agent.id as ReadinessAgentId, await response.json() as ConnectorStatusClient] as const;
      });

      const participantsByRole = new Map<string, TeamRoomParticipantCard>();
      for (const participant of discussion?.participants ?? []) {
        if (normalizedReadinessAgentId(participant.agentId)) participantsByRole.set(participant.role, participant);
      }

      const sessionPromises = Array.from(participantsByRole.entries()).map(async ([role, participant]) => {
        const targetId = normalizedReadinessAgentId(participant.agentId);
        if (!targetId) return [role, null] as const;
        if (!participant.sessionRef || !participant.agentId) return [role, null] as const;
        const apiAgentId = participant.agentId === "antigravity" ? "agy" : participant.agentId;
        const target = getCockpitAgentByApiId(apiAgentId);
        if (!target) return [role, null] as const;
        const endpoint = `${target.sessionEndpoint}?sessionId=${encodeURIComponent(participant.sessionRef)}`;
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) throw new Error(`${targetId} session readiness HTTP ${response.status}`);
        const body = await response.json() as {
          session?: {
            active?: boolean;
            status?: "starting" | "idle" | "running" | "stopped" | "error";
            lastError?: string | null;
          } | null;
        };
        const session = body.session ?? null;
        const observation: SessionReadinessObservation = {
          sessionRef: participant.sessionRef,
          exists: session !== null,
          active: session ? Boolean(session.active) : null,
          status: session?.status ?? null,
          stale: false,
          lastError: session?.lastError ?? null,
          source: `GET ${endpoint} · exact ACF-bound session`,
          observedAt,
        };
        return [role, observation] as const;
      });

      const [truthResult, statusResults, sessionResults] = await Promise.all([
        truthPromise.then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error })
        ),
        Promise.all(statusPromises.map((promise) => promise.then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error })
        ))),
        Promise.all(sessionPromises.map((promise) => promise.then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error })
        ))),
      ]);

      if (cancelled) return;

      const truthMap = new Map<ReadinessAgentId, RuntimeTruthClient>();
      if (truthResult.ok) {
        for (const runtime of truthResult.value.runtimes ?? []) truthMap.set(runtime.targetId, runtime);
      }

      const statusMap = new Map<ReadinessAgentId, ConnectorStatusClient>();
      const failedStatuses = new Set<ReadinessAgentId>();
      statusResults.forEach((result, index) => {
        const agentId = SHELL_AGENTS.filter(a=>["hermes","claude-code","openclaw","antigravity"].includes(a.id))[index].id as ReadinessAgentId;
        if (result.ok) statusMap.set(agentId, result.value[1]);
        else failedStatuses.add(agentId);
      });

      const sessionMap = new Map<string, SessionReadinessObservation | null>();
      const failedSessions = new Set<string>();
      sessionResults.forEach((result, index) => {
        const entry = Array.from(participantsByRole.entries())[index];
        if (!entry) return;
        const role = entry[0];
        if (result.ok) sessionMap.set(role, result.value[1]);
        else failedSessions.add(role);
      });

      setOperationalEvidence((previous) => {
        const next: OperationalEvidenceMap = {};
        for (const agent of SHELL_AGENTS) {
          const prior = previous[agent.id as ReadinessAgentId];
          const truth = truthResult.ok ? truthMap.get(agent.id as ReadinessAgentId) ?? null : null;
          const status = statusMap.get(agent.id as ReadinessAgentId) ?? null;
          const current = runtimeObservation(agent.id as ReadinessAgentId, truth, status, observedAt);

          let runtime = current.runtime;
          let requiredTransport = current.transport;

          if (!truthResult.ok && prior?.runtime) {
            runtime = { ...prior.runtime, stale: true };
          }
          if (failedStatuses.has(agent.id as ReadinessAgentId)) {
            if (prior?.runtime) runtime = { ...prior.runtime, stale: true };
            else if (agent.id !== "claude-code") {
              runtime = {
                exists: truth ? (truth.installedVersion || truth.runningServiceVersion ? true : null) : null,
                reachable: null,
                stale: false,
                error: null,
                source: `GET ${connectorStatusEndpoint(agent.id as ReadinessAgentId)} unavailable`,
                observedAt: null,
              };
            }
            if (agent.id === "claude-code") {
              requiredTransport = prior?.requiredTransport
                ? { ...prior.requiredTransport, stale: true }
                : {
                    state: "unknown",
                    stale: false,
                    detail: "FCC transport status unavailable",
                    source: "GET /api/connectors/fcc/status unavailable",
                    observedAt: null,
                  };
            }
          }

          // Pool state is agent-level; never attach a random independent participant session.
          next[agent.id as ReadinessAgentId] = { runtime, requiredTransport, session: null };
        }
        for (const [role, participant] of participantsByRole) {
          const agentId = normalizedReadinessAgentId(participant.agentId);
          if (!agentId) continue;
          const pool = next[agentId];
          const slot = `participant:${role}`;
          const prior = previous[slot];
          let session = sessionMap.get(role) ?? null;
          if (failedSessions.has(role) && prior?.session) session = { ...prior.session, stale: true };
          next[slot] = { runtime: pool?.runtime ?? null, requiredTransport: pool?.requiredTransport ?? null, session };
        }
        return next;
      });
    }

    void loadOperationalEvidence();
    const timer = window.setInterval(() => void loadOperationalEvidence(), READINESS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [discussion]);

  const participantReadinessByRole = useMemo(() => {
    const entries = (discussion?.participants ?? []).map((participant) => [
      participant.role,
      readinessForParticipant(participant, selected, presentation.stale, operationalEvidence),
    ] as const);
    return new Map(entries);
  }, [discussion, selected, presentation.stale, operationalEvidence]);

  const focusedRole = discussion ? resolveFocusedRole(discussion, focusPreference) : null;
  const focusedCard = discussion?.participants.find((participant) => participant.role === focusedRole) ?? null;
  const focusedReadiness = focusedRole ? participantReadinessByRole.get(focusedRole) ?? null : null;
  const latestSequence = discussion?.latestParticipantMessage?.sequence ?? null;
  const currentTurn = discussion?.timeline.length ?? 0;

  useEffect(() => {
    if (!historyOpen || !selected?.runId || !viewRestored) return;
    // Scroll only on run/open-state change, never on the repeating ACF poll.
    window.requestAnimationFrame(() => document.getElementById("team-room-canonical-history")?.scrollIntoView({block:"start"}));
  }, [historyOpen,selected?.runId,viewRestored]);

  const latestLineage = discussion?.latestParticipantMessage
    ? discussion.timeline.find((entry) => entry.messageId === discussion.latestParticipantMessage?.messageId)?.lineage ?? null
    : null;

  return (
    <div className="acf-team-room-page">
      {!viewRestored && <div role="status" data-testid="team-room-rehydrating"
        className="mx-4 rounded-lg border border-border p-3">Werkruimte herstellen…</div>}
      <header className="acf-team-room-hero">
        <div className="acf-team-room-hero-copy">
          <div className="text-[10px] font-semibold tracking-[0.18em] text-cyan-300">MISSION CONTROL · TEAM ROOM</div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-semibold">Mission Control Team Room</h1>
          <p className="mt-1.5 text-sm text-muted">Jouw gebruikersruimte · samenwerking en berichten worden bewaard door de Agentic Collaboration Fabric (ACF).</p>

          <nav className="acf-mode-tabs" aria-label="Team Room modes">
            {TEAM_ROOM_MODES.map((definition) => (
              <button
                type="button"
                key={definition.id}
                onClick={() => setMode(definition.id)}
                className={`acf-mode-tab ${mode === definition.id ? "acf-mode-tab-active" : ""}`}
              >
                <span>{definition.label}</span>
                <span className={`acf-mode-readiness ${definition.readiness === "CONNECTED_READ_ONLY" ? "text-cyan-300" : "text-warn"}`}>
                  {definition.readiness === "CONNECTED_READ_ONLY" ? "READ" : "PREPARED"}
                </span>
              </button>
            ))}
          </nav>
        </div>

        <div className="acf-team-room-hero-controls">
          <span className={`acf-status-chip ${presentation.stale ? "acf-status-chip-warn" : ""}`}>{presentation.label}</span>
          {selected && <span className="acf-status-chip">{selected.runState}</span>}
          <button type="button" onClick={() => void refresh(selectedRunId)} className="acf-hero-refresh">
            Refresh
          </button>
        </div>
      </header>

      {refreshError && (
        <section className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm">
          <div className="font-medium text-danger">{refreshFailureKind === "malformed" ? "MALFORMED_EXPORT" : "ACF_UNAVAILABLE"}</div>
          <div className="mt-1 text-xs text-danger/90 mono break-all">{refreshError}</div>
          <div className="mt-1 text-xs text-muted">Last known good state remains visible and is explicitly marked stale.</div>
        </section>
      )}

      {!display && (
        <section className="acf-lobby-hero text-sm text-muted">Loading ACF read side…</section>
      )}

      {mode !== "discuss" && <PreparedMode mode={mode} />}

      {/* ACF run export and six-seat session registry are separate read
          surfaces. If an existing run export temporarily fails, do not hide
          the independently available session roster. Reuse the SAME composer
          with mutations disabled; no second registry or orchestrator. */}
      {mode === "discuss" && Boolean(refreshError) &&
       !(display?.availability === "empty" || (display?.availability === "available" && selected && discussion)) && (
        <section className="mx-4 my-3 rounded-xl border border-warn/40 p-3"
          aria-label="ACF sessierooster bij ontbrekende runexport"
          data-testid="acf-roster-read-degraded">
          <p className="text-sm text-warn" role="status">
            ACF-runexport tijdelijk niet beschikbaar. Het afzonderlijke ACF-sessierooster
            blijft leesbaar; nieuwe teams, joins en modelbeurten blijven geblokkeerd
            totdat de canonieke runstatus weer beschikbaar is.
          </p>
          <RosterTeamComposer run={null} busy="ACF_RUN_EXPORT_UNAVAILABLE"
            callControl={callControl}
            onSelectRun={(id)=>{setDraftChoices({});setSelectedRunId(id);void refresh(id);}}
            refresh={async id=>{await refresh(id);}}
            choices={draftChoices} onChoicesChange={setDraftChoices}/>
        </section>
      )}

      {recoveryRunId && (
        <section className="mx-4 my-3 rounded-lg border border-warn/50 p-3"
          role="status" data-testid="team-room-run-recovery">
          <strong>Bestaande Team Room herstellen</strong>
          <p className="mt-1 text-sm">{recoveryReason}</p>
          <p className="mono mt-1 break-all text-xs">{recoveryRunId}</p>
          <button type="button" className="mc-button mc-button-secondary mt-2"
            onClick={()=>void refresh(recoveryRunId)}>Probeer opgeslagen run opnieuw</button>
          <p className="mt-1 text-xs text-muted">Selecteer anders een run uit het bestaande ACF-overzicht.
            Er is geen nieuwe run of agentbeurt gestart.</p>
        </section>
      )}
      {mode === "discuss" && display?.availability === "available" && selected && discussion && (
          <section className="acf-history-panel mx-4 my-3" id="team-room-canonical-history" data-testid="team-room-canonical-history" aria-label="Canoniek historisch Team Room-gesprek">
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={historyOpen}
            >
              <span>
                <span className="text-sm font-semibold">Conversation History · Team Room-run {selected.runId}</span>
                <span className="ml-2 text-[11px] text-muted">{discussion.history.length} canonieke ACF-berichten · {discussion.participants.map(p=>p.agentId).join(" + ")} · {selected.goal}</span>
              </span>
              <span className="mc-button mc-button-secondary mc-button-sm">{historyOpen ? "Hide" : "View history"}</span>
            </button>

            {historyOpen && (
              <div className="mt-4 max-h-[28rem] overflow-y-auto space-y-2 pr-1">
                {discussion.history.map((message: AcfMessageReadModel) => (
                  <article data-testid="team-room-canonical-message" key={message.messageId} className="rounded-lg border border-border/70 bg-background/30 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-[10px]">
                      <span className="mono text-muted">seq {message.sequence}</span>
                      <span className="font-semibold">{message.from} → {message.to}</span>
                      <span className="rounded border border-border px-1.5 py-0.5 mono text-muted">{message.kind}</span>
                      <span className="text-muted">{formatClock(message.at)}</span>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-5 text-foreground/90">{message.body}</div>
                    {message.inReplyTo && <div className="mt-2 mono text-[10px] text-muted">in_reply_to={message.inReplyTo}</div>}
                  </article>
                ))}
                {discussion.history.length === 0 && <div className="text-xs text-muted">No ACF messages exported for this run.</div>}
              </div>
            )}
          </section>
      )}
      {mode === "discuss" && (display?.availability === "empty" || (display?.availability === "available" && selected && discussion)) && (
        <TeamRoomShell
          key={selected?.runId ?? "empty"}
          sessions={cockpitSessions}
          draftSelected={draftSelected}
          participantReadinessByRole={participantReadinessByRole}
          readLabel={presentation.label}
          operationalEvidence={operationalEvidence}
          discussion={display?.availability === "available" ? discussion : null}
          run={display?.availability === "available" ? selected : null}
          stale={presentation.stale}
          runId={display?.availability === "available" ? selected?.runId ?? null : null}
          freeRoom={display?.availability === "available" && selected?.teamView?.schema===2
            ? <FreeRoomPanel key={selected.runId} run={selected} busy={controlBusy} setBusy={setControlBusy}
                callControl={callControl} waitForStep={waitForStep} readView={readView} refresh={refresh}
                disabled={draftSelected.length>0 || presentation.stale || Boolean(refreshError)} />
            : null}
          selection={<RosterTeamComposer run={selected} busy={controlBusy} callControl={callControl}
            onSelectRun={(id)=>{setDraftChoices({});setSelectedRunId(id);void refresh(id);}}
            refresh={async id=>{await refresh(id);}}
            choices={draftChoices} onChoicesChange={setDraftChoices} />}
          controls={(
            <section className="acf-shell-side-panel acf-shell-controls">
              <div className="text-lg font-semibold">Bediening</div>
              {display?.availability === "available" && selected?.teamView ? (
                <>
                  <div className="mt-1 text-xs text-muted">Run {selected.teamView.run_status} · Loop {String(selected.teamView.loop?.status ?? "?")} · {selected.teamView.turns.length} beurten</div>
                  <div className={"mt-1 text-xs font-semibold " + (draftSelected.length > 0 || selected.teamView.schema===2 && !selected.teamView.tasks?.length || selected.teamView.autonomy === "OPERATOR_INTERVENTION" ? "text-warn" : "text-ok")}>
                    {draftSelected.length > 0
                      ? `${draftSelected.length} DRAFT · alleen conceptselectie; bestaande ACF-run onveranderd`
                      : selected.teamView.schema===2 && !selected.teamView.tasks?.length
                      ? "Schema 2 · nog geen taak toegekend, geen agent werkt"
                      : selected.teamView.autonomy === "OPERATOR_INTERVENTION" ? `Dennis grijpt in (${selected.teamView.intervention?.open?.intervention_id ?? "?"}) — team gepauzeerd`
                      : selected.teamView.autonomy === "AUTONOMOUS" || !selected.teamView.autonomy ? "ACF-run zelfstandig ingesteld (activiteit alleen volgens bevestigde turns)" : selected.teamView.autonomy}
                  </div>
                  {draftSelected.length > 0 && <p className="mt-2 text-xs text-warn" role="status">Bestaande run geblokkeerd zolang de selectie DRAFT is. Bevestig Nieuw team/Toevoegen of vink alle conceptdeelnemers uit.</p>}
                  {selected.teamView.schema!==2 && <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" className="mc-button mc-button-success disabled:opacity-50" disabled={controlBusy!==null || draftSelected.length>0} onClick={()=>void stepTeam(selected.runId,false)}>{controlBusy==="team-step" ? "Beurt loopt…" : "Volgende beurt"}</button>
                    <button type="button" className="mc-button mc-button-secondary disabled:opacity-50" disabled={controlBusy!==null || draftSelected.length>0} onClick={()=>void stepTeam(selected.runId,true)}>{autoRun ? "Loopt…" : "Automatisch"}</button>
                  </div>}
                </>
              ) : (
                <div className="mt-1 text-xs text-muted">Nog geen run geselecteerd.</div>
              )}
              {display?.availability === "available" && selected?.teamView && (
                <button type="button" className="mt-2 w-full mc-button mc-button-primary" onClick={()=>document.getElementById("acf-operator-deck")?.scrollIntoView({behavior:"smooth",block:"start"})}>Operatorstoel ↓</button>
              )}
              <button type="button" className="mt-2 w-full mc-button mc-button-secondary" onClick={()=>document.getElementById("acf-operator-objective")?.scrollIntoView({behavior:"smooth",block:"center"})}>Nieuw team-doel ↓</button>
              {controlNote && <div className="mt-2 rounded-lg border border-border/70 bg-background/35 p-2 text-[11px]" role="status">{controlNote}</div>}
            </section>
          )}
        />
      )}
      {mode === "discuss" && display?.availability === "empty" && display.runs.length > 0 && (
        <section className="mx-4 my-2 rounded-lg border border-border/60 p-3" data-testid="acf-historical-run-selector">
          <div className="text-xs font-semibold text-muted">Historische runs · alleen openen als je ze bewust wilt bekijken</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {display.runs.map((historicalRun) => (
              <button type="button" key={historicalRun.runId} className="mc-button mc-button-secondary mc-button-sm"
                onClick={()=>{setSelectedRunId(historicalRun.runId);setFocusPreference({role:null,sequence:null});setHistoryOpen(true);void refresh(historicalRun.runId);}}>
                {historicalRun.runId} · {historicalRun.runState} · {historicalRun.goal}
              </button>
            ))}
          </div>
        </section>
      )}

      {mode === "discuss" && display?.availability === "available" && selected && discussion && (
        <div className="mx-4 my-2">
          <button type="button" className="mc-button mc-button-secondary" onClick={() => setDetailsOpen((o) => !o)}>{detailsOpen ? "Technische details verbergen" : "Technische details"}</button>
        </div>
      )}

      {mode === "discuss" && display?.availability === "available" && selected?.teamView && (
        <details className="mx-4 my-2 rounded-lg border border-border/60 p-2" open={selected.teamView.schema!==2 ? true : undefined}>
        <summary className="cursor-pointer text-xs text-muted">Geavanceerd · operatorinterventies en historische controls</summary>
        <OperatorDeck
          key={`operator-deck:${selected.runId}`}
          run={selected}
          busy={draftSelected.length>0 ? "draft-selection" : controlBusy}
          setBusy={setControlBusy}
          callControl={callControl}
          waitForStep={waitForStep}
          refresh={refresh}
          readView={readView}
          onSelectRun={(runId) => { setSelectedRunId(runId); setFocusPreference({ role: null, sequence: null }); void refresh(runId); }}
        /></details>
      )}

      <details className="mx-4 my-2 rounded-lg border border-border/60 p-2"><summary className="cursor-pointer text-xs text-muted">Historische v1 team-open (builder/reviewer) · uitklappen</summary>
      <section className="mx-4 my-3 rounded-xl border border-cyan-400/40 bg-panel-2 p-4" aria-label="Mission Control Team Room opdracht">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Nieuw team-doel</h2>
          <span className="text-xs font-semibold text-cyan-300">{agentLabel(openRoles.builder)} bouwt · {agentLabel(openRoles.reviewer)} reviewt · ACF stuurt</span>
        </div>
        <label className="mt-3 block text-sm" htmlFor="acf-operator-objective">Doel</label>
        <textarea id="acf-operator-objective" value={operatorObjective} onChange={event=>setOperatorObjective(event.target.value)} rows={3} maxLength={4000} placeholder="Wat moet het team maken of uitzoeken?" className="mt-1 w-full min-w-0 rounded-lg border border-border bg-background p-3 text-sm" />
        <label className="mt-3 block text-sm" htmlFor="acf-success-criterion">Wanneer is het goed?</label>
        <textarea id="acf-success-criterion" value={operatorSuccessCriterion} onChange={event=>setOperatorSuccessCriterion(event.target.value)} rows={2} maxLength={400} placeholder="Waar moet de reviewer bewijs van zien?" className="mt-1 w-full min-w-0 rounded-lg border border-border bg-background p-3 text-sm" />
        <TeamOpenSessions roles={openRoles} setRoles={setOpenRoles} pins={openPins} setPins={setOpenPins} answer={openSessions} setAnswer={setOpenSessions} />
        <button type="button" onClick={()=>void openTeam()} disabled={controlBusy!==null || draftSelected.length>0 || !operatorObjective.trim() || !operatorSuccessCriterion.trim()} className="mt-3 mc-button mc-button-success disabled:opacity-50">{controlBusy==="team-open" ? "Bezig…" : "Start team"}</button>
        {controlNote && <p className="mt-2 text-sm" role="status">{controlNote}</p>}
      </section>
      </details>
      {selected?.teamView && (
        <section className="mx-4 my-3 rounded-xl border border-border bg-panel-2 p-4 text-xs" aria-label="ACF operator controls">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">{selected.runId}</strong>
            <span className="text-cyan-300">Run {selected.teamView.run_status} · Loop {String(selected.teamView.loop?.status ?? "UNKNOWN")} · {selected.teamView.turns.length} beurten</span>
          </div>
          <p className="mt-2 text-sm">Doel: {selected.goal}</p>
          <p className="mt-1">Volgende: {selected.nextSafeAction ?? "—"}</p>
          {selected.teamView.in_flight ? <p className="mt-1 text-warn">Er loopt een beurt.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2" aria-label="ACF operator actions">
            <button type="button" className="mc-button mc-button-success disabled:opacity-50" disabled={controlBusy!==null || draftSelected.length>0} onClick={()=>void stepTeam(selected.runId,false)}>{controlBusy==="team-step" ? "Beurt loopt…" : "Volgende beurt"}</button>
            <button type="button" className="mc-button mc-button-secondary disabled:opacity-50" disabled={controlBusy!==null || draftSelected.length>0} onClick={()=>void stepTeam(selected.runId,true)}>{autoRun ? "Loopt automatisch…" : "Automatisch doorlopen"}</button>
          </div>
          {controlNote && <p className="mt-2 text-sm" role="status">{controlNote}</p>}
          <details className="mt-3">
            <summary className="cursor-pointer text-muted">Details (beurten, bewijs, herkomst)</summary>
            <p className="mt-2">Bron: {snapshot?.source.stateDir ?? "—"} · state hash <span className="break-all mono">{selected.stateHash}</span> · replay klopt: {String(selected.replayMatchesRecord ?? "?")}</p>
            <p className="[overflow-wrap:anywhere]">Review-bewijs: {selected.teamView.acceptance ? JSON.stringify(selected.teamView.acceptance) : "nog geen"}</p>
            <div className="mt-2 max-h-52 overflow-y-auto rounded border border-border p-2" aria-label="ACF native turn provenance">
              {selected.teamView.turns.length===0?<p>Nog geen beurten.</p>:selected.teamView.turns.map((turn,index)=><div className="border-b border-border py-2 last:border-none" key={`${turn.seq ?? index}:${turn.decision_id ?? index}`}>
                <strong>Beurt {turn.seq ?? "?"} · {turn.role ?? "?"} · {turn.outcome ?? "?"}</strong>
                <p>Agent {turn.agent_id ?? "?"} · sessie {turn.session_ref ?? "?"} · gesprek {turn.conversation_ref ?? "—"}</p>
              </div>)}
            </div>
          </details>
        </section>
      )}
      {mode === "discuss" && selected?.teamView && (
        <section className="acf-dynamic-room mx-4 my-3 min-w-0" aria-label="ACF participant conversation history">
          <header className="rounded-xl border border-border bg-panel-2 p-4">
            <h2 className="text-base font-semibold">Canonical ACF conversation</h2>
            <p className="mt-1 text-xs font-semibold text-warn">{display?.source.provenanceClass === "CERTIFIED_HISTORICAL_READ_SNAPSHOT" ? "CERTIFIED_HISTORICAL_READ_SNAPSHOT · not live streaming" : "Live · Team Room van Dennis"}</p>
            {(() => {const state=deriveCanonicalTurnState(selected);const candidate=state.lastMessageId?selected.messages.find(m=>m.messageId===state.lastMessageId):null;const last=candidate && candidate.origin && selected.participants.some(p=>p.agentId===candidate.origin?.agentId && p.sessionRef===candidate.origin?.sessionRef && p.participantId===candidate.origin?.participantId && p.role===candidate.from)?candidate:null;return <div className="mt-2 space-y-2 min-w-0">
              <p className="font-semibold">{state.status} · {state.lastRole??"UNKNOWN"} · next expected {state.nextExpectedRole??"UNKNOWN"}</p>
              {state.claim && <p className="text-warn">{state.claim}</p>}
              {last?<article className="rounded-lg border border-border bg-background/50 p-3"><p className="text-xs text-muted">LAST POSTED · {last.messageId} · {last.origin?.agentId??"UNKNOWN"} / {last.origin?.sessionRef??"UNKNOWN"}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{last.body}</p></article>:<p className="text-muted">No correlated posted turn is available. No speaking is inferred.</p>}
            </div>})()}
          </header>
          <div className="acf-dynamic-terminals mt-3" aria-label="Registry agent terminals">
            {SHELL_AGENTS.filter(agent=>selected.participants.some(p=>p.agentId===agent.apiAgentId||p.agentId===agent.id)).map(agent=>{const participant=selected.participants.find(p=>p.agentId===agent.apiAgentId||p.agentId===agent.id);const messages=exactParticipantMessages(selected,agent);const observed=shellSessionsFor(agent.id,cockpitSessions);return <section key={agent.id} className="min-w-0 rounded-xl border border-border bg-panel-2 p-3" data-agent={agent.id}>
              <header className="flex flex-wrap items-center justify-between gap-2"><h3 className="acf-dynamic-agent-name font-semibold">{labelForAgent(agent.id)}</h3><span className="text-xs text-muted">{participant?"ACF PARTICIPANT · CLAIMED":"NOT ACF-BOUND"}</span></header>
              <p className="mt-1 break-all text-xs text-muted">{participant?`Bound session: ${participant.sessionRef??"UNKNOWN"}`:`${observed.length} MC session record(s); no ACF participant claim`}</p>
              <div className="mt-2 max-h-72 space-y-2 overflow-y-auto overscroll-contain" aria-label={`${labelForAgent(agent.id)} authentic history`}>
                {messages.map(message=><article key={message.messageId} className="rounded border border-border bg-background/40 p-2"><p className="text-xs text-muted">#{message.sequence} · {message.messageId} · {message.origin?.turnId??"UNKNOWN TURN"}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p></article>)}
                {messages.length===0 && <p className="text-xs text-muted">No independently correlated ACF messages for this exact agent/session identity.</p>}
              </div>
            </section>})}
          </div>
          {selected.participants.filter(p=>!SHELL_AGENTS.some(agent=>agent.id===p.agentId||agent.apiAgentId===p.agentId)).map(p=><div key={p.participantId??p.role} className="mt-2 rounded border border-warn/40 p-3 text-xs text-warn">ACF participant {p.role} / {p.agentId??"UNKNOWN"} is not in the Mission Control agent registry. Session {p.sessionRef??"UNKNOWN"}. No registered terminal or readiness is claimed.</div>)}
          <details className="mt-3 rounded-xl border border-border p-3"><summary className="cursor-pointer font-medium">Full chronological ACF message history</summary><div className="mt-2 max-h-96 space-y-2 overflow-y-auto">{[...selected.messages].sort((a,b)=>a.sequence-b.sequence).map(m=><article key={m.messageId} className="border-b border-border py-2"><p className="text-xs text-muted">#{m.sequence} · {m.from} → {m.to} · {m.messageId}</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{m.body}</p></article>)}</div></details>
        </section>
      )}
      {mode === "discuss" && detailsOpen && display?.availability === "available" && selected && discussion && (
        <>
          <section className="acf-room-overview">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Run</div>
              <div className="mono text-sm font-semibold truncate">{selected.runId}</div>
              <div className="mt-1 text-sm text-foreground/90">{selected.goal}</div>
            </div>
            <div className="acf-room-stat">
              <span className="text-muted">Participants</span>
              <strong>{discussion.participants.length}</strong>
            </div>
            <div className="acf-room-stat">
              <span className="text-muted">Latest focus</span>
              <strong>{discussion.latestParticipantRole ?? "NONE"}</strong>
            </div>
            <div className="acf-room-stat">
              <span className="text-muted">Turn</span>
              <strong>{currentTurn} / NOT EXPORTED</strong>
            </div>
            <div className="acf-room-stat">
              <span className="text-muted">Next speaker</span>
              <strong>{String((selected.teamView?.loop?.next as {role?:unknown} | null)?.role ?? "UNKNOWN")}</strong>
            </div>
          </section>

          <section className="acf-roster" aria-label="Room participants">
            {discussion.participants.map((participant) => (
              <button
                type="button"
                key={participant.role}
                data-agent={dataAgent(participant.agentId)}
                className={`acf-roster-item ${focusedRole === participant.role ? "acf-roster-item-active" : ""}`}
                onClick={() => setFocusPreference(focusParticipant(participant.role, latestSequence))}
              >
                <ParticipantMark card={participant} compact />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold">{labelForAgent(participant.agentId)}</span>
                    {roleClassForAgent(participant.agentId) === "ORCHESTRATOR" && (
                      <span className="acf-orchestrator-role-badge">ORCHESTRATOR</span>
                    )}
                  </span>
                  <span className="block truncate text-[10px] text-muted">{participant.role}</span>
                  {participantReadinessByRole.get(participant.role) && (
                    <span className="mt-1 block">
                      <ReadinessBadge readiness={participantReadinessByRole.get(participant.role)!} />
                    </span>
                  )}
                </span>
                <span className="mono text-[9px] text-muted">{participant.latestTurn ? `T${participant.latestTurn}` : "—"}</span>
              </button>
            ))}
          </section>

          <div className="acf-discuss-layout">
            <section className="acf-conversation-canvas">
              <div className="acf-canvas-heading">
                <div>
                  <div className="text-sm font-semibold">Conversation Flow</div>
                  <div className="mt-0.5 text-[11px] text-muted">One latest reply per participant. Older replies stay in history.</div>
                </div>
                <div className="text-right text-[10px] text-muted">
                  <div>Speaking status: {selected.teamView?.in_flight ? "JOURNAL OPEN — SPEAKER UNCONFIRMED" : "NONE CONFIRMED"}</div>
                  <div>Visual focus: latest participant message</div>
                </div>
              </div>

              <div className="acf-flow-ribbon" aria-label="Recent conversation flow">
                {discussion.timeline.slice(-6).map((entry, index, recent) => (
                  <div key={entry.messageId} className="contents">
                    <div className={`acf-flow-node ${entry.messageId === discussion.latestParticipantMessage?.messageId ? "acf-flow-node-current" : ""}`}>
                      <span className="mono">T{entry.turn}</span>
                      <span>{entry.from}</span>
                      <span className="text-muted">→ {entry.to}</span>
                    </div>
                    {index < recent.length - 1 && <span className="acf-flow-arrow">→</span>}
                  </div>
                ))}
                {discussion.timeline.length === 0 && <span className="text-xs text-muted">No participant messages exported yet.</span>}
              </div>

              {latestLineage && (
                <div className="acf-lineage-banner">
                  {latestLineage.status === "PROVEN"
                    ? `Latest reply lineage: ${latestLineage.replyingToRole} → ${latestLineage.from}`
                    : latestLineage.status === "DIRECT_ADDRESS"
                      ? `Latest direct address: ${latestLineage.from} → ${latestLineage.to}`
                      : "Latest reply lineage: UNKNOWN / NOT EXPORTED"}
                </div>
              )}

              <div className="acf-participant-grid">
                {discussion.participants.map((participant) => {
                  const roleClass = roleClassForAgent(participant.agentId);
                  return (
                    <FocusablePanel
                      key={participant.role}
                      id={`acf-participant-${participant.role}`}
                      label={`${labelForAgent(participant.agentId)} · ${roleClass === "ORCHESTRATOR" ? "Orchestrator" : "Agent"}`}
                      tone={roleClass === "ORCHESTRATOR" ? "gold" : "default"}
                      className="acf-participant-focus-panel"
                    >
                      <ParticipantCard
                        card={participant}
                        readiness={participantReadinessByRole.get(participant.role) ?? deriveParticipantReadiness({
                          agentId: participant.agentId,
                          role: participant.role,
                          roleClass,
                          acfRunPresent: true,
                          acfBound: Boolean(participant.agentId && participant.sessionRef),
                          acfSessionRef: participant.sessionRef,
                          acfReadStale: presentation.stale,
                          blocker: blockerForRole(selected, participant.role),
                          runtime: null,
                          requiredTransport: null,
                          session: null,
                        })}
                        focused={focusedRole === participant.role}
                        onFocus={() => setFocusPreference(focusParticipant(participant.role, latestSequence))}
                      />
                    </FocusablePanel>
                  );
                })}
              </div>

              {focusedCard && focusedReadiness && (
                <FocusedParticipant
                  card={focusedCard}
                  readiness={focusedReadiness}
                  onCollapse={() => setFocusPreference(collapseCurrentFocus(latestSequence))}
                />
              )}
            </section>

            <aside className="acf-room-side">
              <section className="acf-side-panel">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Discussion Timeline</h2>
                  <span className="mono text-[10px] text-muted">{discussion.timeline.length} turns</span>
                </div>
                <div className="mt-3 space-y-2">
                  {discussion.timeline.slice(-8).map((entry) => (
                    <div key={entry.messageId} className={`acf-timeline-row ${entry.messageId === discussion.latestParticipantMessage?.messageId ? "acf-timeline-row-current" : ""}`}>
                      <span className="acf-timeline-number">{entry.turn}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{entry.from} → {entry.to}</div>
                        <div className="mt-0.5 truncate text-[10px] text-muted">
                          {entry.kind} · {entry.lineage.status === "PROVEN" ? `reply to ${entry.lineage.replyingToRole}` : entry.lineage.status}
                        </div>
                      </div>
                    </div>
                  ))}
                  {discussion.timeline.length === 0 && <div className="text-xs text-muted">No participant turns exported.</div>}
                </div>
              </section>

              <section className="acf-side-panel">
                <h2 className="text-sm font-semibold">Bediening</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" className="mc-button mc-button-success disabled:opacity-50" disabled={controlBusy!==null || !selected.teamView} onClick={()=>void stepTeam(selected.runId,false)}>{controlBusy==="team-step" ? "Beurt loopt…" : "Volgende beurt"}</button>
                  <button type="button" className="mc-button mc-button-secondary disabled:opacity-50" disabled={controlBusy!==null || !selected.teamView} onClick={()=>void stepTeam(selected.runId,true)}>{autoRun ? "Loopt…" : "Automatisch"}</button>
                </div>
                <button type="button" className="mt-2 w-full mc-button mc-button-secondary" onClick={()=>document.getElementById("acf-operator-objective")?.scrollIntoView({behavior:"smooth",block:"center"})}>Nieuw team-doel starten ↓</button>
                {controlNote && <div className="mt-3 rounded-lg border border-border/70 bg-background/35 p-3 text-[11px]" role="status">{controlNote}</div>}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-border/70 bg-background/30 p-2">
                    <div className="text-muted">Max turns</div>
                    <div className="mt-1 font-semibold">NOT EXPORTED</div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/30 p-2">
                    <div className="text-muted">Mode</div>
                    <div className="mt-1 font-semibold">DISCUSS / READ</div>
                  </div>
                </div>
              </section>

              <section className="acf-side-panel">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Run State</h2>
                  <span className="mono text-[10px] text-muted">seq {selected.lastEventOrSequence.sequence}</span>
                </div>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between gap-3"><dt className="text-muted">State</dt><dd className="mono">{selected.runState}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Orchestrator</dt><dd className="mono">{selected.orchestratorAdapter ?? "UNKNOWN"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Identity</dt><dd><VerificationBadge state={selected.orchestratorIdentityVerification} /></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Blocker</dt><dd className="text-right">{selected.blocker ?? "none exported"}</dd></div>
                </dl>
              </section>
            </aside>
          </div>



          <section className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Runs</span>
            {display.runs.map((run) => (
              <button
                type="button"
                key={run.runId}
                onClick={() => {
                  setSelectedRunId(run.runId);
                  setFocusPreference({ role: null, sequence: null });
                  setHistoryOpen(true);
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-xs mono ${selected.runId === run.runId ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" : "border-border bg-panel-2 text-muted hover:text-foreground"}`}
              >
                {run.runId} · {run.runState} · {run.goal}
              </button>
            ))}
          </section>
        </>
      )}

      <footer className="text-[10px] text-muted">
        Source: <span className="mono">{display?.source.projectRoot ?? "ACF canonical project"}</span> · read-only command surface · observed{" "}
        {display ? new Date(display.observedAt).toLocaleString() : "not yet"}
      </footer>
    </div>
  );
}
