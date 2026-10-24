import {createHash} from "node:crypto";
import {promises as fs,constants} from "node:fs";
import path from "node:path";
import {stageManusKeyPath} from "./manus-stage-setup";

const MAX_VERIFICATION_AGE_MS = 24 * 60 * 60 * 1000;
type Attestation = {version:1;verifiedAt:string;keyFingerprint:string};
export function stageManusAuthPath():string|null {
  const keyPath=stageManusKeyPath();
  return keyPath?path.join(path.dirname(keyPath),"manus-stage-last-verified.json"):null;
}
// Key contents never leave the server or enter logs. Hash only binds the last
// provider-verified identity to this specific stage credential, not production.
export function fingerprintManusStageKey(secret:string):string {
  return createHash("sha256").update(secret,"utf8").digest("hex");
}
export function verifyAttestation(record:unknown,secret:string,now=Date.now()):string|null {
  if(!record || typeof record!=="object" || Array.isArray(record))return null;
  const attestation=record as Partial<Attestation>;
  if(attestation.version!==1 || typeof attestation.verifiedAt!=="string" ||
     typeof attestation.keyFingerprint!=="string") return null;
  const timestamp=Date.parse(attestation.verifiedAt);
  if(!Number.isFinite(timestamp)||timestamp>now||now-timestamp>MAX_VERIFICATION_AGE_MS)return null;
  if(attestation.keyFingerprint!==fingerprintManusStageKey(secret))return null;
  return attestation.verifiedAt;
}
export async function readManusStageLastVerified(secret:string):Promise<string|null> {
  const filename=stageManusAuthPath();
  if(!filename)return null;
  try {
    const stat=await fs.lstat(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0 ||stat.size>1024)return null;
    const handle=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const actual=await handle.stat();
      if(actual.ino!==stat.ino||actual.dev!==stat.dev)return null;
      const data:unknown=JSON.parse(await handle.readFile("utf8"));
      return verifyAttestation(data,secret);
    } finally{await handle.close();}
  }catch{return null;}
}
export async function recordManusStageVerification(secret:string):Promise<boolean> {
  const filename=stageManusAuthPath();
  if(!filename || !secret)return false;
  const directory=path.dirname(filename);
  const record:Attestation={version:1,verifiedAt:new Date().toISOString(),
    keyFingerprint:fingerprintManusStageKey(secret)};
  const temporary=path.join(directory,".manus-auth-record-"+process.pid+"-"+createHash("sha256").update(record.verifiedAt).digest("hex").slice(0,12));
  try {
    const dirStat=await fs.lstat(directory);
    if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(dirStat.mode&0o077)!==0)return false;
    const h=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await h.writeFile(JSON.stringify(record),"utf8");await h.sync();}
    finally{await h.close();}
    await fs.rename(temporary,filename);
    return true;
  }catch{
    await fs.unlink(temporary).catch(()=>{});
    return false;
  }
}
