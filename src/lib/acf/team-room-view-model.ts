import type {
  AcfMessageReadModel,
  AcfParticipantReadModel,
  AcfTeamRoomRun,
} from "./types";

export type TeamRoomMode = "discuss" | "fusion" | "council" | "playground";
export type TeamRoomModeReadiness = "CONNECTED_READ_ONLY" | "PREPARED_NOT_CONNECTED";

export interface TeamRoomModeDefinition {
  id: TeamRoomMode;
  label: string;
  readiness: TeamRoomModeReadiness;
  description: string;
}

export const TEAM_ROOM_MODES: readonly TeamRoomModeDefinition[] = [
  {
    id: "discuss",
    label: "Discuss",
    readiness: "CONNECTED_READ_ONLY",
    description: "Visualizes the canonical ACF run, participants, messages and lineage.",
  },
  {
    id: "fusion",
    label: "Fusion",
    readiness: "PREPARED_NOT_CONNECTED",
    description: "Fusion/panel semantics exist in the ACF protocol, but this Mission Control surface has no live mode contract yet.",
  },
  {
    id: "council",
    label: "Council",
    readiness: "PREPARED_NOT_CONNECTED",
    description: "Prepared presentation shell only. No council run contract is connected.",
  },
  {
    id: "playground",
    label: "Playground",
    readiness: "PREPARED_NOT_CONNECTED",
    description: "Prepared presentation shell only. No playground execution contract is connected.",
  },
] as const;

export interface TeamRoomLineage {
  messageId: string;
  from: string;
  to: string;
  inReplyTo: string | null;
  replyingToRole: string | null;
  status: "PROVEN" | "DIRECT_ADDRESS" | "UNKNOWN_NOT_EXPORTED";
}

export interface TeamRoomTimelineEntry {
  turn: number;
  messageId: string;
  sequence: number;
  from: string;
  to: string;
  kind: AcfMessageReadModel["kind"];
  at: string | null;
  lineage: TeamRoomLineage;
}

export interface TeamRoomParticipantCard {
  role: string;
  participantId: string | null;
  agentId: string | null;
  sessionRef: string | null;
  identityVerificationState: AcfParticipantReadModel["identityVerificationState"];
  latestReply: AcfMessageReadModel | null;
  previousReplyCount: number;
  latestTurn: number | null;
  lineage: TeamRoomLineage | null;
}

export interface TeamRoomDiscussionModel {
  participants: TeamRoomParticipantCard[];
  timeline: TeamRoomTimelineEntry[];
  latestParticipantRole: string | null;
  latestParticipantMessage: AcfMessageReadModel | null;
  currentSpeakerRole: null;
  currentSpeakerState: "NOT_EXPORTED";
  nextSpeakerRole: null;
  nextSpeakerState: "NOT_EXPORTED";
  maxTurns: null;
  maxTurnsState: "NOT_EXPORTED";
  history: AcfMessageReadModel[];
}

export interface TeamRoomFocusPreference {
  role: string | null;
  sequence: number | null;
}

function messageLineage(message: AcfMessageReadModel, byId: Map<string, AcfMessageReadModel>): TeamRoomLineage {
  if (!message.inReplyTo) {
    return {
      messageId: message.messageId,
      from: message.from,
      to: message.to,
      inReplyTo: null,
      replyingToRole: null,
      status: "DIRECT_ADDRESS",
    };
  }

  const parent = byId.get(message.inReplyTo);
  return {
    messageId: message.messageId,
    from: message.from,
    to: message.to,
    inReplyTo: message.inReplyTo,
    replyingToRole: parent?.from ?? null,
    status: parent ? "PROVEN" : "UNKNOWN_NOT_EXPORTED",
  };
}

export function buildTeamRoomDiscussion(run: AcfTeamRoomRun): TeamRoomDiscussionModel {
  const participantRoles = new Set(run.participants.map((participant) => participant.role));
  const history = [...run.messages].sort((a, b) => a.sequence - b.sequence);
  const byId = new Map(history.map((message) => [message.messageId, message]));
  const participantMessages = history.filter((message) => participantRoles.has(message.from));
  const turnByMessage = new Map(participantMessages.map((message, index) => [message.messageId, index + 1]));

  const participants = run.participants.map((participant) => {
    const replies = participantMessages.filter((message) => message.from === participant.role);
    const latestReply = replies.at(-1) ?? null;
    return {
      role: participant.role,
      participantId: participant.participantId,
      agentId: participant.agentId,
      sessionRef: participant.sessionRef,
      identityVerificationState: participant.identityVerificationState,
      latestReply,
      previousReplyCount: Math.max(0, replies.length - 1),
      latestTurn: latestReply ? turnByMessage.get(latestReply.messageId) ?? null : null,
      lineage: latestReply ? messageLineage(latestReply, byId) : null,
    };
  });

  const latestParticipantMessage = participantMessages.at(-1) ?? null;
  const timeline = participantMessages.map((message, index) => ({
    turn: index + 1,
    messageId: message.messageId,
    sequence: message.sequence,
    from: message.from,
    to: message.to,
    kind: message.kind,
    at: message.at,
    lineage: messageLineage(message, byId),
  }));

  return {
    participants,
    timeline,
    latestParticipantRole: latestParticipantMessage?.from ?? null,
    latestParticipantMessage,
    currentSpeakerRole: null,
    currentSpeakerState: "NOT_EXPORTED",
    nextSpeakerRole: null,
    nextSpeakerState: "NOT_EXPORTED",
    maxTurns: null,
    maxTurnsState: "NOT_EXPORTED",
    history,
  };
}

export function resolveFocusedRole(
  model: TeamRoomDiscussionModel,
  preference: TeamRoomFocusPreference
): string | null {
  const latestSequence = model.latestParticipantMessage?.sequence ?? null;

  // A preference is valid only for the exact latest-message generation in which
  // Dennis made it. A newer ACF message automatically returns focus to its author.
  if (preference.sequence !== latestSequence) return model.latestParticipantRole;
  if (preference.role === null) return null;
  return model.participants.some((participant) => participant.role === preference.role)
    ? preference.role
    : model.latestParticipantRole;
}

export function focusParticipant(
  role: string,
  latestSequence: number | null
): TeamRoomFocusPreference {
  return { role, sequence: latestSequence };
}

export function collapseCurrentFocus(latestSequence: number | null): TeamRoomFocusPreference {
  return { role: null, sequence: latestSequence };
}

export function modeDefinition(mode: TeamRoomMode): TeamRoomModeDefinition {
  return TEAM_ROOM_MODES.find((definition) => definition.id === mode) ?? TEAM_ROOM_MODES[0];
}
