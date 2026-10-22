import test from "node:test";
import assert from "node:assert/strict";
import { authorizeDisposableClaudeCleanup, type DisposableFixtureOwnership } from "../src/lib/claude-code/disposable-fixture-cleanup";
import type { ClaudeCodeSession } from "../src/lib/claude-code/session-store";
const owner: DisposableFixtureOwnership = { kind:"mission-control-claude-disposable-cert-v1", owner:"DENNIS", project:"MISSION_CONTROL_AGENTIC_OS", originatingOrderId:"MC-SDK-FIXTURE-TEST-001", fixtureId:"fixture-dummy-123", sessionKey:"disposable-cert-dummy", nativeSessionId:"00000000-0000-4000-8000-000000000111",createdAt:"2026-10-11T00:00:00.000Z" };
const session: ClaudeCodeSession & {disposableFixture?:DisposableFixtureOwnership}={sessionKey:owner.sessionKey,claudeSessionId:owner.nativeSessionId,displayName:"test",workspace:"/tmp",permissionMode:"plan",executionMode:"on-demand-cli",status:"stopped",active:false,createdAt:owner.createdAt,updatedAt:owner.createdAt,lastError:null,disposableFixture:owner};
const request={ownership:owner,sessionKey:owner.sessionKey,nativeSessionId:owner.nativeSessionId,originatingOrderId:owner.originatingOrderId,fixtureId:owner.fixtureId,owner:owner.owner};
const baseline: Parameters<typeof authorizeDisposableClaudeCleanup>[0]={session,request,storageVerified:true,noInFlightWorkVerified:true,auditReady:true,nativeTranscriptPreservationVerified:true};
const verdict=(input:Partial<typeof baseline>={})=>authorizeDisposableClaudeCleanup({...baseline,...input});
test("registered exact stopped disposable fixture may be retained with audit",()=>assert.equal(verdict().allowed,true));
test("historic and non-fixture records are denied",()=>{assert.equal(verdict({session:{...session,disposableFixture:undefined}}).allowed,false);assert.equal(verdict({session:null}).allowed,false)});
test("mismatched fixture or owner/order denied",()=>{assert.equal(verdict({request:{...request,fixtureId:"other"}}).allowed,false);assert.equal(verdict({request:{...request,originatingOrderId:"other"}}).allowed,false);assert.equal(verdict({session:{...session,disposableFixture:{...owner,owner:"DENNIS",project:"OTHER" as "MISSION_CONTROL_AGENTIC_OS"}}}).allowed,false)});
test("native and logical ID mismatch denied",()=>{assert.equal(verdict({request:{...request,nativeSessionId:"other"}}).allowed,false);assert.equal(verdict({session:{...session,sessionKey:"other"}}).allowed,false)});
test("active, running, idle and unknown inflight denied",()=>{for(const status of ["running","starting","idle"] as const)assert.equal(verdict({session:{...session,status}}).allowed,false);assert.equal(verdict({session:{...session,active:true}}).allowed,false);assert.equal(verdict({noInFlightWorkVerified:false}).allowed,false)});
test("unknown storage, unavailable audit, native preservation unverified denied",()=>{assert.equal(verdict({storageVerified:false}).allowed,false);assert.equal(verdict({auditReady:false}).allowed,false);assert.equal(verdict({nativeTranscriptPreservationVerified:false}).allowed,false)});
test("altered durable creation provenance denied",()=>assert.equal(verdict({session:{...session,createdAt:"different"}}).allowed,false));

test("failed bootstrap in error state must be explicitly stopped before cleanup certification",()=>assert.deepEqual(verdict({session:{...session,status:"error"}}),{allowed:false,reason:"NOT_VERIFIED_STOPPED"}));
