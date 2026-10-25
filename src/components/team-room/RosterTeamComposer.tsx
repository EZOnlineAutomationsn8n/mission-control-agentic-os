"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AcfTeamRoomRun } from "@/lib/acf/types";
import { agentLabel, refusalText, type CallControl } from "./OperatorDeck";
import { CLAUDE_AGENT, LEGACY_SESSION, classifyClaudeError } from "@/lib/acf/werkplaats-session-recovery";

export interface RosterSession {
  session_ref: string;
  status: string;
  verdict: string;
  reason: string;
  updated_at?: string | null;
  last_error?: string | null;
  live?: { state: string; reason?: string };
}
export interface RosterMember {
  handle: string;
  session_ref: string;
  roles: string[];
  session_state: string;
  status: "JOINED" | "ACTIVE" | "IDLE" | "WORKING" | "FAILED";
  status_reason: string;
}
export interface RosterAgent {
  agent_id: string;
  label: string | null;
  route: "ENABLED" | "DISABLED" | "NO_ACF_ROUTE" | "ENABLED_WITHOUT_INITIATOR_CONTRACT";
  can_join_now: boolean;
  suggested_session: string | null;
  pin_required_sessions: string[];
  why_not: string | null;
  sessions: RosterSession[];
  member: RosterMember[] | null;
}
export interface TeamRoster {
  roster_version: 1;
  source: string;
  environment?: "WERKPLAATS" | "LIVE";
  provenance?: "STAGE_OWN_SESSION_REGISTRY" | "LIVE_OWN_SESSION_REGISTRY";
  agents: RosterAgent[];
  run_id: string | null;
  run_schema: number | null;
  can_join_running_run: boolean | null;
  creates_sessions: false;
  sends_prompts: false;
}
export type TeamDraftChoice = { selected: boolean; session: string; functions: string };
type Preview = { verb: "team-open-participants" | "team-join" | "team-task"; args: Record<string, unknown>; description: string; range: string };
const style = "w-full min-w-0 rounded-md border border-border bg-background p-2 text-xs";
const agentKey = (a: RosterAgent) => a.agent_id;
const validTag = /^[a-z][a-z0-9_-]{0,31}$/;
const canPin = (s: RosterSession) => s.verdict === "ELIGIBLE_PIN_REQUIRED";
const selectable = (s: RosterSession) =>
  s.verdict === "ELIGIBLE" || s.verdict === "ELIGIBLE_FIRST_TURN" || canPin(s);
function functionTags(text: string): string[] {
  return text.split(",").map(s=>s.trim()).filter(Boolean);
}
function newHandle(agentId: string, taken: Set<string>): string {
  let handle = agentId.slice(0,31);
  let n=2;
  while(taken.has(handle)) {
    const suffix="-"+n++;
    handle=agentId.slice(0,31-suffix.length)+suffix;
  }
  return handle;
}

/** Roster comes only from GET /api/acf/team-room/roster (ACF's unmodified answer).
 * No separate agent registry, model dispatch or session creation exists in this panel. */
