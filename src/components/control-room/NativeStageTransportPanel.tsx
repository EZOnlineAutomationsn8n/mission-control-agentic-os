"use client";
import {useCallback,useEffect,useState} from "react";
type Agent="hermes"|"openclaw";
type Status={
  agentId:Agent;costMode:"FREE_ONLY";configuredModel:string|null;
  stageCredentialConfigured:boolean;configVerified:boolean;effectiveFallbacks:string;
  toolsVerifiedDisabled:boolean;gateway:string;catalogStatus:string;catalogCode:string;
  canSend:boolean;code:string;stageSource:string;
};

export function NativeStageTransportPanel({agentId}:{agentId:Agent}){
 const [status,setStatus]=useState<Status|null>(null);
 const [problem,setProblem]=useState("");
 const [key,setKey]=useState("");
 const [saving,setSaving]=useState(false);
 const [showEntry,setShowEntry]=useState(false);
 const load=useCallback(async()=>{
   try{
    const res=await fetch("/api/connectors/native-stage/setup?agent="+agentId,{cache:"no-store",credentials:"same-origin"});
    if(!res.ok)throw new Error("STATUS_HTTP_"+res.status);
    setStatus(await res.json() as Status);setProblem("");
   }catch(e){setProblem(e instanceof Error?e.message:"STAGE_STATUS_UNAVAILABLE");}
 },[agentId]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 async function save(){
  if(saving||!key)return;
  setSaving(true);setProblem("");
  try{
    const res=await fetch("/api/connectors/native-stage/setup?agent="+agentId+"&action=save",{
      method:"POST",cache:"no-store",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({key})
    });
    const v=await res.json() as {ok?:boolean;code?:string;error?:string};
    if(!res.ok||!v.ok)throw new Error(v.code||v.error||"KEY_NOT_SAVED");
    setKey("");setShowEntry(false);await load();
  }catch(e){setProblem(e instanceof Error?e.message:"KEY_SAVE_FAILED");}
  finally{setSaving(false);}
 }
 return <section className="rounded border border-border bg-panel-2/70 p-2 text-xs space-y-1.5"
  data-testid={"stage-native-transport-"+agentId} aria-label={agentId+" stage transport readiness"}>
  <div className="font-semibold">Werkplaats · {agentId==="hermes"?"Hermes":"OpenClaw"} · native transport</div>
  <div>Modus: <strong>FREE_ONLY</strong> · Bron: eigen stage-profiel + officiële catalogus</div>
  <div>Model: <span className="mono">{status?.configuredModel||"niet bevestigd"}</span></div>
  <div>Stagecredential: {status?.stageCredentialConfigured?"veilig opgeslagen":"ontbreekt"} ·
   Toolblokkade: {status?.toolsVerifiedDisabled?"bewezen":"niet bewezen"} ·
   Fallback: {status?.effectiveFallbacks||"onbekend"}</div>
  <div>Officiële prijsgate: {status?.catalogCode||"wordt gecontroleerd"} ·
   Transport: {status?.gateway||"onbekend"}</div>
  <div role="status" className={status?.canSend?"text-ok":"text-warn"}>
   {status?.canSend?"READY_FOR_DENNIS_FIRST_NATIVE_TURN":"BLOCKED: "+(status?.code||"VERIFICATIE_NODIG")}
  </div>
  {!status?.stageCredentialConfigured&&<div className="space-y-1">
   <button type="button" className="mc-button mc-button-secondary mc-button-sm"
    onClick={()=>setShowEntry(v=>!v)}>{showEntry?"Sluit stagekey-invoer":"Configureer eigen stage-OpenRouter-key"}</button>
   {showEntry&&<div className="flex flex-wrap gap-1 items-center">
    <input type="password" autoComplete="off" spellCheck={false} aria-label="Nieuwe uitsluitend voor Werkplaats bedoelde OpenRouter key"
     value={key} onChange={e=>setKey(e.target.value)}
     placeholder="sk-or-v1-..." className="min-w-0 flex-1 rounded border border-border bg-background p-1.5 text-xs"/>
    <button type="button" className="mc-button mc-button-secondary mc-button-sm" disabled={saving||!key}
      onClick={()=>void save()}>{saving?"Opslaan…":"Veilig opslaan"}</button>
   </div>}
   <p className="text-muted">Alleen een nieuwe, voor deze Werkplaats bedoelde key. Geen productiekey kopiëren.
     Opslaan doet geen modelaanvraag en autoriseert geen betaalde modellen.</p>
  </div>}
  <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={()=>void load()}>
   Hercontroleer stageverbinding
  </button>
  {problem&&<p role="alert" className="text-danger">{problem}</p>}
 </section>;
}
