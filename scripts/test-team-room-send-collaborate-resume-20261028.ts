/**
 * Regression: "Verstuur + samenwerken" never started collaboration (Dennis, LIVE run
 * RUN-TR-20261028-030112-7823, 2026-10-28). ACF's team-say opens operator intervention I11
 * (run PAUSED); the combined flow then required ACTIVE and stopped. Fix: accept exactly that
 * own intervention as a valid start; ACF team-collaborate ends it itself (no reply owed).
 * The fixture is the real LIVE teamView of that run after the five directed replies.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const HERE = join(process.cwd(), "scripts");
import { mayEndOwnInterventionForCollaboration, safeToStartCollaborationAfterReplies } from "../src/lib/acf/continuous-room-policy";
import type { AcfTeamViewV1 } from "../src/lib/acf/types";

const real = JSON.parse(readFileSync(join(HERE, "fixtures-run-7823-teamview.json"), "utf8")) as AcfTeamViewV1;
const roles = ["claude-code", "codex", "gemini", "hermes", "openclaw"];
const SEQ_AT_CLICK = 10; // M1 (team open note) was seq 10; team-say opened I11 at seq 11.
const clone = (patch: Partial<AcfTeamViewV1> = {}) => ({ ...JSON.parse(JSON.stringify(real)), ...patch }) as AcfTeamViewV1;

test("R1 real LIVE state reproduces the bug: old gate refuses after own team-say", () => {
  assert.equal(real.run_status, "PAUSED");
  assert.equal(real.intervention?.open?.owed?.length ?? 0, 0);
  assert.equal(safeToStartCollaborationAfterReplies(real, roles), false);
});

test("R2 fix: own intervention (opened after the click, all replies settled) may be ended once", () => {
  assert.equal(mayEndOwnInterventionForCollaboration(real, roles, SEQ_AT_CLICK), true);
});

test("R3 after team-resume (ACTIVE, no intervention) the existing start gate passes", () => {
  const resumed = clone({ run_status: "ACTIVE", intervention: { open: null, count: 1, history: [] } });
  assert.equal(safeToStartCollaborationAfterReplies(resumed, roles), true);
  assert.equal(mayEndOwnInterventionForCollaboration(resumed, roles, SEQ_AT_CLICK), false);
});

test("N1 an earlier operator pause is never ended by the combined click", () => {
  assert.equal(mayEndOwnInterventionForCollaboration(real, roles, 11), false);
  assert.equal(mayEndOwnInterventionForCollaboration(real, roles, 25), false);
  assert.equal(mayEndOwnInterventionForCollaboration(real, roles, Number.NaN), false);
});

test("N2 owed replies, in-flight turn, open/pending window or unbound role keep it closed", () => {
  const owed = clone(); owed.intervention!.open!.owed = [{ message_id: "M6", to: "openclaw" }];
  assert.equal(mayEndOwnInterventionForCollaboration(owed, roles, SEQ_AT_CLICK), false);
  assert.equal(mayEndOwnInterventionForCollaboration(clone({ in_flight: { step: 9 } }), roles, SEQ_AT_CLICK), false);
  const win = clone({ collaboration: { window_id: "C1", order: roles, rounds: 4, posted: 0, total: 20, status: "RUNNING" } });
  assert.equal(mayEndOwnInterventionForCollaboration(win, roles, SEQ_AT_CLICK), false);
  const pend = clone({ collaboration: { window_id: "C1", order: roles, rounds: 4, posted: 20, total: 20, status: "ENDED",
    open_pending: [{ turn_id: "T1", role: "codex" }] } });
  assert.equal(mayEndOwnInterventionForCollaboration(pend, roles, SEQ_AT_CLICK), false);
  assert.equal(mayEndOwnInterventionForCollaboration(real, [...roles, "manus"], SEQ_AT_CLICK), false);
  assert.equal(mayEndOwnInterventionForCollaboration(real, ["codex"], SEQ_AT_CLICK), false);
  assert.equal(mayEndOwnInterventionForCollaboration(clone({ run_status: "ACTIVE" }), roles, SEQ_AT_CLICK), false);
  assert.equal(mayEndOwnInterventionForCollaboration(null, roles, SEQ_AT_CLICK), false);
});

test("U1 combined button wiring: own-pause state starts team-collaborate directly; own busy label", () => {
  const src = readFileSync(join(HERE, "../src/components/team-room/FreeRoomPanel.tsx"), "utf8");
  const send = src.slice(src.indexOf("async function send("), src.indexOf("async function collaborate("));
  const iReplies = send.indexOf('settle("replies")');
  const iGate = send.indexOf("mayEndOwnInterventionForCollaboration(current, chosenRoles, lastSeqBeforeSend)");
  const iCollab = send.indexOf('callControl("team-collaborate"');
  assert.ok(iReplies > 0 && iGate > iReplies && iCollab > iGate, "order: replies -> gate -> collaborate");
  assert.equal(send.includes('callControl("team-resume"'), false, "ACF itself ends the intervention");
  assert.match(send, /lastSeqBeforeSend = run\.teamView\?\.last_seq/);
  assert.match(src, /busy==="free-room-send-collaborate" \? "Bezig: antwoorden, dan samenwerken…"/);
  assert.match(send, /setBusy\(withCollaboration \? "free-room-send-collaborate" : "free-room-send"\)/);
});

test("U2 ACF routing notes are labelled Systeem, not Dennis", () => {
  const src = readFileSync(join(HERE, "../src/components/team-room/FreeRoomPanel.tsx"), "utf8");
  assert.match(src, /m\.origin\?\.via === "ACF_COLLAB" \|\| m\.origin\?\.via === "ACF_COLLAB_HANDOVER"/);
  assert.match(src, /acfSystem \? "Systeem \(ACF\)" : operator \? "Dennis"/);
  const vias = (real as unknown as { via?: string }) && ["ACF_COLLAB", "ACF_COLLAB_HANDOVER"];
  assert.equal(vias.length, 2);
});

test("U3 Stop offers pause (resumable) next to final close, and warns about ACK/NACK first", () => {
  const src = readFileSync(join(HERE, "../src/components/team-room/FreeRoomPanel.tsx"), "utf8");
  const box = src.slice(src.indexOf('data-testid="free-room-stop-confirm"'), src.indexOf('data-testid="free-room-stop-confirm-button"') + 400);
  assert.match(box, /Pauzeren of definitief afsluiten\?/);
  assert.match(box, /data-testid="free-room-stop-pause-instead"[\s\S]*disabled=\{!canPause\}[\s\S]*void pauseRoom\(\)/);
  assert.match(box, /Definitief afsluiten/);
  assert.match(box, /ACK\/NACK/);
  assert.equal(box.includes("Bevestig stoppen"), false);
});
