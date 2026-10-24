import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import {stageManusKeyPath} from "./manus-stage-setup";

export const MANUS_V2_BASE = "https://api.manus.ai/v2/";
const DEFAULT_KEY_PATH = "/workspace/runtime-data/secrets/manus-api-key";
const KEY_MAX_BYTES = 4096;
const FETCH_TIMEOUT_MS = 12_000;

export type ManusKeyStatus = "missing" | "configured" | "invalid-permissions" | "invalid-key-format";
export class ManusConnectorError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string) {super(message);this.name="ManusConnectorError";}
}
type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

function asRecord(value: unknown): Json {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new ManusConnectorError("MANUS_INVALID_RESPONSE",502,"Manus returned an invalid response");
  return value as Json;
}

export async function readManusApiKey(): Promise<{ status: ManusKeyStatus; secret: string | null }> {
  // Existing MC preview isolation must remain effective even after a real Manus key is installed.
  const stageFile = process.env.MC_PREVIEW==="1" ? stageManusKeyPath() : null;
  if(process.env.MC_PREVIEW==="1" && !stageFile) return {status:"missing",secret:null};
  const file = stageFile || process.env.MANUS_API_KEY_FILE || DEFAULT_KEY_PATH;
  if(!path.isAbsolute(file)) return {status:"invalid-permissions",secret:null};
  let info;
  try { info=await fs.lstat(/* turbopackIgnore: true */ file); }
  catch(err){if((err as NodeJS.ErrnoException).code==="ENOENT") return {status:"missing",secret:null};return {status:"invalid-permissions",secret:null};}
  if(!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)!==0 || info.size>KEY_MAX_BYTES || info.size===0) {
    return {status:"invalid-permissions",secret:null};
  }
  let handle;
  try {
    handle=await fs.open(/* turbopackIgnore: true */ file,constants.O_RDONLY | constants.O_NOFOLLOW);
    const actual=await handle.stat();
    if(!actual.isFile() || actual.ino!==info.ino || actual.dev!==info.dev) return {status:"invalid-permissions",secret:null};
    const secret=(await handle.readFile({encoding:"utf8"})).trim();
    if(secret.length<16 || secret.length>KEY_MAX_BYTES || /\s/.test(secret)) return {status:"invalid-key-format",secret:null};
    return {status:"configured",secret};
  } catch {return {status:"invalid-permissions",secret:null};}
  finally {await handle?.close();}
}

export interface ManusStatus {
  systemId: "manus";
  connection: "pending-key"|"configured-unverified"|"connected"|"blocked"|"unknown";
  keyStatus: ManusKeyStatus;
  authVerified: boolean;
  taskSubmission: "requires-explicit-operator-spend-consent";
  mode: "server-side-api-key";
  lastCheckedAt: string;
  reason: string;
}

export async function getManusStatus(fetcher?: Fetcher): Promise<ManusStatus> {
  const {status,secret}=await readManusApiKey();
  const base:ManusStatus={systemId:"manus",connection:"pending-key",keyStatus:status,
    authVerified:false,taskSubmission:"requires-explicit-operator-spend-consent",
    mode:"server-side-api-key",lastCheckedAt:new Date().toISOString(),
    reason:"MANUS_API_KEY_NOT_CONFIGURED"};
  if(status!=="configured"||!secret) return {...base,connection:status==="missing"?"pending-key":"blocked",
    reason:status==="missing"?"MANUS_API_KEY_NOT_CONFIGURED":"MANUS_KEY_FILE_SECURITY_OR_FORMAT_INVALID"};
  if(!fetcher) return {...base,connection:"configured-unverified",reason:"KEY_PRESENT_AUTH_NOT_VERIFIED"};
  try {
    const result=await requestManusV2("user.me","GET",undefined,{fetcher,secret});
    return result.ok===true&&typeof result.user_id==="string" ?
      {...base,connection:"connected",authVerified:true,reason:"MANUS_AUTHENTICATED_VIA_USER_ME"} :
      {...base,connection:"unknown",reason:"MANUS_USER_ME_UNEXPECTED_RESPONSE"};
  } catch(error) {
    if(error instanceof ManusConnectorError && error.httpStatus===401) return {...base,connection:"blocked",reason:"MANUS_AUTHENTICATION_REJECTED"};
    return {...base,connection:"unknown",reason:"MANUS_AUTHENTICATION_CHECK_UNAVAILABLE"};
  }
}

