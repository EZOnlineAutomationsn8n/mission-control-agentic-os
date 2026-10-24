/**
 * Mission Control read-only evidence view over the EXISTING ACF run export.
 * No autonomous provider turn, no second conversation store, no inferred
 * consensus and no claim that ACF delivered complete context to participants.
 *
 * The source of truth remains ACF state/events. This report is deliberately
 * evidence-first: assertions must be explicit, attributable participant text.
 * Free-form text stays in the transcript; we do not pretend to comprehend it.
 */
import type { AcfMessageReadModel, AcfTeamRoomRun } from "./types";

export type EvidenceKind =
  | "POSITION" | "AGREEMENT" | "OBJECTION" | "REVISION" | "OPEN" | "CONCLUSION";
export type EvidenceQuote = {
  kind: EvidenceKind;
  statement: string;
  messageId: string;
  sequence: number;
  from: string;
  agentId: string | null;
  sessionRef: string | null;
  conversationRef: string | null;
  to: string;
  inReplyTo: string | null;
};
export type GroupDiscussionReport = {
  runId: string;
  runState: string;
  goal: string;
  evidence: EvidenceQuote[];
  sourceMessages: Array<{messageId:string;sequence:number;from:string;to:string;body:string;inReplyTo:string|null}>;
  participantTurns: Array<{role:string;turns:number;sourceIds:string[]}>;
  peerResponses: Array<{messageId:string;from:string;to:string;inReplyTo:string|null}>;
  snapshotReplayVerified: boolean;
  participantFullContextVerified: false;
  consensusStatus: "NOT_PROVEN";
  caveats: string[];
};
const TAGS: Readonly<Record<string, EvidenceKind>> = {
  "STANDPUNT": "POSITION", "POSITION": "POSITION",
  "AKKOORD": "AGREEMENT", "AGREE": "AGREEMENT",
  "BEZWAAR": "OBJECTION", "DISAGREE": "OBJECTION",
  "HERZIEN": "REVISION", "REVISE": "REVISION",
  "OPEN": "OPEN", "UNRESOLVED": "OPEN",
  "CONCLUSIE": "CONCLUSION", "CONCLUSION": "CONCLUSION",
};
const TAGGED_LINE = /^\s*(STANDPUNT|POSITION|AKKOORD|AGREE|BEZWAAR|DISAGREE|HERZIEN|REVISE|OPEN|UNRESOLVED|CONCLUSIE|CONCLUSION)\s*:\s*(.+?)\s*$/i;

function extractExplicitEvidence(message: AcfMessageReadModel): EvidenceQuote[] {
  // A genuine native turn must have persisted origin references. Operator
  // messages are displayed as discussion history, never agent agreement.
  if (!message.origin?.agentId || !message.origin?.sessionRef ||
      !message.origin?.conversationRef) return [];
  const found: EvidenceQuote[] = [];
  for (const line of message.body.split(/\r?\n/)) {
    const parsed = line.match(TAGGED_LINE);
    if (!parsed) continue;
    found.push({
      kind: TAGS[parsed[1].toUpperCase()],
      statement: parsed[2],
      messageId: message.messageId, sequence: message.sequence,
      from: message.from, agentId: message.origin.agentId,
      sessionRef: message.origin.sessionRef,
      conversationRef: message.origin.conversationRef,
      to: message.to, inReplyTo: message.inReplyTo,
    });
  }
  return found;
}

export function deriveEvidenceGroupReport(
  run: Pick<AcfTeamRoomRun, "runId" | "runState" | "goal" | "messages" |
    "participants" | "replayMatchesRecord" | "teamView">
): GroupDiscussionReport {
  // Never silently discard a source message, including operator questions or
  // messages from an agent not in the current selection.
  const ordered = [...run.messages].sort((a,b) => a.sequence-b.sequence || a.messageId.localeCompare(b.messageId));
  const people = new Set(run.participants.map(p => p.role));
  const participantTurns = run.participants.map(p => {
    const own = ordered.filter(m => m.from === p.role && m.origin?.agentId === p.agentId &&
      m.origin?.sessionRef === p.sessionRef && Boolean(m.origin.conversationRef));
    return {role:p.role,turns:own.length,sourceIds:own.map(m => m.messageId)};
  });
  const peerResponses = ordered.filter(m => people.has(m.from) && people.has(m.to) &&
    m.from !== m.to && Boolean(m.origin?.agentId && m.origin?.sessionRef && m.origin?.conversationRef))
    .map(m => ({messageId:m.messageId,from:m.from,to:m.to,inReplyTo:m.inReplyTo}));
  const replay = run.replayMatchesRecord === true && run.teamView?.replay_matches_record === true;
  return {
    runId:run.runId,runState:run.runState,goal:run.goal,
    evidence:ordered.flatMap(extractExplicitEvidence),
    sourceMessages:ordered.map(m=>({
      messageId:m.messageId,sequence:m.sequence,from:m.from,to:m.to,body:m.body,inReplyTo:m.inReplyTo,
    })),
    participantTurns,peerResponses,
    snapshotReplayVerified:replay,
    // ACF's current dialogue context is intentionally bounded. A complete
    // export does NOT demonstrate that the agent read all peer contributions.
    participantFullContextVerified:false,
    consensusStatus:"NOT_PROVEN",
    caveats:[
      "Dit rapport is deterministisch afgeleid uit de zichtbare ACF-runexport; geen nieuwe agentbeurt of semantische modelanalyse.",
      "Expliciete standpunten/akkoorden/bezwaren/herzieningen/conclusies zijn individuele uitspraken, geen onafhankelijk bewezen feiten of groepsconsensus.",
      "Volledige gesprekscontext per deelnemer is niet aangetoond: de huidige ACF-contextbuilder selecteert begrensde fragmenten.",
      ...(replay ? [] : ["De ACF-replay/bronconsistentie is niet volledig bevestigd; behandel alle bevindingen als onzeker."]),
    ],
  };
}
