"use client";

/**
 * Dennis's operator seat in the existing ACF Team Room (order ACF-OPERATOR-CONTROL-DECK-REALWORLD-001, 2026-10-14).
 *
 * Truth rules, from contracts/ACF_TEAM_ROOM_CONTROL_V1.md §8-§11:
 * - Default is AUTONOMOUS. Dennis is an optional operator, not a fifth agent and not an approval step.
 * - Opening the deck or typing a draft calls nothing. The team is never paused by drafting.
 * - ACF delivers an operator message only inside an open intervention (team-say refuses otherwise:
 *   NO_OPEN_INTERVENTION). So sending while the team runs autonomously IS a pause: the preview says so and an explicit
 *   confirmation is required. There is no non-pausing delivery and the deck does not pretend there is.
 * - Every consequential action shows a preview first: what runs, which agents, how many turns, what changes.
 * - Replies are shown with their agent, session, message and conversation references from ACF's own store.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  AcfDirectedTurn,
  AcfInterventionMessage,
  AcfInterventionWindow,
  AcfMessageReadModel,
  AcfTeamRoomRun,
} from "@/lib/acf/types";

export type ControlAnswer = { ok: boolean; code?: string; detail?: string; result?: Record<string, unknown>; sessions?: Record<string, unknown> };
export type CallControl = (verb: string, args: Record<string, unknown>) => Promise<ControlAnswer>;
export type WaitForStep = (runId: string) => Promise<ControlAnswer | null>;
type Participant = { role: string; agent_id: string; session_ref: string; loop_role?: string | null };
type Target = "ONE" | "SELECTED" | "TEAM" | "ORCHESTRATOR";
type Kind = "QUESTION" | "NOTE" | "GUIDANCE";
type Plan = {
  id: string;
  title: string;
  runs: string[];
  agents: string[];
  turns: string;
  state: string;
  warning?: string;
  needsAck?: string;
  confirmLabel: string;
  execute: () => Promise<void>;
};
type SessionsAnswer = {
  ok: boolean;
  code?: string;
  detail?: string;
  enabled?: string[];
  answer?: {
    ready?: boolean;
    bindings?: Record<string, { agent_id: string; session_ref: string } | null>;
    roles?: Record<string, { agent_id: string; chosen: string | null; pinned: string | null; why_none: string | null;
      candidates: Array<{ session_ref: string; verdict: string; reason: string; status?: string; live?: { state?: string; reason?: string } }> }>;
  };
};

const AGENT_LABEL: Record<string, string> = {
  "claude-code": "Claude Code", openclaw: "OpenClaw", hermes: "Hermes", agy: "AntiGravity 2.0", antigravity: "AntiGravity 2.0",
  codex: "Codex", gemini: "Gemini",
};
export function agentLabel(agent: string | null | undefined): string {
  return agent ? AGENT_LABEL[agent] ?? agent : "onbekend";
}

/** Plain words for ACF's refusal codes (handoff R5). The code itself is always shown too. */
const CODE_WORDS: Record<string, string> = {
  NO_OPEN_INTERVENTION: "Er is geen open ingreep; eerst ingrijpen.",
  INTERVENTION_NOTHING_OWED: "Er staat geen antwoord meer open.",
  INTERVENTION_REPLIES_OWED: "Er staan nog antwoorden open. Haal ze op, of geef ze bewust op bij hervatten.",
  ORCHESTRATOR_TAKES_QUESTIONS: "De orchestrator beantwoordt alleen vragen.",
  TEAM_SESSION_NOT_READY: "Een sessie is nu niet klaar (gestopt, bezig of fout). Er is niets verstuurd.",
  TEAM_SESSIONS_NOT_READY: "Niet voor elke rol is een klare sessie. Er is niets geopend.",
  NOTHING_TO_REBIND: "Deze rol zit al op die sessie.",
  PREDECESSOR_LOOP_STILL_RUNNING: "De lus van deze run loopt nog; verder bouwen kan pas als hij gestopt is.",
  PREDECESSOR_INTERVENTION_OPEN: "Eerst hervatten; daarna kan een vervolg-run.",
  DIRECTED_REPLY_LIMIT: "Maximum aantal gevraagde antwoorden in deze run bereikt (24).",
  INTERVENTION_MESSAGE_LIMIT: "Maximum aantal operatorberichten in deze run bereikt (40).",
  TEAM_FILES_EXIST: "Er bestaan al bestanden voor deze run-id.",
  RUN_EXISTS: "Deze run-id bestaat al.",
  RUN_NOT_ACTIVE: "De run is niet actief (of er is al een ingreep open).",
  STEP_ALREADY_RUNNING: "Er loopt nog een beurt in deze run; wacht tot hij klaar is.",
  TEAM_STEP_OPEN: "Er loopt nog een beurt in deze run; wacht tot hij klaar is.",
  ROLE_UNBOUND: "Die rol zit niet in deze run.",
  ARGUMENTS: "Ongeldige invoer.",
  ACF_UNAVAILABLE: "ACF antwoordde niet.",
  NETWORK: "Mission Control was niet bereikbaar.",
};
export function refusalText(answer: { code?: string; detail?: string } | null | undefined): string {
  if (!answer) return "geen antwoord";
  const code = answer.code ?? "FOUT";
  const words = CODE_WORDS[code];
  return `${words ? words + " " : ""}(${code}${answer.detail ? `: ${answer.detail}` : ""})`;
}

function readDraft(runId: string): string {
  try { return window.localStorage.getItem(`acf-operator-draft:${runId}`) ?? ""; } catch { return ""; }
}
function writeDraft(runId: string, text: string) {
  try {
    if (text) window.localStorage.setItem(`acf-operator-draft:${runId}`, text);
    else window.localStorage.removeItem(`acf-operator-draft:${runId}`);
  } catch { /* drafts are a convenience only */ }
}

