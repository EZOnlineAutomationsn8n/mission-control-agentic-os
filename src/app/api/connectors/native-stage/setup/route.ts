import {NextResponse} from "next/server";
import {validateWerkplaatsOperator} from "@/lib/connectors/live/manus-stage-setup";
import {saveStageNativeKey} from "@/lib/cli-agents/stage-native-secret";
import {inspectNativeStageTransport} from "@/lib/cli-agents/stage-native-free-gate";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function agent(request:Request):"hermes"|"openclaw"|null{
 const name=new URL(request.url).searchParams.get("agent");
 return name==="hermes"||name==="openclaw"?name:null;
}
export async function GET(req:Request){
 if(process.env.MC_PREVIEW!=="1")return NextResponse.json({error:"NOT_STAGE"},{status:404,headers});
 const a=agent(req);if(!a)return NextResponse.json({error:"INVALID_AGENT"},{status:400,headers});
 const status=await inspectNativeStageTransport(a,"acf-werkplaats-"+a);
 return NextResponse.json(status,{headers});
}
export async function POST(req:Request){
 const auth=await validateWerkplaatsOperator(req);
 if(auth)return NextResponse.json({ok:false,error:auth},{status:403,headers});
 const a=agent(req);if(!a)return NextResponse.json({ok:false,error:"INVALID_AGENT"},{status:400,headers});
 if(new URL(req.url).searchParams.get("action")!=="save")
   return NextResponse.json({ok:false,error:"INVALID_ACTION"},{status:400,headers});
 const n=Number(req.headers.get("content-length")||0);
 if(n>4800)return NextResponse.json({ok:false,error:"PAYLOAD_TOO_LARGE"},{status:413,headers});
 let payload:unknown;
 try{payload=await req.json();}catch{return NextResponse.json({ok:false,error:"INVALID_JSON"},{status:400,headers});}
 const key=payload&&typeof payload==="object"&&"key" in payload?payload.key:undefined;
 const code=await saveStageNativeKey(key);
 return NextResponse.json({ok:code==="STAGE_NATIVE_KEY_STORED",code},{
  status:code==="STAGE_NATIVE_KEY_STORED"?200:409,headers,
 });
}
