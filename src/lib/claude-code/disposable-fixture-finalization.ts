/** Internal-only conservative finalization. A completion witness must come from
 * the supervised execution lifecycle, never from a client-supplied status flag.
 * This function does not stop, delete, or inspect processes by itself. */
import type { ClaudeCodeSession } from './session-store';
import { authorizeDisposableClaudeCleanup, type FixtureCleanupRequest } from './disposable-fixture-cleanup';
export interface NativeExecutionWitness {
  sessionKey: string;
  nativeSessionId: string;
  executionId: string;
  observedChildPid: number;
  childCloseObserved: boolean;
  childExitCode: number | null;
  childSignal: string | null;
  descendantsTerminatedVerified: boolean;
  noOtherExecutionVerified: boolean;
  observerEpoch: string;
  source: 'supervised-native-child-lifecycle';
}
export async function finalizeDisposableFixture(input: {
  session: ClaudeCodeSession | null;
  request: FixtureCleanupRequest;
  witness: NativeExecutionWitness | null;
  persistentlyReread: () => Promise<ClaudeCodeSession | null>;
  appendAudit: (correlationId: string, summary: string) => Promise<{ ok: boolean; inserted?: boolean }>;
  verifyRetainedTranscript: (nativeId: string) => Promise<boolean>;
}): Promise<{ certified: boolean; reason: string }> {
  const { session, request, witness } = input;
  if (!session || !witness || witness.source !== 'supervised-native-child-lifecycle' ||
      witness.sessionKey !== request.sessionKey || witness.nativeSessionId !== request.nativeSessionId ||
      !witness.executionId || !witness.observerEpoch || !Number.isSafeInteger(witness.observedChildPid) || witness.observedChildPid < 1 ||
      !witness.childCloseObserved || !witness.descendantsTerminatedVerified || !witness.noOtherExecutionVerified ||
      (witness.childExitCode === null && witness.childSignal === null))
    return {certified:false, reason:'NATIVE_EXECUTION_COMPLETION_UNVERIFIED'};
  const reread = await input.persistentlyReread().catch(() => null);
  if (!reread || reread.updatedAt !== session.updatedAt || reread.createdAt !== session.createdAt ||
      reread.claudeSessionId !== session.claudeSessionId || reread.status !== 'stopped' || reread.active)
    return {certified:false,reason:'STALE_OR_UNSTOPPED_STORAGE'};
  const transcriptRetained = await input.verifyRetainedTranscript(request.nativeSessionId).catch(() => false);
  const decision = authorizeDisposableClaudeCleanup({session:reread,request,storageVerified:true,
    noInFlightWorkVerified:true,auditReady:true,nativeTranscriptPreservationVerified:transcriptRetained});
  if (!decision.allowed) return {certified:false,reason:decision.reason};
  const correlationId = [request.originatingOrderId,request.fixtureId,witness.executionId].join(':');
  const audit = await input.appendAudit(correlationId, `retained stopped fixture ${request.sessionKey}/${request.nativeSessionId}`).catch((): {ok:boolean;inserted?:boolean} => ({ok:false}));
  if (!audit.ok || audit.inserted !== true) return {certified:false,reason:'AUDIT_NOT_DURABLY_INSERTED'};
  const finalRead = await input.persistentlyReread().catch(()=>null);
  if (!finalRead || finalRead.updatedAt !== reread.updatedAt || finalRead.status !== 'stopped' || finalRead.active || finalRead.claudeSessionId !== request.nativeSessionId)
    return {certified:false,reason:'POST_AUDIT_STORAGE_CONFLICT'};
  return {certified:true,reason:'RETAINED_STOPPED_FIXTURE_AUDITED'};
}
