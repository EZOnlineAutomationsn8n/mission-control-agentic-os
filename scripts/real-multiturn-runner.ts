// ACF-MC-CONTINUOUS-CONVERSATION-RECOVERY-20261020-001 — REAL multi-turn validation of the patched runner.
// Runs the staging runner.ts inside the Mission Control container: real Claude Code CLI, real FCC, real native
// session store. Own fresh test conversation (new claudeSessionId), permission mode "plan" (read-only), no MC app
// state, no operator session touched. Prints one JSON line per turn.
import { randomUUID } from "node:crypto";
import type { ClaudeCodeSession } from "../src/lib/claude-code/session-store";

const { runClaudeCodeTurn } = await import("../src/lib/claude-code/runner");
const now = new Date().toISOString();
const session: ClaudeCodeSession = {
  sessionKey: "acf-continuity-real-003",
  claudeSessionId: randomUUID(),
  displayName: "acf-continuity-real-003",
  workspace: process.cwd(),
  permissionMode: "plan",
  executionMode: "on-demand-cli",
  status: "idle",
  active: true,
  createdAt: now,
  updatedAt: now,
  lastError: null,
};
const questions = [
  "Onthoud dit codewoord voor de rest van ons gesprek: KOPERVIS. Antwoord alleen: OK.",
  "Wat is 7 maal 6? Antwoord alleen met het getal.",
  "Welk codewoord gaf ik je aan het begin? Antwoord alleen met het woord.",
  "Noem een kleur van de regenboog. Eén woord.",
  "PAUSE",
  "Ik was even weg. Herhaal het codewoord en het antwoord op de rekensom, gescheiden door een komma.",
  "Laatste vraag: antwoord alleen JA als je dit gesprek nog volgt.",
];
console.log(JSON.stringify({ phase: "start", claudeSessionId: session.claudeSessionId, at: new Date().toISOString() }));
let turn = 0;
let created = false;
for (const q of questions) {
  if (q === "PAUSE") { await new Promise((r) => setTimeout(r, 60_000)); console.log(JSON.stringify({ phase: "pause_60s_done" })); continue; }
  turn += 1;
  const t0 = Date.now();
  const r = await runClaudeCodeTurn({ session, prompt: q, create: !created });
  created = true; // after the first attempt the native session exists: always --resume, as Mission Control does
  console.log(JSON.stringify({
    turn, seconds: Math.round((Date.now() - t0) / 1000), status: r.status, text: (r.text ?? "").slice(0, 200),
    error: r.error ? String(r.error).slice(-240) : null, route: r.transportModelAlias,
    attempts: (r.attempts ?? []).map((a) => [a.routeNumber, a.outcome]), claudeSessionId: session.claudeSessionId,
  }));
}
console.log(JSON.stringify({ phase: "done", at: new Date().toISOString() }));
