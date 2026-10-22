"use client";
import {useEffect,useState} from "react";
import type {ManusStatus} from "@/lib/connectors/live/manus-v2";

// Reuses the Registry details view. No separate Manus cockpit, session or ACF seat.
export function ManusOperatorPanel(){
  const [status,setStatus]=useState<ManusStatus|null>(null);
  const [prompt,setPrompt]=useState("");
  const [title,setTitle]=useState("");
  const [approved,setApproved]=useState(false);
  const [taskId,setTaskId]=useState("");
  const [readout,setReadout]=useState<string>("");
  const [followup,setFollowup]=useState("");
  const [followupApproved,setFollowupApproved]=useState(false);
  const [recentTasks,setRecentTasks]=useState<Array<{task_id:string;accepted_at:string}>>([]);
  const [busy,setBusy]=useState(false);
  const refresh=async()=>{
    try{const r=await fetch("/api/connectors/manus/status",{cache:"no-store"});setStatus(r.ok?await r.json() as ManusStatus:null);}
    catch{setStatus(null);}
  };
  useEffect(()=>{
    let cancelled=false;
    fetch("/api/connectors/manus/status",{cache:"no-store"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{if(!cancelled)setStatus(data as ManusStatus|null);})
      .catch(()=>{if(!cancelled)setStatus(null);});
    return ()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    let cancelled=false;
    fetch("/api/connectors/manus/tasks",{cache:"no-store"})
      .then(r=>r.ok?r.json():null).then(data=>{
        if(!cancelled && Array.isArray(data?.tasks))setRecentTasks(data.tasks);
      }).catch(()=>{});
    return ()=>{cancelled=true;};
  },[]);
  const connected=status?.connection==="connected";
  const lookup=async(messages:boolean)=>{
    if(!taskId.trim() || busy)return;
    setBusy(true);setReadout("");
    try{
      const id=encodeURIComponent(taskId.trim());
      const r=await fetch("/api/connectors/manus/tasks/"+id+(messages?"/messages":""),{cache:"no-store"});
      const data=await r.json();
      setReadout(r.ok?
        messages?JSON.stringify({task_id:data.task_id,messages:data.messages,next_cursor:data.next_cursor},null,2):
          JSON.stringify({task:data.task},null,2):
          "Lookup blocked: "+String(data.error??"request failed"));
    } catch{setReadout("Manus lookup is unavailable");}finally{setBusy(false);}
  };
  const submit=async()=>{
    if(!connected||!approved||busy||!prompt.trim())return;
    setBusy(true);setReadout("");
    try{
      const r=await fetch("/api/connectors/manus/tasks",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({prompt,title,acknowledgeManusCreditUsage:approved})
      });
      const data=await r.json();
      if(r.ok){setTaskId(typeof data.task_id==="string"?data.task_id:"");setReadout("Task created: "+String(data.task_id??"unavailable"));}
      else setReadout("Task not created: "+String(data.error??"request rejected"));
    }catch{setReadout("Task not created: connection unavailable");}
    finally{setApproved(false);setBusy(false);}
  };
  const sendFollowup=async()=>{
    if(!connected||!followupApproved||!taskId.trim()||!followup.trim()||busy)return;
    setBusy(true);setReadout("");
    try{
      const r=await fetch("/api/connectors/manus/tasks/"+encodeURIComponent(taskId.trim())+"/messages",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({message:followup,acknowledgeManusCreditUsage:true}),
      });
      const data=await r.json();
      setReadout(r.ok?"Follow-up accepted for existing task "+taskId+". Refresh results to inspect async completion.":
        "Follow-up not sent: "+String(data.error??"request rejected"));
      if(r.ok)setFollowup("");
    }catch{setReadout("Follow-up not sent: connection unavailable");}
    finally{setFollowupApproved(false);setBusy(false);}
  };
  return <section className="mt-5 rounded-xl border border-border p-3 space-y-3 max-w-2xl" aria-label="Manus API v2 connection and tasks">
    <div className="font-semibold text-sm">Manus API v2 · operator control</div>
    <div className="text-xs text-muted" role="status">
      Connection: <strong>{status?.connection??"unknown"}</strong> — {status?.reason??"Status unavailable"}.
      {" "}Credentials remain server-side. A task may consume Manus credits.
    </div>
    {!connected&&<p className="text-xs text-warn">
      {status?.keyStatus==="missing"?"API key not configured. Place one secret file securely on the Mission Control VPS.":
      "Manus is not authenticated. Inspect the server-side key configuration; tasks stay disabled."}
    </p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={()=>void refresh()} className="rounded border border-border px-3 py-1 text-xs">Refresh status</button>
    </div>
    <label className="block text-xs">Task title (optional)
      <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={150} placeholder="Task title"
        className="mt-1 block w-full rounded border border-border bg-panel px-2 py-2" />
    </label>
    <label className="block text-xs">New Manus task
      <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={15000} rows={3} placeholder="Describe the task"
        className="mt-1 block w-full rounded border border-border bg-panel px-2 py-2"/>
    </label>
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} disabled={!connected} />
      <span>I explicitly authorize this specific Manus task, understanding that it may consume Manus credits.</span>
    </label>
    <button type="button" disabled={!connected||!approved||!prompt.trim()||busy}
      onClick={()=>void submit()} className="rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-30">
      Create this Manus task
    </button>
    <div className="border-t border-border pt-3 space-y-2">
      <label className="block text-xs">Existing Manus task ID
        <input value={taskId} onChange={e=>setTaskId(e.target.value)} placeholder="task_id"
          className="mt-1 block w-full rounded border border-border bg-panel px-2 py-2"/>
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={!connected||!taskId||busy} onClick={()=>void lookup(false)}
          className="rounded border border-border px-3 py-1 text-xs disabled:opacity-30">Read status</button>
        <button type="button" disabled={!connected||!taskId||busy} onClick={()=>void lookup(true)}
          className="rounded border border-border px-3 py-1 text-xs disabled:opacity-30">Read results / messages</button>
      </div>
    </div>
    {recentTasks.length>0&&<div className="space-y-1">
      <p className="text-xs text-muted">Eerder aangemaakte Manus-taken (uit bestaand auditlog)</p>
      <select className="block w-full rounded border border-border bg-panel p-2 text-xs" value={taskId}
        onChange={e=>setTaskId(e.target.value)}>
        <option value="">Kies een eerder task_id</option>
        {recentTasks.map(t=><option key={t.task_id} value={t.task_id}>{t.task_id} · {t.accepted_at}</option>)}
      </select>
    </div>}
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-semibold">Vervolgbericht · hetzelfde Manus task_id</p>
      <textarea value={followup} onChange={e=>setFollowup(e.target.value)} rows={2}
        maxLength={15000} placeholder="Vervolg op de gekozen bestaande taak"
        className="block w-full rounded border border-border bg-panel p-2 text-xs"/>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={followupApproved} onChange={e=>setFollowupApproved(e.target.checked)}
          disabled={!connected}/>
        <span>Ik keur dit afzonderlijke vervolgbericht goed; het kan Manus-credits kosten.</span>
      </label>
      <button type="button" disabled={!connected||!followupApproved||!followup.trim()||!taskId.trim()||busy}
        onClick={()=>void sendFollowup()} className="rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-30">
        Vervolgbericht versturen
      </button>
    </div>
    {readout&&<pre role="status" className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-panel p-2 text-xs">{readout}</pre>}
  </section>;
}
