import {NextResponse} from "next/server";
import {readManusMessages,sendManusFollowup,ManusConnectorError} from "@/lib/connectors/live/manus-v2";
import {appendAuditEvent} from "@/lib/audit-log-store";
export const dynamic="force-dynamic";
export async function GET(_:Request,ctx:{params:Promise<{taskId:string}>}){
  try{return NextResponse.json(await readManusMessages((await ctx.params).taskId),{headers:{"Cache-Control":"no-store"}});}
  catch(error){const e=error instanceof ManusConnectorError?error:new ManusConnectorError("MANUS_UNKNOWN",502,"Manus task messages unavailable");return NextResponse.json({ok:false,error:e.code,message:e.message},{status:e.httpStatus});}
}

export async function POST(req:Request,ctx:{params:Promise<{taskId:string}>}){
  let payload:unknown;
  try{payload=await req.json();}catch{return NextResponse.json({ok:false,error:"INVALID_JSON"},{status:400});}
  const {taskId}=await ctx.params;
  try{
    const result=await sendManusFollowup(taskId,payload);
    await appendAuditEvent({
      timestamp:new Date().toISOString(),connectorId:"manus",actionType:"manus-task-followup",
      status:"accepted",resultSummary:"Manus follow-up accepted: "+taskId,
      source:"api/connectors/manus/tasks/[taskId]/messages:POST",
    });
    return NextResponse.json({ok:true,task_id:taskId,request_id:result.request_id??null},
      {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    const e=error instanceof ManusConnectorError?error:new ManusConnectorError("MANUS_UNKNOWN",502,"Manus follow-up unavailable");
    return NextResponse.json({ok:false,error:e.code,message:e.message},{status:e.httpStatus});
  }
}
