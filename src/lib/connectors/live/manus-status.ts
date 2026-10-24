import {getManusStatus, type ManusStatus} from "./manus-v2";
let cached:Promise<ManusStatus>|null=null;
let expiresAt=0;
// A read-only, bounded authentication probe. Never creates tasks.
export async function readManusLiveStatus():Promise<ManusStatus> {
  const now=Date.now();
  if(cached && now<expiresAt) return cached;
  cached=getManusStatus(process.env.MC_PREVIEW==="1" ? undefined : fetch);
  expiresAt=now+60_000;
  return cached;
}

export function clearManusStatusCache(){cached=null;expiresAt=0;}
