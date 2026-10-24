/** Existing Werkplaats session data is the owner of stage-only native secrets.
 * No production credential import; no raw key returned to a GET/UI response.
 */
import { promises as fs, constants } from "node:fs";
import path from "node:path";

export function stageNativeKeyPath():string|null {
  if (process.env.MC_PREVIEW!=="1")return null;
  const dir=process.env.CLI_AGENT_SESSION_DATA_DIR;
  if(!dir)return null;
  const resolved=path.resolve(dir);
  if(!resolved.endsWith("/.stage-achtergrond/data"))return null;
  return path.join(resolved,"secrets","native-stage-openrouter-key");
}

export async function stageNativeKeyPresent():Promise<boolean>{
  const p=stageNativeKeyPath();if(!p)return false;
  try{
    const st=await fs.lstat(/* turbopackIgnore: true */ p);
    return st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&
      st.size>=20&&st.size<=4096;
  }catch{return false;}
}

/** Never call during status polling; only once after a passed transport gate. */
export async function readStageNativeKey():Promise<string|null>{
  const p=stageNativeKeyPath();
  if(!p||!(await stageNativeKeyPresent()))return null;
  const data=await fs.readFile(/* turbopackIgnore: true */ p,"utf8");
  return /^[A-Za-z0-9._-]{20,4096}$/.test(data)?data:null;
}

export async function saveStageNativeKey(input:unknown):Promise<string>{
  const p=stageNativeKeyPath();
  if(!p)return "STAGE_SECRET_HOME_UNAVAILABLE";
  if(typeof input!=="string"||!/^sk-or-v1-[A-Za-z0-9_-]{16,4050}$/.test(input))
    return "OPENROUTER_STAGE_KEY_FORMAT_INVALID";
  const d=path.dirname(p);
  try{
    await fs.mkdir(d,{recursive:true,mode:0o700});
    const st=await fs.lstat(/* turbopackIgnore: true */ d);
    if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
      return "STAGE_SECRET_DIR_NOT_PRIVATE";
    const old=await fs.lstat(/* turbopackIgnore: true */ p).catch((e:NodeJS.ErrnoException)=>{
      if(e.code==="ENOENT")return null;
      throw e;
    });
    if(old)return "STAGE_KEY_ALREADY_CONFIGURED_NO_SILENT_ROTATION";
    const h=await fs.open(p,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await h.writeFile(input,"utf8");await h.sync();}
    finally{await h.close();}
    await fs.chmod(p,0o600);
    return "STAGE_NATIVE_KEY_STORED";
  }catch{return "STAGE_NATIVE_KEY_WRITE_DENIED";}
}
