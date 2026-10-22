import {NextResponse} from "next/server";
import {readManusTask,ManusConnectorError} from "@/lib/connectors/live/manus-v2";
export const dynamic="force-dynamic";
export async function GET(_:Request,ctx:{params:Promise<{taskId:string}>}){
  try{return NextResponse.json(await readManusTask((await ctx.params).taskId),{headers:{"Cache-Control":"no-store"}});}
  catch(error){const e=error instanceof ManusConnectorError?error:new ManusConnectorError("MANUS_UNKNOWN",502,"Manus task status unavailable");return NextResponse.json({ok:false,error:e.code,message:e.message},{status:e.httpStatus});}
}
