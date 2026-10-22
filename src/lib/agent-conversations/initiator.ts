export interface AcfParticipantDialogueInitiator {
  kind: "acf-participant-dialogue";
  runId: string;
  role: string;
  participantId: string;
  turnId: string;
}

export type ConversationInitiator = AcfParticipantDialogueInitiator;

export type ParsedConversationInitiator =
  | { ok: true; initiator: ConversationInitiator | null }
  | { ok: false; error: string };

const MAX_FIELD_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function validClaimField(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_FIELD_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTERS.test(value);
}

export function parseConversationInitiator(value: unknown): ParsedConversationInitiator {
  if (value === undefined) return { ok: true, initiator: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "initiator must be an ACF participant dialogue claim object" };
  }

  const record = value as Record<string, unknown>;
  if (record.kind !== "acf-participant-dialogue") {
    return {
      ok: false,
      error: "initiator kind must be acf-participant-dialogue; operator turns must omit initiator",
    };
  }

  const expectedKeys = ["kind", "participantId", "role", "runId", "turnId"];
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return { ok: false, error: "initiator has unsupported or missing fields" };
  }

  for (const field of ["runId", "role", "participantId", "turnId"] as const) {
    if (!validClaimField(record[field])) {
      return {
        ok: false,
        error: `initiator.${field} must be non-empty text of at most 128 characters without control characters`,
      };
    }
  }

  return {
    ok: true,
    initiator: {
      kind: "acf-participant-dialogue",
      runId: record.runId as string,
      role: record.role as string,
      participantId: record.participantId as string,
      turnId: record.turnId as string,
    },
  };
}

export function auditInitiatorFields(initiator: ConversationInitiator | null): {
  actor: string;
  initiator?: ConversationInitiator;
  initiatorVerified?: false;
} {
  if (!initiator) return { actor: "operator" };
  return {
    actor: `acf:${initiator.runId}:${initiator.role}`,
    initiator,
    initiatorVerified: false,
  };
}
