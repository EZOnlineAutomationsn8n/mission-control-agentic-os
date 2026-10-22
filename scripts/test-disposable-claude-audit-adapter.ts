import test from 'node:test';
import assert from 'node:assert/strict';
import {finalizeObservedDisposableFixture} from '../src/lib/claude-code/disposable-fixture-audit';
import type {FixtureCleanupRequest} from '../src/lib/claude-code/disposable-fixture-cleanup';
import type {NativeExecutionWitness} from '../src/lib/claude-code/disposable-fixture-finalization';
const request:FixtureCleanupRequest={sessionKey:'isolated-test',nativeSessionId:'00000000-0000-4000-8000-000000000555',originatingOrderId:'MC-DISPOSABLE-CLAUDE-SESSION-CLEANUP-001',fixtureId:'isolated',owner:'DENNIS',ownership:{kind:'mission-control-claude-disposable-cert-v1',owner:'DENNIS',project:'MISSION_CONTROL_AGENTIC_OS',originatingOrderId:'MC-DISPOSABLE-CLAUDE-SESSION-CLEANUP-001',fixtureId:'isolated',sessionKey:'isolated-test',nativeSessionId:'00000000-0000-4000-8000-000000000555',createdAt:'2026-10-11T00:00:00Z'}};
const witness:NativeExecutionWitness={sessionKey:request.sessionKey,nativeSessionId:request.nativeSessionId,executionId:'exec-fake',observedChildPid:999,childCloseObserved:true,childExitCode:0,childSignal:null,descendantsTerminatedVerified:false,noOtherExecutionVerified:true,observerEpoch:'test',source:'supervised-native-child-lifecycle'};
test('real audit adapter denies absent or non-descendant-certified native process before any storage access',async()=>{assert.equal((await finalizeObservedDisposableFixture(request)).reason,'NO_TRUSTED_DESCENDANT_TERMINATION_PROOF');assert.equal((await finalizeObservedDisposableFixture(request)).certified,false)});
