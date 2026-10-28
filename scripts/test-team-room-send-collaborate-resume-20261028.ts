/**
 * Regression: "Verstuur + samenwerken" never started collaboration (Dennis, LIVE run
 * RUN-TR-20261028-030112-7823, 2026-10-28). ACF's team-say opens operator intervention I11
 * (run PAUSED); the combined flow then required ACTIVE and stopped. Fix: end exactly that
 * own intervention (team-resume) once, re-read, then team-collaborate.
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

test("U1 combined button wiring: resume between replies and collaborate; own busy label", () => {
  const src = readFileSync(join(HERE, "../src/components/team-room/FreeRoomPanel.tsx"), "utf8");
  const send = src.slice(src.indexOf("async function send("), src.indexOf("async function collaborate("));
  const iReplies = send.indexOf('settle("replies")');
  const iResume = send.indexOf('callControl("team-resume"');
  const iCollab = send.indexOf('callControl("team-collaborate"');
  assert.ok(iReplies > 0 && iResume > iReplies && iCollab > iResume, "order: replies -> resume -> collaborate");
  assert.match(send, /abandon_owed_replies: false/);
  assert.match(send, /lastSeqBeforeSend = run\.teamView\?\.last_seq/);
  assert.match(src, /busy==="free-room-send-collaborate" \? "Bezig: antwoorden, dan samenwerken…"/);
  assert.match(send, /setBusy\(withCollaboration \? "free-room-send-collaborate" : "free-room-send"\)/);
});