const METHODS = {
  "user.me":"GET",
  "task.create":"POST",
  "task.detail":"GET",
  "task.listMessages":"GET",
  "task.sendMessage":"POST",
} as const;
type ManusMethod = keyof typeof METHODS;
export async function requestManusV2(
  method: ManusMethod,
  verb: "GET"|"POST",
  payload?: Json,
  options?: { fetcher?: Fetcher; secret?: string },
): Promise<Json> {
  if(METHODS[method]!==verb) throw new ManusConnectorError("MANUS_METHOD_NOT_ALLOWED",400,"Unsupported Manus method");
  const secret=options?.secret ?? (await readManusApiKey()).secret;
  if(!secret) throw new ManusConnectorError("MANUS_KEY_MISSING",503,"Configure Manus API key server-side first");
  const url=new URL(method,MANUS_V2_BASE);
  if(verb==="GET" && payload){
    for(const [k,v] of Object.entries(payload)) {
      if(k!=="task_id"&&k!=="limit"&&k!=="order"&&k!=="cursor") throw new ManusConnectorError("MANUS_QUERY_NOT_ALLOWED",400,"Unsupported Manus query");
      if(typeof v!=="string"&&typeof v!=="number") throw new ManusConnectorError("MANUS_INVALID_QUERY",400,"Invalid Manus query");
      url.searchParams.set(k,String(v));
    }
  }
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
  try {
    const response=await (options?.fetcher??fetch)(url.toString(),{
      method:verb,headers:{"x-manus-api-key":secret,"content-type":"application/json"},
      body:verb==="POST"?JSON.stringify(payload):undefined,cache:"no-store",redirect:"error",signal:controller.signal,
    });
    if(!response.ok) throw new ManusConnectorError("MANUS_UPSTREAM_HTTP_ERROR",response.status,
      response.status===401?"Manus rejected authentication":"Manus request failed; check connector status");
    const result=asRecord(await response.json());
    if(result.ok!==true) throw new ManusConnectorError("MANUS_API_REJECTED",502,"Manus declined the request");
    return result;
  } catch(error) {
    if(error instanceof ManusConnectorError) throw error;
    throw new ManusConnectorError("MANUS_NETWORK_UNAVAILABLE",502,"Manus API request unavailable");
  } finally {clearTimeout(timer);}
}
export function validManusTaskId(id:unknown): id is string {
  return typeof id==="string" && id.length>=1 && id.length<=160 && /^[A-Za-z0-9_-]+$/.test(id);
}
export async function submitManusTask(input:unknown, options?:{fetcher?:Fetcher;secret?:string}):Promise<Json> {
  const obj=asRecord(input);
  if(obj.acknowledgeManusCreditUsage!==true) throw new ManusConnectorError("MANUS_SPEND_NOT_AUTHORIZED",403,"Explicit per-task credit consent is required");
  const prompt=obj.prompt, title=obj.title;
  if(typeof prompt!=="string" || prompt.trim().length<1 || prompt.trim().length>15000) throw new ManusConnectorError("MANUS_INVALID_PROMPT",400,"Prompt must contain 1–15000 characters");
  if(title!==undefined && (typeof title!=="string"||title.length>150)) throw new ManusConnectorError("MANUS_INVALID_TITLE",400,"Title must be 150 characters or less");
  return requestManusV2("task.create","POST",{
    message:{content:prompt.trim()},share_visibility:"private",interactive_mode:false,
    ...(typeof title==="string"&&title.trim()?{title:title.trim()}:{}),
  },options);
}
export async function readManusTask(taskId:string, options?:{fetcher?:Fetcher;secret?:string}) {
  if(!validManusTaskId(taskId)) throw new ManusConnectorError("MANUS_INVALID_TASK_ID",400,"Invalid Manus task id");
  return requestManusV2("task.detail","GET",{task_id:taskId},options);
}
export async function readManusMessages(taskId:string, options?:{fetcher?:Fetcher;secret?:string}) {
  if(!validManusTaskId(taskId)) throw new ManusConnectorError("MANUS_INVALID_TASK_ID",400,"Invalid Manus task id");
  return requestManusV2("task.listMessages","GET",{task_id:taskId,order:"asc",limit:100},options);
}

/** Follow-up uses the same external Manus task_id: provider-owned conversation continuity.
 * Every potentially credit-using message needs a new explicit operator acknowledgement.
 */
export async function sendManusFollowup(
  taskId: string, input: unknown, options?: {fetcher?:Fetcher;secret?:string},
): Promise<Json> {
  if(!validManusTaskId(taskId)) throw new ManusConnectorError("MANUS_INVALID_TASK_ID",400,"Invalid Manus task id");
  const obj=asRecord(input);
  if(obj.acknowledgeManusCreditUsage!==true) throw new ManusConnectorError(
    "MANUS_SPEND_NOT_AUTHORIZED",403,"A new explicit credit acknowledgement is required for each message");
  const content=obj.message;
  if(typeof content!=="string" || !content.trim() || content.trim().length>15000) throw new ManusConnectorError(
    "MANUS_INVALID_PROMPT",400,"Follow-up must contain 1–15000 characters");
  return requestManusV2("task.sendMessage","POST",
    {task_id:taskId,message:{content:content.trim()}},options);
}
