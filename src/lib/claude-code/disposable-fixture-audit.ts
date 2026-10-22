/** Internal-only audit adapter. Not exposed as an HTTP action. */
import { appendAuditEvent } from '../audit-log-store';
import { readClaudeCodeSession } from './session-store';
import { finalizeDisposableFixture } from './disposable-fixture-finalization';
import type { FixtureCleanupRequest } from './disposable-fixture-cleanup';
import { readObservedFixtureWitness } from './disposable-fixture-child-observer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export async function finalizeObservedDisposableFixture(request: FixtureCleanupRequest) {
  const witness=readObservedFixtureWitness(request.sessionKey);
  // Refuse forged assertions. Currently no trusted descendant supervisor can
  // certify descendantsTerminatedVerified, so this entry remains fail-closed.
  if (!witness || !witness.descendantsTerminatedVerified) return {certified:false,reason:'NO_TRUSTED_DESCENDANT_TERMINATION_PROOF'};
  const session = await readClaudeCodeSession(request.sessionKey);
  return finalizeDisposableFixture({
    session, request, witness,
    persistentlyReread:()=>readClaudeCodeSession(request.sessionKey),
    verifyRetainedTranscript:async (nativeId)=>{
      if (!/^[0-9a-f-]{36}$/i.test(nativeId)) return false;
      const base=path.join(os.homedir(),'.claude','projects');
      const dirs=await fs.readdir(base,{withFileTypes:true}).catch(()=>[]);
      for(const dir of dirs){if(!dir.isDirectory())continue;const location=path.join(base,dir.name,`${nativeId}.jsonl`);const st=await fs.stat(location).catch(()=>null);if(st?.isFile())return true}
      return false;
    },
    appendAudit:(correlationId,summary)=>appendAuditEvent({timestamp:new Date().toISOString(),connectorId:'claude-code',actionType:'disposable-fixture-finalization',status:'completed',resultSummary:summary,correlationId,actor:'operator',source:'claude-code/disposable-fixture-audit.ts'}),
  });
}
