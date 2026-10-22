"use client";

import { useMemo, useState } from "react";
import type { AcfTeamRoomRun, AcfTeamViewV1 } from "@/lib/acf/types";
import { agentLabel, refusalText, type CallControl, type ControlAnswer, type WaitForStep } from "./OperatorDeck";

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
  const selected = recipients.includes("TEAM") ? members.map(p => p.handle) : recipients.filter(r => members.some(p => p.handle === r));
  const owed = run.teamView?.intervention?.open?.owed ?? [];
  const collaboration = run.teamView?.collaboration;
  const processing = busy !== null;
  const locked = disabled || processing || !(["ACTIVE", "PAUSED"].includes(run.runState)) || Boolean(run.teamView?.in_flight);
  const byHandle = new Map(members.map(m => [m.handle, m]));
  const ordered = [...run.messages].sort((a, b) => a.sequence - b.sequence);

  function choose(handle: string) {
    if (handle === "TEAM") { setRecipients(["TEAM"]); return; }
    const next = recipients.includes("TEAM") ? [handle]
      : recipients.includes(handle) ? recipients.filter(x => x !== handle) : [...recipients, handle];
    setRecipients(next.length === members.length ? ["TEAM"] : next);
  }

  async function settle(mode: "replies" | "collaboration") {
    // Per ACF: each owed reply and each collaboration turn has exactly one journalled step.
    // No automatic retries of a failed or unknown turn.
    const ceiling = mode === "replies" ? 40 : 32;
    for (let step = 0; step < ceiling; step++) {
      const view = await readView(run.runId);
      if (!view) throw Error("ACF team-view unavailable; no extra turn was started");
      const pending = view.intervention?.open?.owed ?? [];
      if (mode === "replies") {
        if (!pending.length) { setThinking(""); setNote("Alle gevraagde antwoorden zijn binnen."); await refresh(run.runId); return; }
        const target = pending[0].to;
        setThinking((byHandle.get(target)?.agent ? agentLabel(byHandle.get(target)?.agent) : target) + " denkt na…");
      } else {
        const status = view.collaboration?.status ?? null;
        if (status === "ENDED") { setThinking(""); setNote("Samenwerken klaar."); await refresh(run.runId); return; }
        if (status === "BLOCKED") { setThinking(""); setNote("Samenwerken geblokkeerd: " + (view.collaboration?.reason ?? view.next_safe_action ?? "ACF meldt een geblokkeerde beurt") + ". Geen retry."); await refresh(run.runId); return; }
        if (!view.collaboration || status === null) throw Error("ACF heeft geen samenwerkingsvenster bevestigd");
        const next = view.collaboration.order[(view.collaboration.posted ?? 0) % view.collaboration.order.length];
        setThinking((byHandle.get(next)?.agent ? agentLabel(byHandle.get(next)?.agent) : (next ?? "Agent")) + " denkt na…");
      }
      const started = await callControl("team-step", { run_id: run.runId });
      if (!started.ok) {
        if (started.code === "INTERVENTION_NOTHING_OWED") { setThinking(""); setNote("Geen antwoorden meer open."); await refresh(run.runId); return; }
        throw Error("Beurt niet gestart: " + refusalText(started));
      }
      const finished: ControlAnswer | null = await waitForStep(run.runId);
      if (!finished) throw Error("Beurtstatus onbekend. Niet opnieuw gestart; controleer eerst ACF Evidence.");
      if (!finished.ok) {
        if (finished.code === "INTERVENTION_NOTHING_OWED") { setThinking(""); await refresh(run.runId); return; }
        throw Error("Beurt gestopt: " + refusalText(finished) + ". Geen automatische retry.");
      }
      await refresh(run.runId);
    }
    throw Error("Beveiligingslimiet van automatische beurten bereikt; controleer ACF voordat je doorgaat");
  }

  async function send() {
    const message = text.trim();
    if (locked || selected.length < 1 || !message || message.length > limit || owed.length) return;
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
    if (locked || owed.length || members.length < 2 || collaboration && collaboration.status !== "ENDED" && collaboration.status !== "BLOCKED") return;
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
        <button type="button" data-testid="free-room-send" className="mc-button mc-button-success" disabled={locked || Boolean(owed.length) || selected.length<1 || !text.trim()} onClick={()=>void send()}>{busy==="free-room-send" ? "Antwoorden ophalen…" : "Verstuur"}</button>
      </div>
    </section>

    <section className="rounded-lg border border-border bg-background/30 p-3" aria-label="Samenwerken">
      <h3 className="text-sm font-semibold">Samenwerken</h3>
      <p className="mt-1 text-xs text-muted">Uitsluitend na je aparte klik praten de agenten met elkaar. ACF begrenst het aantal beurten en stopt bij fouten.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">Rondes <select data-testid="free-room-rounds" className="mt-1 block rounded border border-border bg-background p-2" value={rounds} onChange={e=>setRounds(Number(e.target.value))}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <label className="min-w-[140px] flex-1 text-xs">Onderwerp (optioneel)<input data-testid="free-room-topic" maxLength={4000} className="mt-1 w-full rounded border border-border bg-background p-2 text-xs" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Waarover spreken jullie?"/></label>
        <button type="button" data-testid="free-room-collaborate" className="mc-button mc-button-primary" disabled={locked || owed.length>0 || members.length<2 || Boolean(collaboration && collaboration.status!=="ENDED" && collaboration.status!=="BLOCKED")} onClick={()=>void collaborate()}>{busy==="free-room-collaborate" ? "Samenwerken loopt…" : "Samenwerken"}</button>
      </div>
      {collaboration && <p className="mt-2 text-xs" data-testid="free-room-collab-status">ACF venster {collaboration.window_id} · {collaboration.status} · {collaboration.posted}/{collaboration.total} beurten{collaboration.reason ? " · " + collaboration.reason : ""}</p>}
    </section>
    {disabled && <p role="status" className="text-xs text-warn">Bediening geblokkeerd: conceptselectie of verouderde ACF-status. Bevestig eerst je selectie en controleer actuele run-status.</p>}
    {note && <p className="rounded border border-border bg-panel-2 p-2 text-xs" role="status" data-testid="free-room-status">{note}</p>}
  </div>;
}