const KIND_INFO: Record<Kind, { label: string; acfKind: "QUESTION" | "NOTE"; reply: boolean; help: string }> = {
  QUESTION: { label: "Vraag", acfKind: "QUESTION", reply: true, help: "De agent antwoordt jou direct (één gerichte beurt per agent)." },
  NOTE: { label: "Notitie", acfKind: "NOTE", reply: true, help: "Een mededeling; de agent reageert er kort op (één gerichte beurt per agent)." },
  GUIDANCE: { label: "Richtlijn", acfKind: "NOTE", reply: false, help: "Geen antwoord gevraagd: de agent leest dit bij zijn volgende eigen beurt in de lus." },
};

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "danger" | "cyan" }) {
  const cls = {
    muted: "border-border text-muted",
    ok: "border-ok/40 text-ok bg-ok/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    danger: "border-danger/40 text-danger bg-danger/10",
    cyan: "border-cyan-400/40 text-cyan-200 bg-cyan-400/10",
  }[tone];
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ id: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={"mc-button mc-button-sm " + (value === o.id ? "mc-button-primary" : "mc-button-secondary") + " disabled:opacity-40"}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ReplyCard({ reply, message }: { reply: AcfDirectedTurn; message: AcfMessageReadModel | null }) {
  const failed = reply.outcome !== "POSTED";
  return (
    <article className={`ml-3 rounded-lg border p-2.5 text-xs ${failed ? "border-danger/40 bg-danger/5" : "border-ok/30 bg-ok/5"}`}
             data-testid="operator-reply">
      <div className="flex flex-wrap items-center gap-1.5">
        <strong className="text-[13px]">{agentLabel(reply.agent_id ?? message?.origin?.agentId)}</strong>
        <span className="text-muted">({reply.role ?? "?"})</span>
        {failed ? <Chip tone="danger">{reply.outcome}</Chip> : <Chip tone="ok">antwoord</Chip>}
        <span className="mono text-[10px] text-muted">{reply.message_id ?? "—"} · seq {reply.seq}</span>
      </div>
      {failed ? (
        <p className="mt-1.5 text-danger">
          Niet beantwoord: {reply.code ?? "?"}{reply.detail ? ` — ${reply.detail}` : ""}. Prompt afgegeven: {reply.prompt_given ?? "UNKNOWN"}.
          ACF probeert dit niet opnieuw.
        </p>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5">{message?.body ?? "(tekst nog niet ingelezen)"}</p>
      )}
      <p className="mt-1.5 break-all mono text-[10px] text-muted">
        sessie {reply.session_ref ?? message?.origin?.sessionRef ?? "?"} · gesprek {reply.conversation_ref ?? message?.origin?.conversationRef ?? "—"} · beurt {reply.turn_id ?? message?.origin?.turnId ?? "—"} · antwoord op {reply.operator_message_id ?? "?"}
      </p>
    </article>
  );
}

function OperatorMessageCard({ m, window: w, owedIds, byId, participants }: {
  m: AcfInterventionMessage; window: AcfInterventionWindow; owedIds: Set<string>; byId: Map<string, AcfMessageReadModel>;
  participants: Participant[];
}) {
  const replies = w.replies.filter((r) => r.operator_message_id === m.message_id);
  const orchestrator = w.orchestrator_answers.filter((o) => o.in_reply_to === m.message_id);
  const who = participants.find((p) => p.role === m.to);
  const kindLabel = m.reply_requested ? (m.kind === "QUESTION" ? "Vraag" : "Notitie") : "Richtlijn";
  return (
    <div className="space-y-2" data-testid="operator-message">
      <article className="rounded-lg border border-cyan-400/40 bg-cyan-400/5 p-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="text-[13px]">Dennis</strong>
          <span className="text-muted">→ {m.to === "ORCHESTRATOR" ? "orchestrator" : `${m.to}${who ? ` (${agentLabel(who.agent_id)})` : ""}`}</span>
          <Chip tone="cyan">{kindLabel}</Chip>
          {m.audience !== "ROLE" && <Chip>{m.audience === "TEAM" ? "heel team" : m.audience === "SELECTED" ? "selectie" : m.audience}</Chip>}
          <span className="mono text-[10px] text-muted">{m.message_id} · seq {m.seq} · {m.group}</span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5">{m.text ?? "(tekst niet ingelezen)"}</p>
      </article>
      {replies.map((r) => (
        <ReplyCard key={`${r.seq}:${r.operator_message_id}`} reply={r} message={r.message_id ? byId.get(r.message_id) ?? null : null} />
      ))}
      {orchestrator.map((o) => {
        const msg = byId.get(o.message_id) ?? null;
        return (
          <article key={o.message_id} className="ml-3 rounded-lg border border-[#d6b25e]/40 bg-[#d6b25e]/5 p-2.5 text-xs" data-testid="operator-reply">
            <div className="flex flex-wrap items-center gap-1.5">
              <strong className="text-[13px]">Orchestrator</strong>
              <Chip tone="warn">regelgebaseerd · geen taalmodel</Chip>
              <span className="mono text-[10px] text-muted">{o.message_id} · seq {o.seq} · antwoord op {o.in_reply_to}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5">{msg?.body ?? "(tekst nog niet ingelezen)"}</p>
          </article>
        );
      })}
      {owedIds.has(m.message_id) && (
        <p className="ml-3 text-[11px] text-warn">Antwoord van {m.to} staat open — haal het op met &quot;Volgend antwoord ophalen&quot;.</p>
      )}
      {!m.reply_requested && (
        <p className="ml-3 text-[11px] text-muted">Geen antwoord gevraagd: {m.to} leest dit bij zijn volgende eigen beurt.</p>
      )}
    </div>
  );
}

export function OperatorDeck({ run, busy, setBusy, callControl, waitForStep, refresh, readView, onSelectRun }: {
  run: AcfTeamRoomRun;
  busy: string | null;
  setBusy: (value: string | null) => void;
  callControl: CallControl;
  waitForStep: WaitForStep;
  refresh: (runId: string) => Promise<void>;
  readView: (runId: string) => Promise<AcfTeamRoomRun["teamView"]>;
  onSelectRun: (runId: string) => void;
}) {
  const tv = run.teamView!;
  const participants = (tv.participants ?? []).filter((p): p is Participant =>
    typeof p.role === "string" && typeof p.agent_id === "string" && typeof p.session_ref === "string");
  const open = tv.intervention?.open ?? null;
  const history = tv.intervention?.history ?? [];
  const owed = open?.owed ?? [];
  const owedIds = new Set(owed.map((o) => o.message_id));
  const byId = useMemo(() => new Map(run.messages.map((m) => [m.messageId, m] as const)), [run.messages]);
  const loopStatus = String(tv.loop?.status ?? "");
  const nextRole = String((tv.loop?.next as { role?: unknown } | null | undefined)?.role ?? "");
  const nsa = tv.next_safe_action ?? "";
  const runActive = tv.run_status === "ACTIVE";
  const intervening = Boolean(open);
  const stepOpen = Boolean(tv.in_flight) || (tv.steps?.open?.length ?? 0) > 0;
  const turnFailed = nsa.includes("A_TURN_FAILED");
  const canContinue = !intervening && !stepOpen && (["STOPPED_ACCEPTED", "STOPPED_UNRESOLVED", "BLOCKED"].includes(loopStatus) || turnFailed);
  const lineage = tv.lineage ?? null;

  // ---- composer state: local only. Nothing here calls ACF. ----
  const [target, setTarget] = useState<Target>("ONE");
  const [one, setOne] = useState<string>(() => participants[0]?.role ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind>("QUESTION");
  const [text, setTextState] = useState<string>(() => readDraft(run.runId));
  const [reason, setReason] = useState("");
  const [fetchNow, setFetchNow] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [sessions, setSessions] = useState<SessionsAnswer | null>(null);
  const [rebindRole, setRebindRole] = useState<string | null>(null);
  const [rebindAgent, setRebindAgent] = useState<string>("");
  const [rebindAnswer, setRebindAnswer] = useState<SessionsAnswer | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const setText = (value: string) => { setTextState(value); writeDraft(run.runId, value); };
  const effectiveKind: Kind = target === "ORCHESTRATOR" ? "QUESTION" : kind;
  const info = KIND_INFO[effectiveKind];
  const addressees: string[] = target === "ONE" ? (one ? [one] : []) : target === "SELECTED" ? participants.map((p) => p.role).filter((r) => selected.includes(r))
    : target === "TEAM" ? participants.map((p) => p.role) : ["ORCHESTRATOR"];
  const textOk = text.trim().length > 0 && text.trim().length <= 6000;
  const reasonText = reason.trim() || "Dennis stuurt het team een bericht";
  const reasonOk = reasonText.length <= 300 && !/[\r\n]/.test(reason);
  const blockedWhy = !runActive && !intervening ? `De run staat op ${tv.run_status}; ingrijpen kan alleen bij een actieve run.`
    : stepOpen ? "Er loopt nu een beurt. Je kunt rustig verder typen; versturen kan zodra de beurt klaar is."
      : busy ? "Er loopt een actie in de room; wacht even."
        : addressees.length === 0 ? "Kies wie het bericht krijgt."
          : !textOk ? "Schrijf eerst je bericht (max. 6000 tekens)."
            : !reasonOk ? "Reden: één regel, max. 300 tekens." : null;

  const who = useCallback((role: string) => {
    if (role === "ORCHESTRATOR") return "Orchestrator (DETERMINISTIC_LOCAL, regelgebaseerd, geen taalmodel)";
    const p = participants.find((x) => x.role === role);
    return p ? `${role} · ${agentLabel(p.agent_id)} · sessie ${p.session_ref}` : role;
  }, [participants]);

  /** Fetch owed replies one by one, each as a background step (handoff R11). Stops on the first failure. */
  const processOwed = useCallback(async (limit: number) => {
    for (let i = 1; i <= limit; i++) {
      const view = await readView(run.runId);
      const pending = view?.intervention?.open?.owed ?? [];
      if (pending.length === 0) break;
      const next = pending[0];
      setProgress(`Antwoord ${i}/${Math.min(limit, pending.length + i - 1)}: ${who(next.to)} werkt aan het antwoord op ${next.message_id}…`);
      const started = await callControl("team-step", { run_id: run.runId });
      if (!started.ok) { setNote(`Antwoord niet gestart: ${refusalText(started)}`); break; }
      const done = await waitForStep(run.runId);
      await refresh(run.runId);
      if (!done) { setNote("Het antwoord duurt erg lang; de room ververst vanzelf zodra het er is. Er wordt niets opnieuw verstuurd."); break; }
      if (!done.ok) { setNote(`Antwoord niet gelukt: ${refusalText(done)}`); break; }
      const turn = done.result?.turn as { failed?: boolean; code?: string; detail?: string; prompt_given?: string } | undefined;
      if (turn?.failed) {
        setNote(`${who(next.to)}: geen antwoord (${turn.code ?? "?"}${turn.detail ? `: ${turn.detail}` : ""}; prompt afgegeven: ${turn.prompt_given ?? "UNKNOWN"}). ACF probeert dit niet opnieuw.`);
        break;
      }
      setNote(`Antwoord binnen van ${who(next.to)}.`);
    }
    setProgress(null);
  }, [callControl, readView, refresh, run.runId, waitForStep, who]);

  const runPlan = async (p: Plan) => {
    setPlan(null);
    setAck(false);
    setBusy(p.id);
    setNote(null);
    try {
      await p.execute();
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  // ---- previews ----
  const previewSend = () => {
    if (blockedWhy) return;
    const owesReplies = info.reply;
    const participantTurns = owesReplies ? addressees.filter((a) => a !== "ORCHESTRATOR").length : 0;
    const orchestratorAnswers = addressees.includes("ORCHESTRATOR") ? 1 : 0;
    const runs = [
      ...(intervening ? [] : [`team-intervene — het team pauzeert (reden: "${reasonText}")`]),
      `team-say — ${addressees.length} bericht${addressees.length === 1 ? "" : "en"} (${info.label.toLowerCase()}${owesReplies ? ", antwoord gevraagd" : ", geen antwoord"})`,
      ...(owesReplies && fetchNow ? [`team-step × ${participantTurns + orchestratorAnswers} — antwoorden direct ophalen, één per keer`] : []),
    ];
    setPlan({
      id: "send",
      title: intervening ? "Bericht versturen binnen je ingreep" : "Ingrijpen en bericht versturen",
      runs,
      agents: addressees.map(who),
      turns: owesReplies
        ? `${participantTurns} gerichte agentbeurt${participantTurns === 1 ? "" : "en"} (echte sessie per agent)${orchestratorAnswers ? " + 1 orchestrator-antwoord (geen model)" : ""}${fetchNow ? ", direct na versturen" : ", pas als je ze ophaalt"}. Deze beurten tellen niet mee in het beurtenbudget van de lus.`
        : "Geen beurt: richtlijn zonder antwoord.",
      state: intervening
        ? `Het team blijft gepauzeerd (ingreep ${open?.intervention_id}) tot je Hervatten kiest.`
        : "Het team PAUZEERT nu. Het blijft gepauzeerd tot je Hervatten kiest. Directe bezorging zonder pauze bestaat in ACF niet.",
      warning: intervening ? undefined : "Versturen onderbreekt de zelfstandige samenwerking.",
      confirmLabel: intervening ? "Versturen" : "Ingrijpen en versturen",
      execute: async () => {
        if (!intervening) {
          setProgress("Ingrijpen: het team wordt gepauzeerd…");
          const paused = await callControl("team-intervene", { run_id: run.runId, reason: reasonText });
          if (!paused.ok) { setNote(`Niet ingegrepen, niets verstuurd: ${refusalText(paused)}`); await refresh(run.runId); return; }
        }
        setProgress("Bericht wordt geplaatst…");
        const to = target === "TEAM" ? "TEAM" : target === "ORCHESTRATOR" ? "ORCHESTRATOR" : target === "ONE" ? one : addressees;
        const said = await callControl("team-say", { run_id: run.runId, to, text: text.trim(), kind: info.acfKind, reply: info.reply });
        await refresh(run.runId);
        if (!said.ok) {
          setNote(`Bericht niet geplaatst (je concept is bewaard): ${refusalText(said)}${intervening ? "" : " — het team is wel gepauzeerd; Hervatten zet het weer aan."}`);
          return;
        }
        setText("");
        const placed = (said.result?.messages as Array<{ message_id: string }> | undefined)?.map((m) => m.message_id).join(", ") ?? "";
        setNote(`Geplaatst: ${placed}.${info.reply ? (fetchNow ? "" : " Antwoorden staan open.") : " Geen antwoord gevraagd."}`);
        if (info.reply && fetchNow) await processOwed(addressees.length);
      },
    });
  };

  const previewIntervene = () => {
    setPlan({
      id: "intervene",
      title: "Alleen ingrijpen (pauze)",
      runs: [`team-intervene — reden: "${reasonText}"`],
      agents: ["geen: er wordt niemand aangesproken"],
      turns: "Geen beurt.",
      state: "Het team PAUZEERT. Daarna kun je berichten sturen, een sessie wisselen of hervatten.",
      confirmLabel: "Ingrijpen",
      execute: async () => {
        const r = await callControl("team-intervene", { run_id: run.runId, reason: reasonText });
        await refresh(run.runId);
        setNote(r.ok ? `Je grijpt in (${String(r.result?.intervention_id ?? "")}); het team is gepauzeerd.` : `Niet ingegrepen: ${refusalText(r)}`);
      },
    });
  };

  const previewFetchOwed = () => {
    const next = owed[0];
    if (!next) return;
    setPlan({
      id: "owed",
      title: "Volgend antwoord ophalen",
      runs: ["team-step — ACF maakt het oudste openstaande antwoord, en alleen dat"],
      agents: [who(next.to)],
      turns: next.to === "ORCHESTRATOR" ? "1 orchestrator-antwoord (regelgebaseerd)." : "1 gerichte agentbeurt in zijn echte sessie (kan enkele minuten duren). Mislukt hij, dan wordt hij niet opnieuw geprobeerd.",
      state: "Het team blijft gepauzeerd.",
      confirmLabel: "Ophalen",
      execute: async () => { await processOwed(1); },
    });
  };

  const previewResume = () => {
    setPlan({
      id: "resume",
      title: "Hervatten",
      runs: [`team-resume${owed.length ? " — met opgeven van de openstaande antwoorden" : ""}`],
      agents: participants.map((p) => who(p.role)),
      turns: `Geen beurt nu. Het team gaat daarna zelfstandig verder${nextRole ? `; volgende beurt is aan ${nextRole}` : ""} (via Volgende beurt of Automatisch).`,
      state: "Ingreep gesloten; de zelfstandige samenwerking loopt weer. Wat je zei blijft in de run staan en de agents lezen het mee.",
      warning: owed.length ? `${owed.length} antwoord${owed.length === 1 ? "" : "en"} staat nog open (${owed.map((o) => o.to).join(", ")}).` : undefined,
      needsAck: owed.length ? "Ik geef de openstaande antwoorden bewust op (dit wordt in de run vastgelegd)." : undefined,
      confirmLabel: "Hervatten",
      execute: async () => {
        const r = await callControl("team-resume", { run_id: run.runId, abandon_owed_replies: owed.length > 0 });
        await refresh(run.runId);
        setNote(r.ok ? "Hervat: het team werkt weer zelfstandig." : `Niet hervat: ${refusalText(r)}`);
      },
    });
  };

  const previewContinue = () => {
    const trimmed = instruction.trim();
    if (!trimmed || trimmed.length > 3000) return;
    setPlan({
      id: "continue",
      title: "Verder bouwen in een nieuwe gekoppelde run",
      runs: ["team-continue — nieuwe run, gekoppeld aan deze; deze run blijft precies zoals hij is"],
      agents: participants.map((p) => who(p.role)),
      turns: "Geen beurt nu. De nieuwe run start met de laatste (geaccepteerde) versie plus jouw instructie; daarna Volgende beurt of Automatisch.",
      state: `Nieuwe run (zelfde rollen en sessies). Deze run (${loopStatus || "gestopt"}) wordt niet heropend of herschreven.`,
      confirmLabel: "Vervolg-run openen",
      execute: async () => {
        const r = await callControl("team-continue", { run_id: run.runId, instruction: trimmed });
        if (!r.ok) { setNote(`Geen vervolg-run: ${refusalText(r)}`); return; }
        const next = String(r.result?.run_id ?? "");
        setInstruction("");
        setNote(`Vervolg-run geopend: ${next}.`);
        if (next) onSelectRun(next);
      },
    });
  };

  const checkSessions = async () => {
    setSessions({ ok: true });
    const rolesParam = participants.map((p) => `${p.role}:${p.agent_id}`).join(",");
    const pins = participants.map((p) => `&pin.${encodeURIComponent(p.role)}=${encodeURIComponent(p.session_ref)}`).join("");
    try {
      const response = await fetch(`/api/acf/team-room/sessions?roles=${encodeURIComponent(rolesParam)}${pins}&excludeRun=${encodeURIComponent(run.runId)}`, { cache: "no-store" });
      setSessions(await response.json() as SessionsAnswer);
    } catch (error) {
      setSessions({ ok: false, code: "NETWORK", detail: error instanceof Error ? error.message : "request failed" });
    }
  };

  const loadRebind = async (role: string, agent: string) => {
    setRebindRole(role);
    setRebindAgent(agent);
    setRebindAnswer({ ok: true });
    try {
      const response = await fetch(`/api/acf/team-room/sessions?roles=${encodeURIComponent(`${role}:${agent}`)}&excludeRun=${encodeURIComponent(run.runId)}`, { cache: "no-store" });
      setRebindAnswer(await response.json() as SessionsAnswer);
    } catch (error) {
      setRebindAnswer({ ok: false, code: "NETWORK", detail: error instanceof Error ? error.message : "request failed" });
    }
  };

  const previewRebind = (role: string, agent: string, session: string, pinRequired: boolean) => {
    const current = participants.find((p) => p.role === role);
    setPlan({
      id: "rebind",
      title: `Andere sessie voor ${role}`,
      runs: [`team-rebind — ${role}: ${current ? `${agentLabel(current.agent_id)}/${current.session_ref}` : "?"} → ${agentLabel(agent)}/${session}`],
      agents: [`${role} · ${agentLabel(agent)} · sessie ${session}`],
      turns: "Geen beurt. ACF vraagt de sessie eerst live of hij klaar is; zo niet, dan verandert er niets.",
      state: "De rol werkt vanaf nu in die sessie. Het team blijft gepauzeerd.",
      warning: pinRequired ? `Dit gebruikt je eigen ${agentLabel(agent)}-paneel (${session}): het gesprek daar krijgt de beurten van deze run.` : undefined,
      needsAck: pinRequired ? `Ja, gebruik mijn eigen ${agentLabel(agent)}-paneel voor deze rol.` : undefined,
      confirmLabel: "Sessie wisselen",
      execute: async () => {
        const args: Record<string, unknown> = { run_id: run.runId, role, session_ref: session };
        if (current && agent !== current.agent_id) args.agent_id = agent;
        const r = await callControl("team-rebind", args);
        await refresh(run.runId);
        setRebindRole(null);
        setRebindAnswer(null);
        setNote(r.ok ? `${role} werkt nu in ${agentLabel(agent)}/${session}.` : `Niet gewisseld: ${refusalText(r)}`);
      },
    });
  };

  const enabledAgents = rebindAnswer?.enabled ?? sessions?.enabled ?? Array.from(new Set(participants.map((p) => p.agent_id)));
  const closedWindows = history.filter((w) => w.intervention_id !== open?.intervention_id).slice().reverse();

  return (
    <section id="acf-operator-deck" className="mx-4 my-3 min-w-0 rounded-xl border border-cyan-400/50 bg-panel-2 p-3 sm:p-4" aria-label="Operatorstoel van Dennis">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Operatorstoel · Dennis</div>
          <h2 className="text-base font-semibold sm:text-lg">Bediening van het team</h2>
          <p className="mt-0.5 text-xs text-muted">
            {intervening
              ? "Je grijpt nu in: het team wacht op jou. Typen verandert niets; alleen jouw bevestigde acties doen iets."
              : "Het team werkt zelfstandig. Je hoeft niets te doen; typen of dit paneel openen pauzeert niets."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
          {intervening ? <Chip tone="warn">INGREEP {open?.intervention_id}</Chip> : runActive ? <Chip tone="ok">ZELFSTANDIG</Chip> : <Chip>{tv.run_status}</Chip>}
          {loopStatus && <Chip>lus {loopStatus}</Chip>}
          {stepOpen && <Chip tone="warn">beurt loopt</Chip>}
        </div>
      </header>

      {intervening && (
        <div className="mt-3 rounded-lg border border-warn/50 bg-warn/10 p-3 text-sm" role="status" data-testid="intervention-banner">
          <strong>Dennis grijpt in — team gepauzeerd ({open?.intervention_id})</strong>
          <span className="block text-xs text-muted">Reden: {open?.reason || "—"} · {owed.length ? `${owed.length} antwoord${owed.length === 1 ? "" : "en"} open` : "geen antwoorden open"} · Hervatten zet de zelfstandige samenwerking weer aan.</span>
        </div>
      )}

      {(lineage?.predecessor || (lineage?.successors?.length ?? 0) > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" aria-label="Koppeling tussen runs">
          {lineage?.predecessor && (
            <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => onSelectRun(lineage.predecessor!.run_id)}>
              ← vervolg van {lineage.predecessor.run_id} ({lineage.predecessor.loop_status ?? "?"})
            </button>
          )}
          {(lineage?.successors ?? []).map((s) => {
            const id = typeof s === "string" ? s : s.run_id;
            return (
              <button key={id} type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => onSelectRun(id)}>
                vervolgd in {id} →
              </button>
            );
          })}
          <span className="text-muted">Een vervolg-run is een nieuwe run; deze run is niet voortgezet of afgerond.</span>
        </div>
      )}

      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------------- composer ---------------- */}
        <div className="min-w-0 rounded-lg border border-border bg-background/40 p-3" aria-label="Bericht opstellen">
          <div className="text-sm font-semibold">Bericht aan het team</div>
          <div className="mt-2 text-[11px] uppercase tracking-[0.1em] text-muted">Aan</div>
          <div className="mt-1">
            <Segmented<Target>
              label="Ontvanger"
              value={target}
              onChange={setTarget}
              options={[
                { id: "ONE", label: "Eén agent" },
                { id: "SELECTED", label: "Selectie", disabled: participants.length < 2 },
                { id: "TEAM", label: "Heel team" },
                { id: "ORCHESTRATOR", label: "Orchestrator" },
              ]}
            />
          </div>
          {(target === "ONE" || target === "SELECTED") && (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Agents">
              {participants.map((p) => {
                const active = target === "ONE" ? one === p.role : selected.includes(p.role);
                return (
                  <button
                    key={p.role}
                    type="button"
                    aria-pressed={active}
                    onClick={() => target === "ONE" ? setOne(p.role) : setSelected((s) => s.includes(p.role) ? s.filter((r) => r !== p.role) : [...s, p.role])}
                    className={"rounded-lg border px-2.5 py-1.5 text-left text-xs " + (active ? "border-cyan-400/70 bg-cyan-400/10" : "border-border bg-panel-2")}
                  >
                    <span className="font-semibold">{agentLabel(p.agent_id)}</span> <span className="text-muted">({p.role})</span>
                    <span className="block mono text-[10px] text-muted">{p.session_ref}</span>
                  </button>
                );
              })}
            </div>
          )}
          {target === "ORCHESTRATOR" && (
            <p className="mt-2 text-[11px] text-muted">De orchestrator van deze run is DETERMINISTIC_LOCAL: hij antwoordt met wat de run laat zien en de regel die hij toepast. Hij heeft geen taalmodel en zegt dat ook.</p>
          )}

          <div className="mt-3 text-[11px] uppercase tracking-[0.1em] text-muted">Soort</div>
          <div className="mt-1">
            <Segmented<Kind>
              label="Soort bericht"
              value={effectiveKind}
              onChange={setKind}
              options={[
                { id: "QUESTION", label: "Vraag" },
                { id: "NOTE", label: "Notitie", disabled: target === "ORCHESTRATOR", title: target === "ORCHESTRATOR" ? "De orchestrator beantwoordt alleen vragen" : undefined },
                { id: "GUIDANCE", label: "Richtlijn", disabled: target === "ORCHESTRATOR", title: target === "ORCHESTRATOR" ? "De orchestrator beantwoordt alleen vragen" : undefined },
              ]}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted">{info.help}</p>

          <label className="mt-3 block text-[11px] uppercase tracking-[0.1em] text-muted" htmlFor="acf-operator-text">Bericht</label>
          <textarea
            id="acf-operator-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={6000}
            placeholder="Schrijf rustig; het team loopt gewoon door. Pas bij versturen wordt er iets gedaan."
            className="mt-1 w-full min-w-0 rounded-lg border border-border bg-background p-3 text-sm"
          />
          <div className="mt-1 flex flex-wrap justify-between gap-2 text-[10px] text-muted">
            <span>Concept wordt alleen in deze browser bewaard.</span>
            <span>{text.trim().length}/6000</span>
          </div>

          {!intervening && (
            <>
              <label className="mt-2 block text-[11px] uppercase tracking-[0.1em] text-muted" htmlFor="acf-operator-reason">Reden van ingrijpen (één regel)</label>
              <input
                id="acf-operator-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.replace(/[\r\n]/g, " "))}
                maxLength={300}
                placeholder="Dennis stuurt het team een bericht"
                className="mt-1 w-full min-w-0 rounded-lg border border-border bg-background p-2 text-sm"
              />
            </>
          )}

          {info.reply && (
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={fetchNow} onChange={(e) => setFetchNow(e.target.checked)} />
              Antwoorden direct ophalen na versturen
            </label>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="mc-button mc-button-primary disabled:opacity-50" disabled={Boolean(blockedWhy)} onClick={previewSend} data-testid="operator-send">
              {intervening ? "Bekijk en verstuur…" : "Bekijk: ingrijpen en versturen…"}
            </button>
            {!intervening && runActive && (
              <button type="button" className="mc-button mc-button-secondary disabled:opacity-50" disabled={Boolean(busy) || stepOpen || !reasonOk} onClick={previewIntervene}>
                Alleen ingrijpen…
              </button>
            )}
          </div>
          {blockedWhy && text.trim().length > 0 && <p className="mt-2 text-[11px] text-muted">{blockedWhy}</p>}
          {!intervening && runActive && <p className="mt-2 text-[11px] text-warn">Let op: ACF bezorgt een operatorbericht alleen binnen een ingreep. Versturen pauzeert dus het team, na jouw bevestiging.</p>}
        </div>

        {/* ---------------- intervention thread and controls ---------------- */}
        <div className="min-w-0 space-y-3">
          {plan && (
            <div className="rounded-lg border border-cyan-400/70 bg-background/70 p-3 text-xs" role="dialog" aria-label={`Voorbeeld: ${plan.title}`} data-testid="operator-preview">
              <div className="text-sm font-semibold">Voorbeeld · {plan.title}</div>
              <dl className="mt-2 space-y-2">
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-muted">Wat er gebeurt</dt><dd><ol className="ml-4 list-decimal">{plan.runs.map((r) => <li key={r} className="break-words">{r}</li>)}</ol></dd></div>
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-muted">Wie</dt><dd><ul className="ml-4 list-disc">{plan.agents.map((a) => <li key={a} className="break-words">{a}</li>)}</ul></dd></div>
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-muted">Beurten</dt><dd>{plan.turns}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-muted">Toestand daarna</dt><dd>{plan.state}</dd></div>
              </dl>
              {plan.warning && <p className="mt-2 rounded border border-warn/50 bg-warn/10 p-2 text-warn">{plan.warning}</p>}
              {plan.needsAck && (
                <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />{plan.needsAck}</label>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="mc-button mc-button-success disabled:opacity-50" disabled={Boolean(busy) || (Boolean(plan.needsAck) && !ack)} onClick={() => void runPlan(plan)} data-testid="operator-confirm">{plan.confirmLabel}</button>
                <button type="button" className="mc-button mc-button-secondary" onClick={() => { setPlan(null); setAck(false); }}>Annuleren</button>
              </div>
            </div>
          )}

          {(progress || note) && (
            <div className="rounded-lg border border-border/70 bg-background/40 p-2.5 text-xs" role="status" aria-live="polite" data-testid="operator-status">
              {progress && <p className="text-warn">{progress}</p>}
              {note && <p className={progress ? "mt-1" : ""}>{note}</p>}
            </div>
          )}

          {intervening && (
            <div className="rounded-lg border border-border bg-background/40 p-3" aria-label="Ingreep">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Ingreep {open?.intervention_id}</div>
                <div className="flex flex-wrap gap-2">
                  {owed.length > 0 && (
                    <button type="button" className="mc-button mc-button-primary mc-button-sm disabled:opacity-50" disabled={Boolean(busy) || stepOpen} onClick={previewFetchOwed} data-testid="operator-fetch-owed">
                      Volgend antwoord ophalen ({owed.length})
                    </button>
                  )}
                  <button type="button" className="mc-button mc-button-success mc-button-sm disabled:opacity-50" disabled={Boolean(busy) || stepOpen} onClick={previewResume} data-testid="operator-resume">
                    Hervatten…
                  </button>
                </div>
              </div>
              {owed.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px] text-warn">
                  {owed.map((o) => <li key={o.message_id}>Open: antwoord van {who(o.to)} op {o.message_id}</li>)}
                </ul>
              )}
              <div className="mt-3 space-y-3">
                {(open?.messages ?? []).map((m) => (
                  <OperatorMessageCard key={m.message_id} m={m} window={open!} owedIds={owedIds} byId={byId} participants={participants} />
                ))}
                {(open?.messages ?? []).length === 0 && <p className="text-xs text-muted">Nog niets gezegd in deze ingreep.</p>}
              </div>

              {tv.schema !== 2 && <div className="mt-3 border-t border-border/60 pt-3">
                <div className="text-xs font-semibold">Sessies</div>
                <div className="mt-2 space-y-1.5">
                  {participants.map((p) => (
                    <div key={p.role} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 break-all">{p.role} · {agentLabel(p.agent_id)} · <span className="mono">{p.session_ref}</span></span>
                      <button type="button" className="mc-button mc-button-secondary mc-button-sm disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void loadRebind(p.role, p.agent_id)}>
                        Andere sessie…
                      </button>
                    </div>
                  ))}
                </div>
                {rebindRole && rebindAnswer && (
                  <div className="mt-2 rounded border border-border p-2 text-xs" aria-label={`Sessies voor ${rebindRole}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Sessies voor <strong>{rebindRole}</strong>, agent</span>
                      <select value={rebindAgent} onChange={(e) => void loadRebind(rebindRole, e.target.value)} className="rounded border border-border bg-background px-1.5 py-1 text-xs">
                        {enabledAgents.map((a) => <option key={a} value={a}>{agentLabel(a)}</option>)}
                      </select>
                      <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => { setRebindRole(null); setRebindAnswer(null); }}>Sluiten</button>
                    </div>
                    {!rebindAnswer.answer && rebindAnswer.ok && <p className="mt-2 text-muted">Sessies worden opgevraagd…</p>}
                    {!rebindAnswer.ok && <p className="mt-2 text-danger">{refusalText(rebindAnswer)}</p>}
                    <ul className="mt-2 space-y-1">
                      {(rebindAnswer.answer?.roles?.[rebindRole]?.candidates ?? []).map((c) => {
                        const usable = c.verdict === "ELIGIBLE" || c.verdict === "ELIGIBLE_PIN_REQUIRED";
                        const current = participants.find((p) => p.role === rebindRole)?.session_ref === c.session_ref && participants.find((p) => p.role === rebindRole)?.agent_id === rebindAgent;
                        return (
                          <li key={c.session_ref} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 break-all"><span className="mono">{c.session_ref}</span> <Chip tone={usable ? "ok" : "muted"}>{c.verdict}</Chip> <span className="text-muted">{c.reason}</span></span>
                            {usable && !current && (
                              <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => previewRebind(rebindRole, rebindAgent, c.session_ref, c.verdict === "ELIGIBLE_PIN_REQUIRED")}>
                                {c.verdict === "ELIGIBLE_PIN_REQUIRED" ? `Kiezen (gebruikt je eigen ${agentLabel(rebindAgent)}-paneel)` : "Kiezen"}
                              </button>
                            )}
                            {current && <Chip tone="cyan">huidige</Chip>}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-[10px] text-muted">Mission Control start, stopt of maakt hier geen sessie aan.</p>
                  </div>
                )}
              </div>}
            </div>
          )}

          {!intervening && (
            <div className="rounded-lg border border-border bg-background/40 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Sessies van deze run</span>
                <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => void checkSessions()}>Sessies controleren</button>
              </div>
              <ul className="mt-2 space-y-1">
                {participants.map((p) => {
                  const row = sessions?.answer?.roles?.[p.role];
                  const seen = row?.candidates.find((c) => c.session_ref === p.session_ref);
                  return (
                    <li key={p.role} className="break-all">
                      {p.role} · {agentLabel(p.agent_id)} · <span className="mono">{p.session_ref}</span>{" "}
                      {seen ? <Chip tone={seen.live?.state === "READY" ? "ok" : "warn"}>{seen.live?.state ?? seen.verdict}</Chip> : null}
                      {seen && seen.live?.state !== "READY" && <span className="text-muted"> {seen.reason}</span>}
                    </li>
                  );
                })}
              </ul>
              {sessions && !sessions.ok && <p className="mt-2 text-danger">{refusalText(sessions)}</p>}
              {sessions?.ok && !sessions.answer && <p className="mt-2 text-muted">Sessies worden opgevraagd…</p>}
            </div>
          )}

          {canContinue && (
            <div className="rounded-lg border border-border bg-background/40 p-3" aria-label="Verder bouwen">
              <div className="text-sm font-semibold">Verder bouwen (nieuwe gekoppelde run)</div>
              <p className="mt-1 text-[11px] text-muted">
                De lus van deze run is gestopt ({loopStatus || "beurt mislukt"}). Dit is géén afgeronde run; verder bouwen opent een nieuwe run die hierop voortbouwt.
              </p>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                maxLength={3000}
                placeholder="Wat moet het team nu met het resultaat doen?"
                className="mt-2 w-full min-w-0 rounded-lg border border-border bg-background p-2.5 text-sm"
                aria-label="Instructie voor de vervolg-run"
              />
              <button type="button" className="mt-2 mc-button mc-button-primary disabled:opacity-50" disabled={Boolean(busy) || !instruction.trim()} onClick={previewContinue}>
                Bekijk: vervolg-run openen…
              </button>
            </div>
          )}

          {closedWindows.length > 0 && (
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <button type="button" className="flex w-full items-center justify-between text-left text-sm font-semibold" onClick={() => setShowClosed((s) => !s)} aria-expanded={showClosed}>
                <span>Eerdere ingrepen ({closedWindows.length})</span>
                <span className="mc-button mc-button-secondary mc-button-sm">{showClosed ? "Verbergen" : "Tonen"}</span>
              </button>
              {showClosed && (
                <div className="mt-3 space-y-4">
                  {closedWindows.map((w) => (
                    <div key={w.intervention_id} className="space-y-2">
                      <p className="text-[11px] text-muted">{w.intervention_id} · {w.reason || "—"} · gesloten door {w.closed_by ?? "?"} (seq {w.closed_seq ?? "?"})</p>
                      {w.messages.map((m) => (
                        <OperatorMessageCard key={m.message_id} m={m} window={w} owedIds={new Set()} byId={byId} participants={participants} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Choosing sessions before team-open (handoff R6): agents per role, ACF's choice, and explicit pins only. */
export function TeamOpenSessions({ roles, setRoles, pins, setPins, answer, setAnswer }: {
  roles: Record<string, string>;
  setRoles: (roles: Record<string, string>) => void;
  pins: Record<string, string>;
  setPins: (pins: Record<string, string>) => void;
  answer: SessionsAnswer | null;
  setAnswer: (answer: SessionsAnswer | null) => void;
}) {
  const [checking, setChecking] = useState(false);
  const enabled = answer?.enabled ?? ["claude-code", "hermes", "openclaw"];
  const check = async (nextRoles = roles, nextPins = pins) => {
    setChecking(true);
    try {
      const roleParam = Object.entries(nextRoles).map(([r, a]) => `${r}:${a}`).join(",");
      const pinParam = Object.entries(nextPins).filter(([, s]) => s).map(([r, s]) => `&pin.${encodeURIComponent(r)}=${encodeURIComponent(s)}`).join("");
      const response = await fetch(`/api/acf/team-room/sessions?roles=${encodeURIComponent(roleParam)}${pinParam}`, { cache: "no-store" });
      setAnswer(await response.json() as SessionsAnswer);
    } catch (error) {
      setAnswer({ ok: false, code: "NETWORK", detail: error instanceof Error ? error.message : "request failed" });
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="mt-3 rounded-lg border border-border bg-background/40 p-3 text-xs" aria-label="Sessies kiezen">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Wie doet mee</span>
        <button type="button" className="mc-button mc-button-secondary mc-button-sm disabled:opacity-50" disabled={checking} onClick={() => void check()}>
          {checking ? "Controleren…" : "Sessies controleren"}
        </button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {Object.entries(roles).map(([role, agent]) => {
          const row = answer?.answer?.roles?.[role];
          const choosable = (row?.candidates ?? []).filter((c) => c.verdict === "ELIGIBLE" || c.verdict === "ELIGIBLE_PIN_REQUIRED");
          const chosen = answer?.answer?.bindings?.[role];
          return (
            <div key={role} className="min-w-0 rounded border border-border p-2">
              <label className="block text-[11px] uppercase tracking-[0.1em] text-muted">{role === "builder" ? "Bouwer" : role === "reviewer" ? "Reviewer" : role}</label>
              <select
                value={agent}
                onChange={(e) => { const next = { ...roles, [role]: e.target.value }; const nextPins = { ...pins, [role]: "" }; setRoles(next); setPins(nextPins); setAnswer(null); }}
                className="mt-1 w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
              >
                {enabled.map((a) => <option key={a} value={a}>{agentLabel(a)}</option>)}
              </select>
              {chosen && <p className="mt-1.5 break-all text-ok">Sessie: <span className="mono">{chosen.session_ref}</span> (klaar)</p>}
              {row && !chosen && <p className="mt-1.5 text-warn">{row.why_none}</p>}
              {row && (
                <select
                  value={pins[role] ?? ""}
                  onChange={(e) => { const nextPins = { ...pins, [role]: e.target.value }; setPins(nextPins); void check(roles, nextPins); }}
                  className="mt-1.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
                  aria-label={`Sessie vastzetten voor ${role}`}
                >
                  <option value="">Automatisch (alleen acf-sessies)</option>
                  {choosable.map((c) => (
                    <option key={c.session_ref} value={c.session_ref}>
                      {c.session_ref}{c.verdict === "ELIGIBLE_PIN_REQUIRED" ? ` — gebruikt je eigen ${agentLabel(agent)}-paneel` : ""}
                    </option>
                  ))}
                </select>
              )}
              {row && row.candidates.some((c) => !(c.verdict === "ELIGIBLE" || c.verdict === "ELIGIBLE_PIN_REQUIRED")) && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-muted">Niet bruikbaar ({row.candidates.filter((c) => !(c.verdict === "ELIGIBLE" || c.verdict === "ELIGIBLE_PIN_REQUIRED")).length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {row.candidates.filter((c) => !(c.verdict === "ELIGIBLE" || c.verdict === "ELIGIBLE_PIN_REQUIRED")).map((c) => (
                      <li key={c.session_ref} className="break-all"><span className="mono">{c.session_ref}</span> · {c.verdict} · <span className="text-muted">{c.reason}</span></li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
      {answer && !answer.ok && <p className="mt-2 text-danger">{refusalText(answer)}</p>}
      <p className="mt-2 text-[10px] text-muted">ACF kiest alleen bestaande, klare sessies. Een eigen paneel gebruikt het alleen als jij het hier vastzet. Er wordt niets gestart of aangemaakt.</p>
    </div>
  );
}
