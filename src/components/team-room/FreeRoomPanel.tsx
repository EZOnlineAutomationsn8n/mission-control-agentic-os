"use client";

import { useMemo, useState } from "react";
import type { AcfTeamRoomRun, AcfTeamViewV1 } from "@/lib/acf/types";
import { deriveEvidenceGroupReport, type EvidenceKind } from "@/lib/acf/evidence-group-report";
import { agentLabel, refusalText, type CallControl, type ControlAnswer, type WaitForStep } from "./OperatorDeck";
import { FREE_ROOM_STEPS_PER_CLICK, availableWindowFromStore, isUncertainTurnOutcome, readFreeRoomState,
  type FreeRoomPendingKind } from "@/lib/acf/continuous-room-policy";

type Props = {
  run: AcfTeamRoomRun;
  busy: string | null;
  setBusy: (value: string | null) => void;
  callControl: CallControl;
  waitForStep: WaitForStep;
  readView: (runId: string) => Promise<AcfTeamViewV1 | null>;
  refresh: (runId: string | null) => Promise<void>;
  disabled: boolean;
};
const limit = 6000;

/** ACF is the only conversation writer. One click sends once; steps are never retried after an unknown result. */
export function FreeRoomPanel({ run, busy, setBusy, callControl, waitForStep, readView, refresh, disabled }: Props) {
  const members = useMemo(() => (run.teamView?.participants ?? []).map(p => ({
    handle: p.role ?? "",
    agent: p.agent_id ?? run.participants.find(x => x.role === p.role)?.agentId ?? null,
    session: p.session_ref ?? run.participants.find(x => x.role === p.role)?.sessionRef ?? null,
  })).filter(p => p.handle), [run.teamView?.participants, run.participants]);
  const [recipients, setRecipients] = useState<string[]>(["TEAM"]);
  const [text, setText] = useState("");
  const [rounds, setRounds] = useState(1);
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  const [thinking, setThinking] = useState("");
  // UI-only operator work chunk. The durable ACF run and its history live in ACF,
  // not in this component. A timeout/error never starts an automatic retry.
  const [uncertain, setUncertain] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [showEvidenceReport, setShowEvidenceReport] = useState(false);
  const report = useMemo(() => deriveEvidenceGroupReport(run), [run]);
  const selected = recipients.includes("TEAM") ? members.map(p => p.handle) : recipients.filter(r => members.some(p => p.handle === r));
  const owed = run.teamView?.intervention?.open?.owed ?? [];
  const collaboration = run.teamView?.collaboration;
  const processing = busy !== null;
  const locked = disabled || processing || !(["ACTIVE", "PAUSED"].includes(run.runState)) || Boolean(run.teamView?.in_flight);
  const byHandle = new Map(members.map(m => [m.handle, m]));
  const ordered = [...run.messages].sort((a, b) => a.sequence - b.sequence);
  const status = readFreeRoomState(run.teamView, collaboration ? "collaboration" : "replies");
  // Store-derived continuation survives browser reload and pane replacement.
  const availableWindow = availableWindowFromStore(run.teamView);
  const canPause = !disabled && !processing && !run.teamView?.in_flight && run.runState === "ACTIVE";
  const canResume = !disabled && !processing && status.mayResume && run.runState === "PAUSED";

  function choose(handle: string) {
    if (handle === "TEAM") { setRecipients(["TEAM"]); return; }
    const next = recipients.includes("TEAM") ? [handle]
      : recipients.includes(handle) ? recipients.filter(x => x !== handle) : [...recipients, handle];
    setRecipients(next.length === members.length ? ["TEAM"] : next);
  }

  async function settle(mode: FreeRoomPendingKind) {
    // Bounded *per-click* work. It is never a terminal cap on room history.
    // No hidden server/browser infinite loop, no new backend scheduling.
    for (let step = 0; step < FREE_ROOM_STEPS_PER_CLICK; step++) {
      const view = await readView(run.runId);
      const state = readFreeRoomState(view, mode);
      if (state.kind === "ended") {
        setThinking(""); setNote(state.label + ". " + state.detail);
        await refresh(run.runId); return;
      }
      if (state.kind !== "ready") {
        setThinking("");
        setNote(state.label + ": " + state.detail + " Geen automatische retry.");
        if (state.kind === "pending" || state.kind === "unknown") setUncertain(true);
        await refresh(run.runId); return;
      }
      if (!view) return;
      if (mode === "replies") {
        const target = view.intervention?.open?.owed?.[0]?.to ?? null;
        setThinking((byHandle.get(target ?? "")?.agent ? agentLabel(byHandle.get(target ?? "")?.agent) : (target ?? "Agent")) + " denkt na…");
      } else {
        const group = view.collaboration;
        const next = group?.order?.length ? group.order[(group.posted ?? 0) % group.order.length] : null;
        setThinking((byHandle.get(next ?? "")?.agent ? agentLabel(byHandle.get(next ?? "")?.agent) : (next ?? "Agent")) + " denkt na…");
      }
      const started = await callControl("team-step", { run_id: run.runId });
      if (!started.ok) {
        if (started.code === "INTERVENTION_NOTHING_OWED") {
          setThinking(""); setNote("Geen antwoorden meer open.");
          await refresh(run.runId); return;
        }
        if (isUncertainTurnOutcome(started.code)) setUncertain(true);
        throw Error("Beurt niet gestart: " + refusalText(started) + ". Controleer de ACF-journal voordat je verdergaat.");
      }
      const finished: ControlAnswer | null = await waitForStep(run.runId);
      if (!finished) {
        setUncertain(true);
        throw Error("Beurtstatus onbekend. Geen retry: controleer het ACF-journal en eventuele late respons.");
      }
      if (!finished.ok) {
        if (finished.code === "INTERVENTION_NOTHING_OWED") {
          setThinking(""); await refresh(run.runId); return;
        }
        if (isUncertainTurnOutcome(finished.code)) setUncertain(true);
        throw Error("ACF meldde: " + refusalText(finished) + ". Geen automatische retry.");
      }
      await refresh(run.runId);
    }
    // Safe yield. An operator can choose the next bounded chunk explicitly.
    setThinking("");
    setNote("Werkvenster van " + FREE_ROOM_STEPS_PER_CLICK + " beurten afgerond. Kamer en geschiedenis blijven behouden. Controleer de voortgang en kies zelf 'Volgende reeks' om door te gaan.");
    await refresh(run.runId);
  }

  async function continueWindow() {
    if (locked || uncertain || !availableWindow) return;
    const view = await readView(run.runId);
    const mode = availableWindowFromStore(view);
    const state = readFreeRoomState(view, mode ?? "collaboration");
    if (!state.mayStep || !mode) {
      setNote(state.label + ": " + state.detail);
        await refresh(run.runId);
      return;
    }
    setBusy("free-room-continue"); setNote("");
    try { await settle(mode); }
    catch (e) { setNote("Vervolg gestopt: " + String(e) + ". Geen retry."); }
    finally { setThinking(""); setBusy(null); await refresh(run.runId); }
  }

  async function pauseRoom() {
    if (!canPause) return;
    setBusy("free-room-pause"); setThinking("");
    try {
      const result = await callControl("team-intervene", { run_id: run.runId,
        reason: "Operator pauzeert de Free Room om voortgang en bewijs te beoordelen" });
      setNote(result.ok
        ? "ACF-pauze aangevraagd. De bestaande run en geschiedenis blijven bewaard."
        : "Pauze niet bevestigd: " + refusalText(result));
    } catch (e) { setNote("Pauzestatus onbekend: " + String(e)); setUncertain(true); }
    finally { setBusy(null); await refresh(run.runId); }
  }

  async function resumeRoom() {
    if (!canResume || uncertain) return;
    setBusy("free-room-resume");
    try {
      const latest = await readView(run.runId);
      if (!readFreeRoomState(latest, "collaboration").mayResume) {
        setNote("Hervatten geweigerd: ACF bevestigt geen hervatbare pauze zonder openstaande antwoorden.");
        return;
      }
      const result = await callControl("team-resume", { run_id: run.runId, abandon_owed_replies: false });
      setNote(result.ok
        ? "ACF-pauze opgeheven. Er worden niet vanzelf extra agentbeurten gestart."
        : "Niet hervat: " + refusalText(result));
    } catch (e) { setNote("Hervatstatus onbekend: " + String(e)); setUncertain(true); }
    finally { setBusy(null); await refresh(run.runId); }
  }

  async function stopRoom() {
    if (disabled || processing || uncertain || run.teamView?.in_flight || !["ACTIVE", "PAUSED"].includes(run.runState) || !confirmStop) return;
    setBusy("free-room-stop");
    try {
      const current = await readView(run.runId);
      if (!current || current.in_flight || !["ACTIVE", "PAUSED"].includes(current.run_status)) {
        setNote("Stop geweigerd: ACF meldt geen actuele, veilig afsluitbare run.");
        return;
      }
      const result = await callControl("team-stop", { run_id: run.runId,
        reason: "Operator Dennis beëindigt het vrije teamgesprek" });
      if (result.ok) {
        setNote("ACF-run definitief geannuleerd; geschiedenis blijft in het bestaande ACF-journal.");
      } else {
        setNote("Stop niet bevestigd: " + refusalText(result));
        if (isUncertainTurnOutcome(result.code)) setUncertain(true);
      }
    } catch(e) {
      setNote("Stopstatus onbekend: " + String(e) + ". Controleer ACF voordat je opnieuw handelt.");
      setUncertain(true);
    } finally {
      setBusy(null); setConfirmStop(false); await refresh(run.runId);
    }
  }

  async function inspectEvidence() {
    const latest = await readView(run.runId);
    if (!latest) { setNote("ACF-team-view niet bereikbaar. Geen agentbeurt opnieuw verzonden."); return; }
    const phase = readFreeRoomState(latest, latest.collaboration ? "collaboration" : "replies");
    setNote("ACF-readback: " + phase.label + ". " + phase.detail +
      (uncertain ? " Een eerdere beurt heeft een onbekende uitkomst; alleen een bevestigde journalreconciliatie kan dit vrijgeven." : ""));
    await refresh(run.runId);
  }

  async function send() {
    const message = text.trim();
    if (locked || uncertain || selected.length < 1 || !message || message.length > limit || owed.length) return;
    setBusy("free-room-send"); setNote(""); setThinking("");
    try {
      const to: string | string[] = recipients.includes("TEAM") || selected.length === members.length ? "TEAM" : selected;
      const result = await callControl("team-say", { run_id: run.runId, to, text: message, kind: "QUESTION" });
      if (!result.ok) { setNote("Niet verstuurd: " + refusalText(result)); return; }
      setText("");
      setNote("Bericht geplaatst in ACF. Antwoorden worden één voor één opgehaald.");
      await refresh(run.runId);
      await settle("replies");
    } catch(e) { setNote("Gestopt: " + String(e) + ". Geen automatische herhaling van het bericht."); }
    finally { setThinking(""); setBusy(null); await refresh(run.runId); }
  }

  async function collaborate() {
    if (locked || uncertain || owed.length || members.length < 2 || collaboration && collaboration.status !== "ENDED" && collaboration.status !== "BLOCKED") return;
    setBusy("free-room-collaborate"); setNote(""); setThinking("");
    try {
      const result = await callControl("team-collaborate", {
        run_id: run.runId, rounds, ...(topic.trim() ? { topic: topic.trim() } : {}),
      });
      if (!result.ok) { setNote("Niet gestart: " + refusalText(result)); return; }
      setNote("Samenwerken gestart; ACF bepaalt de beurtvolgorde.");
      await refresh(run.runId);
      await settle("collaboration");
    } catch(e) { setNote("Samenwerken gestopt: " + String(e) + ". Geen automatische retry."); }
    finally { setThinking(""); setBusy(null); await refresh(run.runId); }
  }

  return <div className="min-w-0 space-y-3" data-testid="free-room">
    <div className="max-h-[430px] min-h-[140px] space-y-2 overflow-y-auto rounded-lg border border-border/70 bg-background/30 p-3" data-testid="free-room-history" aria-label="Echte ACF gespreksgeschiedenis">
      {ordered.length === 0 && <p className="text-xs text-muted">Nog geen berichten. Dennis bepaalt wanneer een bericht wordt verzonden.</p>}
      {ordered.map(m => {
        const operator = m.from === "OPERATOR" || m.from === "DENNIS";
        const member = byHandle.get(m.from);
        const author = operator ? "Dennis" : member ? agentLabel(member.agent) + " · " + m.from : m.from;
        const replyTo = m.inReplyTo ? ordered.find(x => x.messageId === m.inReplyTo) : null;
        return <article key={m.messageId} className={"max-w-[94%] rounded-lg border px-3 py-2 text-xs " + (operator ? "ml-auto border-cyan-400/50 bg-cyan-950/30" : "mr-auto border-border bg-panel-2")} data-testid={operator ? "free-room-operator-message" : "free-room-agent-message"}>
          <div className="flex flex-wrap justify-between gap-2"><strong>{author}</strong><span className="text-muted">#{m.sequence} · {m.kind} · naar {m.to}</span></div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{m.body}</p>
          <div className="mt-1 break-all text-[10px] text-muted">Bericht {m.messageId} · sessie {m.origin?.sessionRef ?? member?.session ?? "—"} · gesprek {m.origin?.conversationRef ?? "—"}{m.inReplyTo ? " · antwoord op " + m.inReplyTo + (replyTo ? " (" + replyTo.from + ")" : "") : ""}</div>
        </article>;
      })}
      {thinking && <p className="text-xs text-cyan-200" role="status" data-testid="free-room-thinking">{thinking}</p>}
    </div>

    <section className="rounded-lg border border-cyan-400/40 bg-background/40 p-3" aria-label="Vrij gesprek">
      <h3 className="text-sm font-semibold">Praat met je team</h3>
      <p className="mt-1 text-xs text-muted">Aan wie? Eén agent, een selectie of Iedereen. Versturen vraagt alleen gerichte antwoorden; agenten gaan niet zelfstandig samenwerken.</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Ontvangers">
        <button type="button" data-testid="free-room-everyone" aria-pressed={recipients.includes("TEAM")} onClick={()=>choose("TEAM")} className={"mc-button mc-button-sm " + (recipients.includes("TEAM") ? "mc-button-primary" : "mc-button-secondary")}>Iedereen</button>
        {members.map(m => <button type="button" key={m.handle} data-testid={"free-room-recipient-"+m.handle} aria-pressed={selected.includes(m.handle) && !recipients.includes("TEAM")} onClick={()=>choose(m.handle)} className={"mc-button mc-button-sm " + (selected.includes(m.handle) && !recipients.includes("TEAM") ? "mc-button-primary" : "mc-button-secondary")}>{agentLabel(m.agent)}</button>)}
      </div>
      <label className="mt-3 block text-xs">Jouw bericht
        <textarea data-testid="free-room-input" rows={3} maxLength={limit} value={text} onChange={e => setText(e.target.value)} placeholder="Goedemorgen, gasten." className="mt-1 w-full min-w-0 rounded-md border border-border bg-background p-3 text-sm" />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{selected.length} ontvanger(s) · {owed.length} antwoord(en) open</span>
        <button type="button" data-testid="free-room-send" className="mc-button mc-button-success" disabled={locked || uncertain || Boolean(owed.length) || selected.length<1 || !text.trim()} onClick={()=>void send()}>{busy==="free-room-send" ? "Antwoorden ophalen…" : "Verstuur"}</button>
      </div>
    </section>

    <section className="rounded-lg border border-border bg-background/30 p-3" aria-label="Samenwerken">
      <h3 className="text-sm font-semibold">Samenwerken</h3>
      <p className="mt-1 text-xs text-muted">Rondes zijn één begrensd uitvoeringsvenster, geen levenslange limiet voor de kamer. Beurten blijven afzonderlijk gelogd. Alleen ACF kan een echte pauze, blokkade of consensus bevestigen.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">Rondes <select data-testid="free-room-rounds" className="mt-1 block rounded border border-border bg-background p-2" value={rounds} onChange={e=>setRounds(Number(e.target.value))}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <label className="min-w-[140px] flex-1 text-xs">Onderwerp (optioneel)<input data-testid="free-room-topic" maxLength={4000} className="mt-1 w-full rounded border border-border bg-background p-2 text-xs" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Waarover spreken jullie?"/></label>
        <button type="button" data-testid="free-room-collaborate" className="mc-button mc-button-primary" disabled={locked || uncertain || owed.length>0 || members.length<2 || Boolean(collaboration && collaboration.status!=="ENDED" && collaboration.status!=="BLOCKED")} onClick={()=>void collaborate()}>{busy==="free-room-collaborate" ? "Samenwerken loopt…" : "Samenwerken"}</button>
      </div>
      {collaboration && <p className="mt-2 text-xs" data-testid="free-room-collab-status">ACF venster {collaboration.window_id} · {collaboration.status} · {collaboration.posted}/{collaboration.total} beurten{collaboration.reason ? " · " + collaboration.reason : ""}</p>}
      <div className="mt-3 rounded-md border border-border/70 bg-panel-2/50 p-2 text-xs" data-testid="free-room-durable-state">
        <strong>{status.label}</strong> · {status.detail}
        {run.teamView?.next_safe_action && <span className="block break-words">ACF next_safe_action: {run.teamView.next_safe_action}</span>}
        {run.teamView?.in_flight ? <span className="block text-warn">Journal heeft een open beurt: niet opnieuw versturen.</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" aria-label="Veilige Free Room bediening">
        <button type="button" data-testid="free-room-pause" className="mc-button mc-button-secondary" disabled={!canPause} onClick={()=>void pauseRoom()}>Pauzeer</button>
        <button type="button" data-testid="free-room-resume" className="mc-button mc-button-secondary" disabled={!canResume || uncertain} onClick={()=>void resumeRoom()}>Hervat</button>
        <button type="button" data-testid="free-room-inspect" className="mc-button mc-button-secondary" disabled={processing} onClick={()=>void inspectEvidence()}>Controleer ACF-status</button>
        <button type="button" data-testid="free-room-stop" className="mc-button mc-button-secondary"
          disabled={locked || uncertain} onClick={()=>setConfirmStop(true)}>Stop</button>
        {availableWindow && <button type="button" data-testid="free-room-continue" className="mc-button mc-button-primary"
          disabled={locked || uncertain} onClick={()=>void continueWindow()}>
          {availableWindow === "replies" ? "Open antwoorden ophalen" : "Verder met dit venster"} ({FREE_ROOM_STEPS_PER_CLICK} max.)
        </button>}
      </div>
      {confirmStop && <div role="group" aria-label="Stop Free Room bevestigen" className="mt-2 rounded-md border border-warn p-3 text-xs" data-testid="free-room-stop-confirm">
        <p>Wil je deze ACF-run definitief beëindigen? Het gesprek en bewijs blijven bewaard. Een geannuleerde run wordt niet opnieuw geopend.</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="mc-button mc-button-secondary" onClick={()=>setConfirmStop(false)}>Annuleer</button>
          <button type="button" data-testid="free-room-stop-confirm-button" className="mc-button mc-button-primary"
            disabled={locked || uncertain} onClick={()=>void stopRoom()}>Bevestig stoppen</button>
        </div>
      </div>}
      <p className="mt-1 text-[11px] text-muted">Pauzeren gebruikt ACF team-intervene; hervatten gebruikt team-resume.
        Stoppen gebruikt na jouw bevestiging de bestaande ACF cancel-run. Bij een onbekende beurtuitkomst wordt niets opnieuw verzonden.
        Automatische consensus wordt pas getoond als ACF dit met bewijs bevestigt.</p>
      {uncertain && <p role="alert" className="mt-2 text-xs text-warn" data-testid="free-room-uncertain">
        Onbekende beurtuitkomst: nieuwe dispatch geblokkeerd. ACF journal/reconciliatie door de operator controleren; een readback alleen heft dit niet op.
      </p>}
    </section>
    <section className="rounded-lg border border-border bg-background/30 p-3" aria-label="Bewijsrapport groepsgesprek" data-testid="free-room-evidence-report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Groepsrapport · bewijs uit het ACF-journal</h3>
          <p className="mt-1 text-xs text-muted">Geen automatisch oordeel of verzonnen consensus. Deelnemers moeten aantoonbaar de hele discussie kunnen lezen vóór echte UAT.</p>
        </div>
        <button type="button" className="mc-button mc-button-secondary mc-button-sm"
          data-testid="free-room-evidence-report-toggle" aria-expanded={showEvidenceReport}
          onClick={() => setShowEvidenceReport(v => !v)}>
          {showEvidenceReport ? "Sluit bewijsrapport" : "Toon bewijsrapport"}
        </button>
      </div>
      {showEvidenceReport && <div className="mt-3 space-y-4 text-xs" data-testid="free-room-evidence-report-body">
        <p className="rounded border border-warn/50 p-2" role="status">
          {report.snapshotReplayVerified ? "ACF-journalreplay bevestigd." : "ACF-journalreplay niet bevestigd."}
          {" "}Volledige gedeelde context per agent: NIET AANGETOOND.
          {" "}Groepsconsensus: {report.consensusStatus}.
          {" "}Dit is een voorlopig, uitsluitend brongebonden rapport, geen UAT-certificaat.
        </p>
        <div>
          <strong>Wat is besproken?</strong>
          <p className="mt-1">Doel in ACF: {report.goal || "Geen doel vastgelegd"} · {report.sourceMessages.length} geregistreerde berichten</p>
          <ol className="mt-2 space-y-2">
            {report.sourceMessages.map(m => <li key={m.messageId} className="rounded border border-border/70 p-2 whitespace-pre-wrap break-words">
              <strong>#{m.sequence} {m.messageId} · {m.from} → {m.to}</strong>
              {m.inReplyTo ? " · antwoord op " + m.inReplyTo : ""}
              <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
            </li>)}
            {!report.sourceMessages.length && <li>Geen geregistreerde groepsbijdragen.</li>}
          </ol>
        </div>
        <div>
          <strong>Wie sprak met wie? (geen inhoudelijke acceptatie)</strong>
          <p className="mt-1">{report.participantTurns.map(p => p.role + ": " + p.turns + " bronherleidbare beurt(en)").join(" · ") || "Geen deelnemers"}</p>
          <p>{report.peerResponses.length} bronherleidbare directe deelnemersberichten; aantallen zijn geen bewijs van werkelijk overleg.</p>
        </div>
        {([
          ["AGREEMENT", "Expliciet uitgesproken overeenstemming — nog geen consensus"],
          ["OBJECTION", "Uitgesproken bezwaren en meningsverschillen"],
          ["REVISION", "Herziene standpunten en correcties"],
          ["OPEN", "Expliciet openstaande vragen"],
          ["CONCLUSION", "Door deelnemers genoemde conclusies — geen vastgesteld groepsbesluit"],
          ["POSITION", "Overige expliciete standpunten"],
        ] as [EvidenceKind,string][]).map(([kind,heading]) => {
          const relevant = report.evidence.filter(e => e.kind === kind);
          return <div key={kind} data-testid={"free-room-evidence-" + kind.toLowerCase()}>
            <strong>{heading}</strong>
            {relevant.length ? <ul className="mt-1 space-y-2">
              {relevant.map((e,i) => <li key={e.messageId + "-" + kind + "-" + i} className="rounded border border-border/70 p-2">
                <p className="whitespace-pre-wrap break-words">{e.statement}</p>
                <p className="mt-1 text-muted">Bron {e.messageId} · #{e.sequence} · {e.from} · {e.agentId} · sessie {e.sessionRef} · gesprek {e.conversationRef}</p>
              </li>)}
            </ul> : <p className="mt-1 text-muted">Niet expliciet onderbouwd in de zichtbare bronberichten. Geen uitspraak of akkoord ingevuld.</p>}
          </div>;
        })}
        <div>
          <strong>Bewijsgrenzen</strong>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {report.caveats.map(c => <li key={c}>{c}</li>)}
          </ul>
          <p className="mt-2">Rapport uit ACF-run {report.runId}. Een individuele claim of akkoord is nooit bewijs van groepsconsensus.</p>
        </div>
      </div>}
    </section>
    {disabled && <p role="status" className="text-xs text-warn">Bediening geblokkeerd: conceptselectie of verouderde ACF-status. Bevestig eerst je selectie en controleer actuele run-status.</p>}
    {note && <p className="rounded border border-border bg-panel-2 p-2 text-xs" role="status" data-testid="free-room-status">{note}</p>}
  </div>;
}
