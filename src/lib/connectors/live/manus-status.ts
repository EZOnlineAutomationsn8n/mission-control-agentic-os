import {getManusStatus, type ManusStatus} from "./manus-v2";
import {readManusApiKey} from "./manus-v2";
import {readManusStageLastVerified} from "./manus-stage-auth";
let cached:Promise<ManusStatus>|null=null;
let expiresAt=0;
// A read-only, bounded authentication probe. Never creates tasks.
export async function readManusLiveStatus():Promise<ManusStatus> {
  const now=Date.now();
  if(process.env.MC_PREVIEW!=="1" && cached && now<expiresAt) return cached;
  cached=(async()=>{
    // Provider user.me is never called by the polling/status endpoint in stage.
    const status=await getManusStatus(process.env.MC_PREVIEW==="1" ? undefined : fetch);
    if(process.env.MC_PREVIEW!=="1" || status.connection!=="configured-unverified")return status;
    const key=await readManusApiKey();
    if(key.status!=="configured" || !key.secret)return status;
    const verifiedAt=await readManusStageLastVerified(key.secret);
    return verifiedAt?{...status,connection:"connected" as const,authVerified:true,
      reason:"MANUS_AUTHENTICATED_VIA_USER_ME_STAGE_LAST_VERIFIED",
      lastCheckedAt:verifiedAt}:status;
  })();
  expiresAt=now+60_000;
  return cached;
}

export function clearManusStatusCache(){cached=null;expiresAt=0;}
