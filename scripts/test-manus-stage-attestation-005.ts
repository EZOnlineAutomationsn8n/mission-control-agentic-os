import {test} from "node:test";
import assert from "node:assert/strict";
import {fingerprintManusStageKey,verifyAttestation,stageManusAuthPath} from "../src/lib/connectors/live/manus-stage-auth";

const originalPreview=process.env.MC_PREVIEW;
const originalHome=process.env.CLI_AGENT_SESSION_DATA_DIR;
const A="unit-test-api-key-AAAAAAAAA-not-a-provider-credential";
const B="unit-test-api-key-BBBBBBBBB-not-a-provider-credential";
const now=Date.parse("2026-10-24T02:00:00.000Z");
const record={version:1 as const,verifiedAt:new Date(now-3000).toISOString(),keyFingerprint:fingerprintManusStageKey(A)};
test("attestation binds to the exact validated key without storing cleartext",()=>{
 assert.equal(verifyAttestation(record,A,now),record.verifiedAt);
 assert.equal(verifyAttestation(record,B,now),null);
 assert.equal(JSON.stringify(record).includes(A),false);
});
test("negative and malformed verification evidence is rejected",()=>{
 assert.equal(verifyAttestation(null,A,now),null);
 assert.equal(verifyAttestation({version:2,verifiedAt:record.verifiedAt,keyFingerprint:record.keyFingerprint},A,now),null);
 assert.equal(verifyAttestation({...record,keyFingerprint:"invalid"},A,now),null);
 assert.equal(verifyAttestation({...record,verifiedAt:"not-a-date"},A,now),null);
});
test("expired / future verification cannot claim current connection",()=>{
 assert.equal(verifyAttestation({...record,verifiedAt:new Date(now-24*60*60*1000-1).toISOString()},A,now),null);
 assert.equal(verifyAttestation({...record,verifiedAt:new Date(now+1000).toISOString()},A,now),null);
});
test("stage auth record has no production fallback path",()=>{
 process.env.MC_PREVIEW="0";
 assert.equal(stageManusAuthPath(),null);
 process.env.MC_PREVIEW="1";process.env.CLI_AGENT_SESSION_DATA_DIR="/workspace/projects/mission-control/data";
 assert.equal(stageManusAuthPath(),null);
 process.env.CLI_AGENT_SESSION_DATA_DIR="/workspace/projects/mission-control/.stage-achtergrond/data";
 assert.equal(stageManusAuthPath(),"/workspace/projects/mission-control/.stage-achtergrond/data/secrets/manus-stage-last-verified.json");
});
test("restore test environment",()=>{
 if(originalPreview===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=originalPreview;
 if(originalHome===undefined)delete process.env.CLI_AGENT_SESSION_DATA_DIR;else process.env.CLI_AGENT_SESSION_DATA_DIR=originalHome;
});
