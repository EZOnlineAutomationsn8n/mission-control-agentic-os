import {NextResponse} from "next/server";
import {submitManusTask,ManusConnectorError} from "@/lib/connectors/live/manus-v2";
import {appendAuditEvent,readAuditEvents} from "@/lib/audit-log-store";
export const dynamic="force-dynamic";
export async function POST(req:Request){
  let body:unknown;
  try{body=await req.json();}catch{return NextResponse.json({ok:false,error:"INVALID_JSON"},{status:400});}
  try{
    const result=await submitManusTask(body);
    // Audited receipt, without prompt or key.
    await appendAuditEvent({
      timestamp:new Date().toISOString(),connectorId:"manus",actionType:"manus-task-create",
      status:"accepted",resultSummary:"Manus task accepted: "+String(result.task_id??"unknown"),
      source:"api/connectors/manus/tasks:POST",
    });
    return NextResponse.json({ok:true,task_id:result.task_id,task_url:result.task_url,request_id:result.request_id},
      {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const e=error instanceof ManusConnectorError?error:new ManusConnectorError("MANUS_UNKNOWN",502,"Manus task submission unavailable");
    return NextResponse.json({ok:false,error:e.code,message:e.message},{status:e.httpStatus});
  }
}

/** Reuse existing durable audit log; not a second task or session registry.
 * Only task IDs (never prompts or API secrets) are presented for continuity.
 */
export async function GET() {
  try {
    const events=await readAuditEvents(500);
    const ids=new Set<string>();
    const tasks:{task_id:string;accepted_at:string}[]=[];
    for(const event of events) {
      if(event.connectorId!=="manus" || event.actionType!=="manus-task-create") continue;
      const id=event.resultSummary.match(/^Manus task accepted: ([A-Za-z0-9_-]{1,160})$/)?.[1];
      if(id && !ids.has(id)) {ids.add(id);tasks.push({task_id:id,accepted_at:event.timestamp});}
      if(tasks.length>=25) break;
    }
    return NextResponse.json({ok:true,tasks},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({ok:false,error:"MANUS_AUDIT_UNAVAILABLE"},{status:503});
  }
}
