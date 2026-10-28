/** R2: existing owner only, no bootstrap or UUID replacement. */
export const CLAUDE_R2_KEY = "acf-werkplaats-claude-code" as const;
export type RecoverExistingRow = {
 sessionKey:string;claudeSessionId:string;status:string;active:boolean;
 lastError:string|null;updatedAt:string;
 historyLastError?:string|null;recoveryHold?:boolean;
};
export function validateClaudeRecoverExisting(row:RecoverExistingRow|null,key:string,uuid:string):string|null{
 if(key!==CLAUDE_R2_KEY)return "RECOVERY_KEY_NOT_ALLOWED";
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid))
  return "RECOVERY_UUID_INVALID";
 if(!row)return "RECOVERY_SESSION_NOT_FOUND";
 if(row.sessionKey!==key||row.claudeSessionId!==uuid)return "RECOVERY_NATIVE_UUID_MISMATCH";
 if(row.status!=="error"||row.active!==false)return "RECOVERY_STATUS_MISMATCH";
 if(typeof row.lastError!=="string"||!row.lastError.trim())return "RECOVERY_HISTORICAL_ERROR_REQUIRED";
 if(row.historyLastError!==undefined&&row.historyLastError!==null)return "RECOVERY_HISTORY_ALREADY_PRESENT";
 if(row.recoveryHold!==undefined)return "RECOVERY_ALREADY_PROCESSED";
 if(!row.updatedAt)return "RECOVERY_TIMESTAMP_MISSING";
 return null;
}
export type RecoveryHistoryEntry={status?:string;agentSessionId?:string|null;sessionId?:string;agentId?:string};
export function validateNativePendingTurns(entries:readonly RecoveryHistoryEntry[],key:string,uuid:string,complete:boolean):string|null{
 if(!complete||entries.length>=200)return "RECOVERY_HISTORY_NOT_EXHAUSTIVE";
 for(const e of entries){
  if(e.agentId!=="claude-code"||e.sessionId!==key)return "RECOVERY_HISTORY_WRONG_OWNER";
  if(e.agentSessionId&&e.agentSessionId!==uuid)return "RECOVERY_HISTORY_FOREIGN_UUID";
  if(e.status==="action_required"||e.status==="timeout")return "RECOVERY_PENDING_OR_UNCERTAIN_TURN";
  if(!["completed","failed"].includes(e.status??""))return "RECOVERY_UNKNOWN_TURN_OUTCOME";
 }
 return null;
}
export function recoveredClaudeState<T extends RecoverExistingRow>(row:T,now:string):T{
 return {...row,status:"prepared",active:true,lastError:null,
  historyLastError:row.lastError,recoveryHold:true,updatedAt:now};
}
