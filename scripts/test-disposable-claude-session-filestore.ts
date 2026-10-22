import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const dir=await mkdtemp(path.join(os.tmpdir(),"mc-claude-fixture-isolated-"));
const previous=process.env.CLAUDE_CODE_SESSION_DATA_DIR;
const db=process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
process.env.CLAUDE_CODE_SESSION_DATA_DIR=dir;
const {createClaudeCodeSession,readClaudeCodeSession,stopClaudeCodeSession}=await import("../src/lib/claude-code/session-store");
test.after(async()=>{if(previous===undefined)delete process.env.CLAUDE_CODE_SESSION_DATA_DIR;else process.env.CLAUDE_CODE_SESSION_DATA_DIR=previous;if(db!==undefined)process.env.DATABASE_URL=db;await rm(dir,{recursive:true,force:true})});
test("isolated JSON: creation binds fixture identity, stop retains record, historic record preserved",async()=>{
const historic=await createClaudeCodeSession("historical-preserve");
const fixture=await createClaudeCodeSession("fixture-exact",{originatingOrderId:"MC-DISPOSABLE-CLAUDE-SESSION-CLEANUP-001",fixtureId:"isolated-fixture-1",owner:"DENNIS",project:"MISSION_CONTROL_AGENTIC_OS"});
assert.equal(fixture.disposableFixture?.nativeSessionId,fixture.claudeSessionId);
assert.equal(fixture.disposableFixture?.createdAt,fixture.createdAt);
assert.equal((await readClaudeCodeSession("fixture-exact"))?.disposableFixture?.fixtureId,"isolated-fixture-1");
const stopped=await stopClaudeCodeSession("fixture-exact");
assert.equal(stopped?.active,false);assert.equal(stopped?.status,"stopped");
assert.equal((await readClaudeCodeSession("historical-preserve"))?.claudeSessionId,historic.claudeSessionId);
assert.equal((await readClaudeCodeSession("historical-preserve"))?.disposableFixture,undefined);
await assert.rejects(()=>createClaudeCodeSession("fixture-exact",{originatingOrderId:"MC-DISPOSABLE-CLAUDE-SESSION-CLEANUP-001",fixtureId:"different",owner:"DENNIS",project:"MISSION_CONTROL_AGENTIC_OS"}));
const data=JSON.parse(await readFile(path.join(dir,"claude-code-sessions.json"),"utf8"));
assert.deepEqual(Object.keys(data).sort(),["fixture-exact","historical-preserve"]);
});

test("isolated JSON rejects two concurrent creations for the same fixture key",async()=>{
const fixture={originatingOrderId:"MC-DISPOSABLE-CLAUDE-SESSION-CLEANUP-001",fixtureId:"conflict",owner:"DENNIS" as const,project:"MISSION_CONTROL_AGENTIC_OS" as const};
const attempts=await Promise.allSettled([createClaudeCodeSession("concurrent-1",fixture),createClaudeCodeSession("concurrent-1",fixture)]);
assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);
assert.equal(attempts.filter(x=>x.status==="rejected").length,1);
assert.equal((await readClaudeCodeSession("concurrent-1"))?.disposableFixture?.fixtureId,"conflict");
});
