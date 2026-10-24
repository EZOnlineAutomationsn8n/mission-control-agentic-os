import {NextResponse} from "next/server";
import {writeStageManusSecret,validateWerkplaatsOperator} from "@/lib/connectors/live/manus-stage-setup";
import {clearManusStatusCache} from "@/lib/connectors/live/manus-status";
import {getManusStatus,readManusApiKey} from "@/lib/connectors/live/manus-v2";
import {recordManusStageVerification} from "@/lib/connectors/live/manus-stage-auth";

export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function POST(req:Request){
  const auth = await validateWerkplaatsOperator(req);
  if (auth) return NextResponse.json({ok:false,error:auth},{status:403,headers});
  const action = new URL(req.url).searchParams.get("action");
  if(action==="verify"){
    // This is only user.me, a read-only provider authentication check; never task.create.
    const status = await getManusStatus(fetch);
    if(status.connection!=="connected"){
      clearManusStatusCache();
      return NextResponse.json({ok:false,connection:status.connection,reason:status.reason},{headers});
    }
    // Only persist a successful provider user.me verification, bound to the stage key.
    const credential=await readManusApiKey();
    if(credential.status!=="configured" || !credential.secret ||
      !(await recordManusStageVerification(credential.secret))){
      return NextResponse.json({ok:false,reason:"MANUS_VERIFIED_BUT_STAGE_EVIDENCE_NOT_SAVED"},{status:503,headers});
    }
    clearManusStatusCache();
    return NextResponse.json({ok:true,connection:"connected",reason:"MANUS_AUTHENTICATED_VIA_USER_ME_STAGE_LAST_VERIFIED"},{headers});
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
