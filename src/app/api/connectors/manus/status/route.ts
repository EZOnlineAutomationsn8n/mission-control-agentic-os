import {NextResponse} from "next/server";
import {readManusLiveStatus} from "@/lib/connectors/live/manus-status";
export const dynamic="force-dynamic";
export async function GET(){
  return NextResponse.json(await readManusLiveStatus(),{
    headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"},
  });
}
