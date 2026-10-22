"use client";

/**
 * D8 operator controls: participant identities are persistent session bindings,
 * functions are optional labels, and tasks are independent conversation-only work.
 * This calls the existing MC /api/acf/team-room/control action and never executes
 * a model turn automatically. ACF owns the task board, sequencing and review gate.
 */
import { useMemo, useState } from "react";
import type { CockpitSessionSummary } from "@/lib/cockpit/agent-registry";
import type { AcfTeamRoomRun } from "@/lib/acf/types";
import type { CallControl } from "./OperatorDeck";
import { agentLabel, refusalText } from "./OperatorDeck";

type Row = { handle: string; agent_id: string; session_ref: string; roles: string };
type DraftAction = { verb: "team-open-participants" | "team-task" | "team-join"; args: Record<string, unknown>; label: string };
const HANDLE = /^[a-z][a-z0-9-]{0,30}$/;
const agents = ["openclaw", "hermes", "claude-code"];
const presets: Row[] = [
  { handle: "openclaw", agent_id: "openclaw", session_ref: "acf-collab01-fresh-builder-openclaw-001", roles: "" },
  { handle: "hermes", agent_id: "hermes", session_ref: "acf-team-hermes-001", roles: "" },
  { handle: "claude", agent_id: "claude-code", session_ref: "acf-dlg-proof-claude", roles: "" },
];
const blank: Row = { handle: "", agent_id: "openclaw", session_ref: "", roles: "" };
const classes = "w-full min-w-0 rounded border border-border bg-background p-1.5 text-xs";

