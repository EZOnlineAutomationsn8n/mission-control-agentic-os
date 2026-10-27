/**
 * Presentation-only browser preferences. ACF is the sole authority for runs,
 * messages and native sessions. Never store a transcript or replay a turn.
 */
export const ROOM_VIEW_KEY = "mc.team-room.operator-view.v1";
export const ROOM_FOCUS_KEY = "mc.team-room.focus-panel.v1";

export type StoredRoomView = {
  version: 1;
  runId: string | null;
  mode: "discuss" | "fusion" | "council" | "playground";
  historyOpen: boolean;
  detailsOpen: boolean;
  operatorSection: "team"|"conversation"|"history";
  operatorObjective: string;
  operatorSuccessCriterion: string;
  draftChoices: Record<string,{selected:boolean;session:string;functions:string}>;
  focusPreference: {role:string|null;sequence:number|null};
};

export type StoredShellView = {
  version:1;
  visualSlotOffset:number;
  focusedId:string|null;
  readingSurface:"live"|"per-agent"|"full";
};
export const roomShellKey=(runId:string|null)=>"mc.team-room.shell.v1."+ (runId ?? "empty");

const validRun=(v:unknown):v is string=>typeof v==="string" && v.length>0 && v.length<=160 &&
  /^[a-zA-Z0-9_-]+$/.test(v);
export const validRunId=validRun;
const validWord=(v:unknown):v is string=>typeof v==="string"&&v.length<=160;
const validText=(v:unknown,max=12000):v is string=>typeof v==="string"&&v.length<=max;
const obj=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==="object"&&!Array.isArray(value);

export function parseRoomView(raw:string|null):StoredRoomView|null {
 if(!raw||raw.length>100_000)return null;
 try{
  const p:unknown=JSON.parse(raw);
  if(!obj(p)||p.version!==1)return null;
  const runId=p.runId===null?null:validRun(p.runId)?p.runId:null;
  const mode=p.mode==="discuss"||p.mode==="fusion"||p.mode==="council"||p.mode==="playground"?p.mode:"discuss";
  const drafts:StoredRoomView["draftChoices"]={};
  if(obj(p.draftChoices)){
   for(const [agent,value] of Object.entries(p.draftChoices).slice(0,12)){
    if(!/^[a-z0-9-]{1,50}$/.test(agent)||!obj(value))continue;
    if(typeof value.selected!=="boolean" || !validWord(value.session)||!validText(value.functions,1500))continue;
    drafts[agent]={selected:value.selected,session:value.session,functions:value.functions};
   }
  }
  const pref=obj(p.focusPreference)?p.focusPreference:{};
  return {
   version:1,runId,mode,
   historyOpen:p.historyOpen===true,detailsOpen:p.detailsOpen===true,
   operatorSection:p.operatorSection==="team"||p.operatorSection==="conversation"||
     p.operatorSection==="history"?p.operatorSection:p.historyOpen===true?"history":"team",
   operatorObjective:validText(p.operatorObjective)?p.operatorObjective:"",
   operatorSuccessCriterion:validText(p.operatorSuccessCriterion)?p.operatorSuccessCriterion:"",
   draftChoices:drafts,
   focusPreference:{
    role:validWord(pref.role)?pref.role:null,
    sequence:typeof pref.sequence==="number"&&Number.isSafeInteger(pref.sequence)&&pref.sequence>=0?pref.sequence:null,
   },
  };
 }catch{return null}
}

export function parseShellView(raw:string|null):StoredShellView|null {
 if(!raw||raw.length>2000)return null;
 try{
  const p:unknown=JSON.parse(raw);
  if(!obj(p)||p.version!==1)return null;
  return {
   version:1,
   visualSlotOffset:typeof p.visualSlotOffset==="number"&&Number.isInteger(p.visualSlotOffset)&&
    p.visualSlotOffset>=0&&p.visualSlotOffset<=5?p.visualSlotOffset:0,
   focusedId:validWord(p.focusedId)?p.focusedId:null,
   readingSurface:p.readingSurface==="per-agent"||p.readingSurface==="full"?p.readingSurface:"live",
  };
 }catch{return null}
}

/** Canonical ACF index, not localStorage, determines whether a saved run exists. */
export function verifySavedRun(runId:string, runIds:readonly string[], selectedId:string|null):
 "VERIFIED"|"MISSING"|"MISMATCH" {
 if(!validRun(runId)||!runIds.includes(runId))return "MISSING";
 return selectedId===runId?"VERIFIED":"MISMATCH";
}
