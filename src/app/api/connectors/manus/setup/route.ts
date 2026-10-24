import {NextResponse} from "next/server";
import {writeStageManusSecret,validateWerkplaatsOperator} from "@/lib/connectors/live/manus-stage-setup";
import {clearManusStatusCache} from "@/lib/connectors/live/manus-status";
import {getManusStatus} from "@/lib/connectors/live/manus-v2";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function POST(req:Request){
  const auth = await validateWerkplaatsOperator(req);
  if (auth) return NextResponse.json({ok:false,error:auth},{status:403,headers});
  const action = new URL(req.url).searchParams.get("action");
  if(action==="verify"){
    // This is only user.me, a read-only provider authentication check; never task.create.
    const status = await getManusStatus(fetch);
    return NextResponse.json({ok:status.connection==="connected",connection:status.connection,reason:status.reason},{headers});
  }
  if(action!=="save")return NextResponse.json({ok:false,error:"UNKNOWN_ACTION"},{status:400,headers});
  const contentLength = Number(req.headers.get("content-length")||0);
  if(contentLength>5000)return NextResponse.json({ok:false,error:"PAYLOAD_TOO_LARGE"},{status:413,headers});
  let payload:unknown;
  try {payload=await req.json();} catch {return NextResponse.json({ok:false,error:"INVALID_JSON"},{status:400,headers});}
  if(!payload || typeof payload!=="object" || !("key" in payload))return NextResponse.json({ok:false,error:"MISSING_KEY"},{status:400,headers});
  const result=await writeStageManusSecret(payload.key);
  if(result==="STAGE_SECRET_STORED")clearManusStatusCache();
  return NextResponse.json({ok:result==="STAGE_SECRET_STORED",result},{status:result==="STAGE_SECRET_STORED"?200:409,headers});
}
