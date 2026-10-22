import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ClaudeCodeSession } from './session-store';
import type { NativeExecutionWitness } from './disposable-fixture-finalization';

/** Development-only supervised child. A close event is NOT descendant-proof. */
const inFlight = new Map<string,string>();
const completed = new Map<string,NativeExecutionWitness>();
export function readObservedFixtureWitness(sessionKey:string): NativeExecutionWitness|null { return completed.get(sessionKey) ?? null; }
export async function observeDisposableClaudeChild(options:{session:ClaudeCodeSession; command:string; args:string[]; cwd:string; env:NodeJS.ProcessEnv; timeoutMs:number; maxBytes:number}) {
  const session=options.session;
  if (!session.disposableFixture || session.disposableFixture.nativeSessionId!==session.claudeSessionId) throw new Error('FIXTURE_PROVENANCE_MISSING');
  if (inFlight.has(session.sessionKey)) throw new Error('FIXTURE_EXECUTION_ALREADY_IN_FLIGHT');
  const executionId=randomUUID(), observerEpoch=randomUUID();
  completed.delete(session.sessionKey);
  inFlight.set(session.sessionKey,executionId);
  const child=spawn(options.command,options.args,{cwd:options.cwd,env:options.env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',size=0,overflow=false,timedOut=false,closeObserved=false,exitCode:number|null=null,signal:string|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let escalation:ReturnType<typeof setTimeout>|undefined;
  let forceBoundary:ReturnType<typeof setTimeout>|undefined;
  try {
    const outcome=await new Promise<void>((resolve,reject)=>{
      child.stdout?.on('data',(b:Buffer)=>{size+=b.length;if(size>options.maxBytes){overflow=true;child.kill('SIGTERM'); escalation ??= setTimeout(()=>child.kill('SIGKILL'),1000)}else stdout+=b.toString('utf8')});
      child.stderr?.on('data',(b:Buffer)=>{size+=b.length;if(size>options.maxBytes){overflow=true;child.kill('SIGTERM'); escalation ??= setTimeout(()=>child.kill('SIGKILL'),1000)}else stderr+=b.toString('utf8')});
      child.once('error',reject);
      child.once('close',(code,sig)=>{closeObserved=true;exitCode=code;signal=sig;resolve()});
      timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM'); escalation=setTimeout(()=>child.kill('SIGKILL'),1000);forceBoundary=setTimeout(()=>reject(new Error('CHILD_CLOSE_UNVERIFIED_AFTER_TIMEOUT')),2500)},options.timeoutMs);
    });
    void outcome;
    const witness:NativeExecutionWitness={sessionKey:session.sessionKey,nativeSessionId:session.claudeSessionId,executionId,observerEpoch,observedChildPid:child.pid??0,childCloseObserved:closeObserved,childExitCode:exitCode,childSignal:signal,descendantsTerminatedVerified:false,noOtherExecutionVerified:inFlight.get(session.sessionKey)===executionId,source:'supervised-native-child-lifecycle'};
    completed.set(session.sessionKey,Object.freeze({...witness}));
    return {stdout,stderr,witness,completed:!timedOut&&!overflow&&exitCode===0};
  } finally {if(timer)clearTimeout(timer);if(escalation)clearTimeout(escalation);if(forceBoundary)clearTimeout(forceBoundary);if(closeObserved && inFlight.get(session.sessionKey)===executionId)inFlight.delete(session.sessionKey)}
}