export function RosterTeamComposer({run,busy,callControl,onSelectRun,refresh,choices,onChoicesChange}: {
  run: AcfTeamRoomRun | null;
  busy: string | null;
  callControl: CallControl;
  onSelectRun: (runId: string)=>void;
  refresh: (runId: string)=>Promise<void>;
  choices: Record<string, TeamDraftChoice>;
  onChoicesChange: (value: Record<string, TeamDraftChoice>) => void;
}) {
  const [expanded,setExpanded]=useState(true);
  const [newTeamMode,setNewTeamMode]=useState(true);
  const [roster,setRoster]=useState<TeamRoster|null>(null);
  const [problem,setProblem]=useState("");
  const [claudeDiagnostic,setClaudeDiagnostic]=useState<{
    code?:string;nativeStatus?:string;registered?:boolean;nativeSessionIdPresent?:boolean;
    sessionRef?:string;active?:boolean;canJoinNow?:boolean;readyForDennisUat?:boolean;
    dennisUatPass?:boolean;
  }|null>(null);

  const [goal,setGoal]=useState("");
  const [criterion,setCriterion]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null);
  const [sending,setSending]=useState(false);
  const [note,setNote]=useState("");
  const [taskId,setTaskId]=useState("T1");
  const [assignee,setAssignee]=useState("");
  const [reviewer,setReviewer]=useState("");
  const [taskBrief,setTaskBrief]=useState("");
  const [taskTitle,setTaskTitle]=useState("");
  const inFlight=useRef(false);
  const runId=run?.teamView?.schema===2 ? run.runId : undefined;

  const loadRoster=useCallback(async()=>{
    if(inFlight.current)return;
    inFlight.current=true;
    try{
      // Candidate availability is independent from whichever historical/current
      // run is being viewed. Membership comes from the selected run snapshot.
      const response=await fetch("/api/acf/team-room/roster",{cache:"no-store",signal:AbortSignal.timeout(25000)});
      const answer=await response.json() as TeamRoster & {error?:string;detail?:string};
      if(!response.ok || answer.roster_version!==1 || !Array.isArray(answer.agents)) {
        throw Error(answer.error ? answer.error+": "+(answer.detail??"") : "ACF roster malformed");
      }
      setRoster(answer);setProblem("");
    }catch(e){
      setProblem(e instanceof Error?e.message:String(e)); // keep last roster visible but mark stale
    }finally{inFlight.current=false;}
  },[]);
  useEffect(()=>{
    // Schedule after mount instead of synchronously invoking a stateful callback in the effect.
    const first=window.setTimeout(()=>{void loadRoster();},0);
    const id=window.setInterval(()=>{if(document.visibilityState==="visible")void loadRoster();},30000);
    return ()=>{window.clearTimeout(first);window.clearInterval(id);};
  },[loadRoster]);
  const claudeSelected = choices[CLAUDE_AGENT]?.selected === true;
  useEffect(()=>{
    // Selection triggers a fresh READ ONLY diagnosis from the existing MC
    // session registry; only the classified result enters the browser.
    if(!claudeSelected) return;
    let cancelled=false;
    const controller=new AbortController();
    fetch("/api/acf/team-room/prepare",{cache:"no-store",signal:controller.signal})
      .then(async response=>response.ok?await response.json():null)
      .then(result=>{if(!cancelled && result?.sessionRef)setClaudeDiagnostic(result);})
      .catch(()=>{if(!cancelled)setClaudeDiagnostic(null);});
    return ()=>{cancelled=true;controller.abort();};
  },[claudeSelected]);
  const rows=roster?.agents??[];
  const selectedRows=rows.filter(a=>choices[agentKey(a)]?.selected);
  const byKey=(key:string,update:Partial<TeamDraftChoice>)=>{
    onChoicesChange({...choices,[key]:{...({selected:false,session:"",functions:""} as TeamDraftChoice),...choices[key],...update}});setPreview(null);
  };
  // An ERROR record is still an important diagnostic. Display it by default
  // for Claude when ACF has no ELIGIBLE suggestion, but never treat it as
  // bindable; all team creation remains guarded by the real ACF verdict.
  const selectedSession=(a:RosterAgent)=>choices[a.agent_id]?.session || a.suggested_session ||
    (a.agent_id===CLAUDE_AGENT && a.sessions.some(s=>s.session_ref===LEGACY_SESSION) ? LEGACY_SESSION : "");
  const sessionsReady=selectedRows.length>0 && selectedRows.every(a=>a.route==="ENABLED"&&a.sessions.some(s=>s.session_ref===selectedSession(a)&&selectable(s)));
  const validFunctions=selectedRows.every(a=>{const f=functionTags(choices[a.agent_id]?.functions||"");return f.length<=6&&f.every(tag=>validTag.test(tag))&&new Set(f).size===f.length;});
  const members=(rows.flatMap(a=>(a.member??[]).map(m=>({...m,agent_id:a.agent_id,label:a.label??agentLabel(a.agent_id)}))));
  const memberHandles=new Set(members.map(x=>x.handle));
  const addedSessions=new Set(members.map(x=>x.agent_id+":"+x.session_ref));
  const eligibleNew=selectedRows.filter(a=>!addedSessions.has(a.agent_id+":"+selectedSession(a)));
  const taskRange=reviewer?"2–4 echte agentbeurten":"1 echte agentbeurt";
  const isV2=Boolean(runId&&roster?.run_schema===2);
  const showCreate=!isV2||newTeamMode;
  const canJoin=Boolean(isV2&&roster?.can_join_running_run);
  const openPreview=()=>{
    if(!selectedRows.length||selectedRows.length>8||!sessionsReady||!validFunctions)return;
    const taken=new Set<string>();
    const participants=selectedRows.map(a=>{
      const handle=newHandle(a.agent_id,taken);taken.add(handle);
      return {handle,agent_id:a.agent_id,
        session_ref:selectedSession(a),
        roles:functionTags(choices[a.agent_id]?.functions??"")};
    });
    setPreview({verb:"team-open-participants",args:{goal:goal.trim(),success_criterion:criterion.trim(),participants},
      description:"Nieuw v2-team registreren met bestaande Werkplaats-sessies. FIRST_TURN_READY is bindbaar maar blijft PREPARED tot Dennis werkelijk een eerste beurt start.",
      range:"0 modelbeurten"});
  };
  const joinPreview=()=>{
    if(!runId||!canJoin||eligibleNew.length!==1||!sessionsReady||!validFunctions)return;
    const a=eligibleNew[0];
    setPreview({verb:"team-join",args:{run_id:runId,handle:newHandle(a.agent_id,memberHandles),
      agent_id:a.agent_id,session_ref:selectedSession(a),roles:functionTags(choices[a.agent_id]?.functions??"")},
      description:"Eén deelnemer bij deze bestaande schema-2-run voegen. Geen modelturn.",range:"0 modelbeurten"});
  };
  const taskPreview=()=>{
    if(!runId||!isV2||!assignee||!/^T[1-9][0-9]{0,3}$/.test(taskId)||!taskBrief.trim()||!members.some(m=>m.handle===assignee))return;
    if(reviewer && (!members.some(m=>m.handle===reviewer)||reviewer===assignee||members.find(m=>m.handle===reviewer)?.agent_id===members.find(m=>m.handle===assignee)?.agent_id))return;
    setPreview({verb:"team-task",args:{run_id:runId,task_id:taskId,assignee,brief:taskBrief.trim(),
      ...(reviewer?{reviewer}:{}),...(taskTitle.trim()?{title:taskTitle.trim()}:{} )},
      description:"Taak in het ACF-board plaatsen. Start zelf geen modelturn; volgende beurt via bestaande team-step.",range:taskRange});
  };
  const confirm=async()=>{
    const action=preview;if(!action||sending||busy)return;
    setPreview(null);setSending(true);setNote("");
    try{
      const answer=await callControl(action.verb,action.args);
      if(!answer.ok){setNote("Niet uitgevoerd: "+refusalText(answer));return;}
      const id=action.verb==="team-open-participants"?String(answer.result?.run_id||""):runId;
      const range=action.verb==="team-task" ? ` · ACF bevestigt ${answer.result?.turns_at_least??"?"}–${answer.result?.turns_at_most??"?"} mogelijke turns` : "";
      setNote("ACF bevestigd: "+action.verb+" · "+(id||"run onbekend")+range+". Er is niet automatisch een agentturn gestart.");
      if(action.verb==="team-open-participants")setNewTeamMode(false);
      if(id){onSelectRun(id);await refresh(id);}
      await loadRoster();
    }catch(e){setNote("Geen bevestigde ACF-mutatie: "+String(e));}
    finally{setSending(false);}
  };

  return <>
    <button type="button" onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}
      aria-controls="team-samenstellen-panel" className="w-full rounded-lg border border-cyan-400/50 bg-background/40 px-3 py-2 text-left text-sm font-semibold">
      {expanded ? "Team samenstellen sluiten" : "Team samenstellen"}
    </button>
    {expanded && <section id="team-samenstellen-panel"
      className="mc-team-composer-body mt-2 min-w-0 rounded-xl border border-cyan-400/40 bg-background/40 p-3"
      aria-label="Team samenstellen" data-testid="team-samenstellen">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="text-base font-semibold">Team samenstellen</h3>
        <p className="mt-1 text-xs text-muted">Alle geregistreerde agents · eigen sessies · optionele functies · geen vaste bouwer/reviewer-zetels.</p></div>
      <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={()=>void loadRoster()}>Status vernieuwen</button>
    </div>
    <p className="mt-2 text-xs text-muted">Omgeving: <strong data-testid="acf-roster-environment">{roster?.environment??"ONBEKEND"}</strong> · ACF-roster: {roster?.source??"laden"} · {rows.length} agents · alleen Dennis activeert werk.</p>
    {problem && <p className="mt-2 text-xs text-warn" role="alert">Status niet actueel: {problem}. Vorige gegevens zijn mogelijk stale; teamacties geblokkeerd.</p>}
    <div className="mc-team-composer-agent-grid mt-3" aria-label="Volledige agent registry in Team Room" data-testid="team-roster">
    {rows.map(a=>{
      const choice=choices[a.agent_id]??{selected:false,session:"",functions:""};
      const exact=selectedSession(a);
      const chosen=a.sessions.find(s=>s.session_ref===exact);
      const ok=chosen?selectable(chosen):false;
      const verdict=a.route!=="ENABLED"?a.route:chosen?.verdict??a.why_not??"geen sessie gekozen";
      return <article key={a.agent_id} className={"mc-team-composer-agent-card min-w-0 rounded-lg border p-3 text-xs "+(choice.selected?"border-cyan-400/70 bg-cyan-950/30":"border-border bg-panel-2")} data-testid={"roster-agent-"+a.agent_id}>
        <header className="flex flex-wrap justify-between gap-2">
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={choice.selected} onChange={e=>byKey(a.agent_id,{selected:e.target.checked})} aria-label={"Selecteer "+(a.label??agentLabel(a.agent_id))}/>
            {a.label??agentLabel(a.agent_id)}
          </label>
          <span className={"rounded border px-1.5 py-0.5 text-[10px] "+(a.route==="ENABLED"?"text-ok":"text-warn")}>{a.route}</span>
        </header>
        <p className="mt-1 text-[11px] text-muted" data-testid={"roster-provenance-"+a.agent_id}>
          {roster?.environment==="WERKPLAATS"?"WERKPLAATS · eigen stagesessies":
           roster?.environment==="LIVE"?"LIVE · eigen productiesessies":"Omgeving onbekend · status niet bewezen"}
        </p>
        <p className={"mt-1 text-[11px] "+(choice.selected?"text-cyan-200":"text-muted")}>{choice.selected?"● GESELECTEERD · DRAFT":a.can_join_now?"● Kandidaat beschikbaar":"● Niet bindbaar · zie sessiestatus"}</p>
        {a.agent_id===CLAUDE_AGENT && choice.selected && claudeDiagnostic && <p className="mt-1 break-words text-warn"
            data-testid="acf-claude-route-diagnostic" role="status">
          Werkplaats · ACF-sessie: {claudeDiagnostic.sessionRef||"niet geregistreerd"}
          <span className="block">Native sessie: {claudeDiagnostic.registered?"geregistreerd":"niet geregistreerd"}
            {" "}· {claudeDiagnostic.nativeStatus||"onbekend"} ·
            {" "}identity {claudeDiagnostic.nativeSessionIdPresent?"aanwezig":"niet bevestigd"}</span>
          <span className="block">Modelroute: bestaande FCC-configuratie</span>
          <span className="block">ACF bindbaar: {claudeDiagnostic.canJoinNow?"JA":"NEE; readiness nog niet bevestigd"}</span>
          <span className="block">DENNIS-UAT: {claudeDiagnostic.readyForDennisUat?"READY":"NOG NIET BEWEZEN"}
            {" "}· PASS={claudeDiagnostic.dennisUatPass?"JA":"NEE"}</span>
        </p>}
        <details className="mc-team-composer-card-details mt-2 rounded border border-border/50 p-1.5" data-testid={"agent-details-"+a.agent_id}>
          <summary className="cursor-pointer text-[11px] text-cyan-200">Sessies, waarom niet & functies</summary>
        {a.why_not&&<p className="mt-2 break-words text-warn" data-testid={"why-not-"+a.agent_id}>{a.why_not}</p>}
        <label className="mt-2 block text-xs">Sessie / pin
          <select className={style+" mt-1"} value={exact} onChange={e=>byKey(a.agent_id,{session:e.target.value})} aria-label={"Kies sessie "+a.agent_id}>
            <option value="">Geen geregistreerde sessie</option>
            {a.sessions.map(s=><option key={s.session_ref} value={s.session_ref}>{s.session_ref} · {s.verdict}</option>)}
          </select>
        </label>
        {chosen && <div className="mt-1 break-words">
          <p className={ok?"text-ok":"text-warn"}>{verdict}{canPin(chosen)?" · uses your own "+(a.label??a.agent_id)+" pane":""}</p>
          <p className="mt-0.5 text-muted">{chosen.reason}{chosen.live?.reason?" · "+chosen.live.reason:""}</p>

          {chosen.last_error&&<p className="mt-1 break-words text-warn">
            {a.agent_id===CLAUDE_AGENT?(()=>{
              const proof=classifyClaudeError(chosen.last_error);
              return <>Foutcode: {proof.code} · {proof.detail}
                <span className="block">Bewezen modelaliassen: {proof.triedAliases.join(", ")||"niet afzonderlijk geregistreerd"}</span>
                <span className="block">Pogingroutes: {proof.triedRoutes.join(", ")||"niet afzonderlijk geregistreerd"}</span>
                <span className="block">Herstelbaar: {proof.recoverable?"voorwaardelijk — SDK/FCC route moet werken":"niet automatisch"}</span>
              </>;
            })():<>Laatste fout: {chosen.last_error}</>}
          </p>}
        </div>}
        <label className="mt-2 block">Functies (optioneel, komma&apos;s)
          <input className={style+" mt-1"} value={choice.functions} onChange={e=>byKey(a.agent_id,{functions:e.target.value})} placeholder="analyse, review"/>
        </label>
        {(a.member??[]).map(m=><p key={m.handle} className="mt-2 rounded border border-border p-1.5" data-testid={"member-"+m.handle}>
          <strong>{m.handle} · <span className={m.status==="FAILED"?"text-danger":m.status==="JOINED"?"text-warn":"text-ok"}>{m.status}</span></strong>
          <span className="block break-words text-muted">{m.session_ref} · {m.session_state} · {m.status_reason}</span>
        </p>)}
        </details>
      </article>;
    })}
    </div>
    {roster&&rows.length!==6&&<p className="mt-2 text-warn">De complete registry wordt verwacht; er zijn momenteel {rows.length} ACF-rosteritems. Controleer de live agentregistry voordat je een team opent.</p>}
    <p className="mt-2 text-xs text-muted">Geselecteerd: {selectedRows.length}/8 · sessiebindbaar: {sessionsReady?"ja":"nee"} · {selectedRows.length>8?"ACF maximum 8 deelnemers.":""}</p>

    <div className="mc-team-composer-workflow mt-4 space-y-2 rounded-lg border border-border p-3" data-testid="composer-workflow">
      {isV2&&<div className="flex flex-wrap gap-2" aria-label="Team aanmaken of huidige run uitbreiden">
        <button type="button" data-testid="composer-create-new" aria-pressed={newTeamMode} onClick={()=>{setNewTeamMode(true);setPreview(null);}}
          className={"mc-button "+(newTeamMode?"mc-button-primary":"mc-button-secondary")}>Nieuw team</button>
        <button type="button" data-testid="composer-expand-existing" aria-pressed={!newTeamMode} onClick={()=>{setNewTeamMode(false);setPreview(null);}}
          className={"mc-button "+(!newTeamMode?"mc-button-primary":"mc-button-secondary")}>Huidige team uitbreiden</button>
      </div>}
      {showCreate&&<>
        <p className="text-xs text-cyan-200">Een vrije gespreksruimte heeft geen verplicht teamdoel of succescriterium. Aanmaken stuurt geen modelbericht.</p>
        <details data-testid="composer-advanced" className="rounded border border-border p-2"><summary className="cursor-pointer text-xs">Geavanceerd · teamdoel en succescriterium (optioneel)</summary>
          <label className="mt-2 block text-xs">Teamdoel<textarea rows={2} maxLength={4000} className={style+" mt-1"} value={goal} onChange={e=>setGoal(e.target.value)}/></label>
          <label className="mt-2 block text-xs">Succescriterium<input maxLength={400} className={style+" mt-1"} value={criterion} onChange={e=>setCriterion(e.target.value)}/></label>
        </details>
        <button type="button" className="mc-button mc-button-success disabled:opacity-40" onClick={openPreview}
          disabled={Boolean(problem)||sending||!!busy||!selectedRows.length||selectedRows.length>8||!sessionsReady||!validFunctions}>
          Nieuw team · {selectedRows.length} deelnemer(s)
        </button>
      </>}
      {isV2&&!newTeamMode&&<>
        <p className="text-xs font-semibold">Run {runId} · schema 2 · {members.length} leden · {roster?.can_join_running_run?"join beschikbaar":"join momenteel niet mogelijk"}</p>
        <button type="button" className="mc-button mc-button-secondary disabled:opacity-40" onClick={joinPreview}
          disabled={Boolean(problem)||sending||!!busy||!canJoin||eligibleNew.length!==1||!sessionsReady||!validFunctions}>
          Toevoegen · {eligibleNew.length===1?eligibleNew[0].label:"selecteer precies één nieuw lid"}
        </button>
        <details data-testid="composer-task-advanced" className="rounded border border-border p-2"><summary className="cursor-pointer text-xs">Geavanceerd · Taak geven</summary><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs">Taak-ID<input className={style+" mt-1"} value={taskId} onChange={e=>setTaskId(e.target.value)}/></label>
          <label className="text-xs">Titel (optioneel)<input className={style+" mt-1"} value={taskTitle} maxLength={120} onChange={e=>setTaskTitle(e.target.value)}/></label>
          <label className="text-xs">Uitvoerder<select className={style+" mt-1"} value={assignee} onChange={e=>{setAssignee(e.target.value);setReviewer("");}}><option value="">Kies deelnemer</option>{members.map(m=><option key={m.handle} value={m.handle}>{m.handle}</option>)}</select></label>
          <label className="text-xs">Reviewer (optioneel)<select className={style+" mt-1"} value={reviewer} onChange={e=>setReviewer(e.target.value)}><option value="">Geen</option>{members.filter(m=>m.handle!==assignee&&m.agent_id!==members.find(x=>x.handle===assignee)?.agent_id).map(m=><option key={m.handle} value={m.handle}>{m.handle}</option>)}</select></label>
        </div>
        <label className="block text-xs">Opdracht<textarea className={style+" mt-1"} rows={2} value={taskBrief} maxLength={4000} onChange={e=>setTaskBrief(e.target.value)}/></label>
        <p className="text-xs text-muted">Geschatte beurten volgens ACF §12: {taskRange}. Toewijzen is nog geen team-step.</p>
        <button className="mc-button mc-button-secondary disabled:opacity-40" type="button" onClick={taskPreview}
          disabled={Boolean(problem)||sending||!!busy||!assignee||!taskBrief.trim()||!/^T[1-9][0-9]{0,3}$/.test(taskId)}>Taak geven · eerst bevestigen</button></details>
      </>}
      {run&&!isV2&&<p className="text-xs text-muted">Bestaande schema-1-run: join en task zijn hier uitgeschakeld. De oude v1-controls blijven beschikbaar.</p>}
    </div>
    {preview&&<div className="mt-3 rounded-lg border border-warn/50 p-3" data-testid="team-action-preview">
      <strong>Bevestiging · {preview.verb}</strong>
      <p className="mt-1 text-xs">{preview.description}</p>
      <p className="mt-1 text-xs font-semibold">Mogelijke beurten: {preview.range}</p>
      <pre className="my-2 max-h-36 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(preview.args,null,2)}</pre>
      <div className="flex gap-2"><button type="button" onClick={()=>void confirm()} disabled={sending||!!busy} className="mc-button mc-button-success">Bevestig actie</button>
      <button type="button" className="mc-button mc-button-secondary" onClick={()=>setPreview(null)}>Annuleer</button></div>
    </div>}
    {note&&<p className="mt-2 text-xs" role="status">{note}</p>}
  </section>}
  </>;
}