function tags(value: string): string[] {
  return value.split(",").map(x => x.trim()).filter(Boolean);
}
function choices(sessions: CockpitSessionSummary[], agent: string) {
  return sessions.filter(x => x.agentId === agent);
}
function memberStatus(sessions: CockpitSessionSummary[], row: Row) {
  const exact = sessions.find(s => s.agentId === row.agent_id && s.sessionId === row.session_ref);
  return exact ? (exact.active && exact.status === "idle" ? "READY_CANDIDATE" : `BLOCKED: ${exact.status}`) : "UNKNOWN_SESSION";
}
export function D8TeamControls({ sessions, run, busy, callControl, onSelectRun, refresh }: {
  sessions: CockpitSessionSummary[];
  run: AcfTeamRoomRun | null;
  busy: string | null;
  callControl: CallControl;
  onSelectRun: (id: string) => void;
  refresh: (id: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>(presets);
  const [goal, setGoal] = useState("");
  const [criterion, setCriterion] = useState("");
  const [taskId, setTaskId] = useState("T1");
  const [taskTitle, setTaskTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [brief, setBrief] = useState("");
  const [join, setJoin] = useState<Row>(blank);
  const [pending, setPending] = useState<DraftAction | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const view = run?.teamView;
  const isV2 = view?.schema === 2;
  const members = useMemo(() => isV2 ? (view.participants ?? []).filter(p => typeof p.role === "string") : [], [isV2, view]);
  const tasks = isV2 ? view.tasks ?? [] : [];
  const due = isV2 ? view.due ?? [] : [];
  const validRows = rows.length >= 1 && rows.length <= 8 && rows.every(r => HANDLE.test(r.handle)
    && agents.includes(r.agent_id) && Boolean(r.session_ref)
    && memberStatus(sessions,r) !== "UNKNOWN_SESSION")
    && new Set(rows.map(r => r.handle)).size === rows.length
    && new Set(rows.map(r => r.agent_id + ":" + r.session_ref)).size === rows.length;
  const readyCount = rows.filter(r => memberStatus(sessions,r) === "READY_CANDIDATE").length;
  const up = (i: number, patch: Partial<Row>) => {
    setRows(old => old.map((r,j) => i === j ? { ...r,...patch } : r)); setPending(null);
  };
  const proposeOpen = () => {
    setResult("");
    setPending({ verb:"team-open-participants", label:"Nieuw v2-team openen", args: {
      goal:goal.trim(),success_criterion:criterion.trim(),
      participants:rows.map(r => ({ handle:r.handle, agent_id:r.agent_id,session_ref:r.session_ref,roles:tags(r.roles) })),
    } });
  };
  const proposeTask = () => {
    if(!run) return;
    setPending({verb:"team-task",label:`Nieuwe taak ${taskId}`,args:{
      run_id:run.runId,task_id:taskId,assignee,brief:brief.trim(),
      ...(reviewer ? {reviewer} : {}),...(taskTitle.trim()?{title:taskTitle.trim()}:{}),
    }});
  };
  const proposeJoin = () => {
    if(!run) return;
    setPending({verb:"team-join",label:`Deelnemer ${join.handle} toevoegen`,args:{
      run_id:run.runId,handle:join.handle,agent_id:join.agent_id,
      session_ref:join.session_ref,roles:tags(join.roles),
    }});
  };
  const execute = async () => {
    if(!pending || running || busy) return;
    const action = pending; setRunning(true);setResult("");setPending(null);
    try {
      const reply = await callControl(action.verb,action.args);
      if(!reply.ok){setResult(`ACF refused: ${refusalText(reply)}`);return;}
      const runId = action.verb === "team-open-participants" ? String(reply.result?.run_id ?? "") : run?.runId ?? "";
      setResult(`ACF accepted ${action.verb}; ${runId}. This does not prove a participant model response.`);
      if(runId){if(action.verb === "team-open-participants")onSelectRun(runId);await refresh(runId);}
    } catch(e) {setResult(`Network/route error: ${e instanceof Error?e.message:String(e)}`);}
    finally {setRunning(false);}
  };
  const disabled = Boolean(busy) || running;
  return (
    <section className="mx-4 my-3 rounded-xl border border-cyan-400/35 bg-panel-2 p-4 text-sm" aria-label="ACF D8 independent participants">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="font-semibold">Deelnemers & parallelle taken · ACF D8</h2>
          <p className="mt-1 text-xs text-muted">Iedere deelnemer heeft een eigen sessie. Functies zijn optioneel; geen vaste bouwer- of reviewerzetels.</p></div>
        <span className="text-xs text-muted">{isV2 ? "V2 · dynamic" : "Nieuw v2-team"} · geen automatische agentprompts</span>
      </header>
      {!isV2 && <div className="mt-3 space-y-3">
        <label className="block text-xs">Teamdoel
          <textarea className={classes+" mt-1"} value={goal} rows={2} maxLength={4000} onChange={e=>{setGoal(e.target.value);setPending(null);}} placeholder="Wat willen deze onafhankelijke deelnemers samenwerken?" />
        </label>
        <label className="block text-xs">Succescriterium (optioneel)
          <input className={classes+" mt-1"} value={criterion} maxLength={400} onChange={e=>setCriterion(e.target.value)} />
        </label>
        <div className="flex items-center justify-between">
          <strong className="text-xs">Deelnemers {rows.length}/8 · {readyCount} idle kandidaten</strong>
          <button type="button" className="mc-button mc-button-secondary mc-button-sm" disabled={rows.length>=8} onClick={()=>{setRows(old=>[...old,{...blank}]);setPending(null);}}>+ Deelnemer</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r,i)=><div key={i} className="rounded border border-border p-2 space-y-2">
            <div className="flex items-center justify-between gap-2"><strong className="text-xs">Deelnemer {i+1}</strong>
              <button type="button" className="text-xs text-muted" disabled={rows.length===1} onClick={()=>{setRows(old=>old.filter((_,j)=>i!==j));setPending(null);}}>Verwijder</button></div>
            <label className="block text-xs">Handle <input className={classes} value={r.handle} onChange={e=>up(i,{handle:e.target.value})} placeholder="bijv. researcher" /></label>
            <label className="block text-xs">Agent
              <select className={classes} value={r.agent_id} onChange={e=>up(i,{agent_id:e.target.value,session_ref:""})}>{agents.map(a=><option key={a} value={a}>{agentLabel(a)}</option>)}</select>
            </label>
            <label className="block text-xs">Bestaande eigen sessie
              <select className={classes} value={r.session_ref} onChange={e=>up(i,{session_ref:e.target.value})}>
                <option value="">Selecteer geregistreerde sessie</option>
                {choices(sessions,r.agent_id).map(s=><option key={s.sessionId} value={s.sessionId}>{s.sessionId} [{s.status}]</option>)}
              </select>
            </label>
            <label className="block text-xs">Optionele functies (komma&apos;s)
              <input className={classes} value={r.roles} onChange={e=>up(i,{roles:e.target.value})} placeholder="analyse, schrijven" />
            </label>
            <p className={"text-[11px] "+(memberStatus(sessions,r)==="READY_CANDIDATE"?"text-ok":"text-warn")}>{memberStatus(sessions,r)}</p>
          </div>)}
        </div>
        {readyCount<rows.length && <p className="text-xs text-warn">Niet elke sessie is idle. D8 bindt zonder modelprobe, maar een turn is NIET ready totdat de betrokken sessie een echte respons levert.</p>}
        <button type="button" className="mc-button mc-button-success disabled:opacity-50" disabled={disabled || !goal.trim() || !validRows} onClick={proposeOpen}>Bekijk openen van {rows.length} deelnemers</button>
      </div>}
      {isV2 && run && <div className="mt-3 space-y-4">
        <div className="rounded border border-border p-2 text-xs">
          <strong>Team {run.runId} · {members.length} onafhankelijke deelnemers</strong>
          <ul className="mt-2 space-y-1">{members.map(p=><li key={p.role}>{p.role} — {agentLabel(p.agent_id)} / <span className="mono">{p.session_ref}</span>
            {Array.isArray(p.tags) && p.tags.length>0 ? ` · functies: ${p.tags.join(", ")}` : " · geen vaste functie"}</li>)}</ul>
          <strong className="mt-2 block">Onafhankelijke taken ({tasks.length}) · due: {due.length}</strong>
          {tasks.map(t=><p key={t.task_id} className="mt-1">#{t.task_id} {t.title||""} · {t.assignee} → {t.reviewer??"operator"} · {t.status}</p>)}
          {due.length>0 && <p className="mt-2 text-warn">Volgende toegestane beurten: {due.map(d=>`${d.task_id}/${d.role}`).join(", ")}</p>}
        </div>
        <fieldset className="rounded border border-border p-3 space-y-2">
          <legend className="font-semibold text-xs">Nieuwe onafhankelijke taak (alleen gesprek)</legend>
          <label className="block text-xs">Taak-ID <input className={classes} value={taskId} onChange={e=>setTaskId(e.target.value)} placeholder="T1" /></label>
          <label className="block text-xs">Titel (optioneel) <input className={classes} value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} maxLength={200}/></label>
          <label className="block text-xs">Uitvoerder
            <select className={classes} value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Kies deelnemer</option>{members.map(p=><option key={p.role} value={p.role}>{p.role}</option>)}</select>
          </label>
          <label className="block text-xs">Reviewer (optioneel; andere agent)
            <select className={classes} value={reviewer} onChange={e=>setReviewer(e.target.value)}><option value="">Geen · DONE_UNREVIEWED</option>{members.filter(p=>p.role!==assignee && p.agent_id !== members.find(x=>x.role===assignee)?.agent_id).map(p=><option key={p.role} value={p.role}>{p.role}</option>)}</select>
          </label>
          <label className="block text-xs">Opdrachttekst <textarea className={classes} rows={2} value={brief} onChange={e=>setBrief(e.target.value)} maxLength={4000}/></label>
          <button type="button" className="mc-button mc-button-secondary disabled:opacity-50" disabled={disabled || !/^T[1-9][0-9]{0,3}$/.test(taskId) || !assignee || !brief.trim()} onClick={proposeTask}>Bekijk nieuwe taak</button>
        </fieldset>
        <fieldset className="rounded border border-border p-3 space-y-2">
          <legend className="font-semibold text-xs">Nieuwe deelnemer aansluiten (geen rebind)</legend>
          <label className="block text-xs">Nieuw handle <input className={classes} value={join.handle} onChange={e=>setJoin(x=>({...x,handle:e.target.value}))} /></label>
          <label className="block text-xs">Agent
            <select className={classes} value={join.agent_id} onChange={e=>setJoin(x=>({...x,agent_id:e.target.value,session_ref:""}))}>{agents.map(a=><option key={a} value={a}>{agentLabel(a)}</option>)}</select>
          </label>
          <label className="block text-xs">Onafhankelijke sessie
            <select className={classes} value={join.session_ref} onChange={e=>setJoin(x=>({...x,session_ref:e.target.value}))}>
              <option value="">Selecteer</option>{choices(sessions,join.agent_id).map(s=><option key={s.sessionId} value={s.sessionId}>{s.sessionId} [{s.status}]</option>)}
            </select>
          </label>
          <label className="block text-xs">Functies (optioneel)<input className={classes} value={join.roles} onChange={e=>setJoin(x=>({...x,roles:e.target.value}))} /></label>
          <button type="button" className="mc-button mc-button-secondary disabled:opacity-50" disabled={disabled || !HANDLE.test(join.handle)||!join.session_ref} onClick={proposeJoin}>Bekijk aansluiten</button>
        </fieldset>
      </div>}
      {pending && <div className="mt-3 rounded border border-warn/50 p-3 space-y-2" aria-label="Confirm ACF D8 mutation">
        <strong className="text-sm">Bevestig: {pending.label}</strong>
        <p className="text-xs text-warn">Dit schrijft ACF-runstate, maar start geen modelprompt. Acties zijn niet automatisch terug te draaien; draai geen historisch falen opnieuw.</p>
        <pre className="text-[10px] mono whitespace-pre-wrap break-all">{JSON.stringify(pending.args,null,2)}</pre>
        <div className="flex gap-2">
          <button type="button" className="mc-button mc-button-success" disabled={disabled} onClick={()=>void execute()}>Bevestig ACF-control</button>
          <button type="button" className="mc-button mc-button-secondary" onClick={()=>setPending(null)}>Annuleer</button>
        </div>
      </div>}
      {result && <p className="mt-3 break-words text-xs" role="status">{result}</p>}
      {!isV2 && <p className="mt-2 text-[11px] text-muted">Historische v1-runs en hun builder/reviewer-loop blijven apart ondersteund. D8 is alleen beschikbaar zodra de ACF-runtime het v2-contract heeft.</p>}
    </section>
  );
}
