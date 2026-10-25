import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAcfTeamRoomSnapshot } from "../src/lib/acf/read-adapter";
import { acfProjectRoot, acfStateDir, werkplaatsRuntimeRoot } from "../src/lib/acf/runtime-root";
import { stageManusKeyPath } from "../src/lib/connectors/live/manus-stage-setup";
import { readFirstTurnReadiness } from "../src/lib/acf/first-turn-readiness";

test("Werkplaats root is the current isolated worktree and ignores shared ACF state", () => {
  const old=process.env.MC_PREVIEW;
  process.env.MC_PREVIEW="1";
  try {
    const cwd=path.resolve(process.cwd());
    assert.ok(path.basename(cwd).startsWith(".stage-"));
    assert.equal(werkplaatsRuntimeRoot(),cwd);
    assert.equal(acfProjectRoot(),path.join(cwd,".preview-acf-runtime"));
    assert.equal(acfStateDir(),path.join(cwd,".preview-acf-home"));
  } finally {
    if(old===undefined) delete process.env.MC_PREVIEW; else process.env.MC_PREVIEW=old;
  }
});


test("Werkplaats credential path is bound to this stage data tree only", () => {
  const oldPreview=process.env.MC_PREVIEW;
  const oldData=process.env.CLI_AGENT_SESSION_DATA_DIR;
  process.env.MC_PREVIEW="1";
  process.env.CLI_AGENT_SESSION_DATA_DIR=path.join(process.cwd(),"data");
  try {
    assert.equal(stageManusKeyPath(),path.join(process.cwd(),"data","secrets","manus-stage-api-key"));
    process.env.CLI_AGENT_SESSION_DATA_DIR=path.join(path.dirname(process.cwd()),".stage-achtergrond","data");
    assert.equal(stageManusKeyPath(),null);
  } finally {
    if(oldPreview===undefined) delete process.env.MC_PREVIEW; else process.env.MC_PREVIEW=oldPreview;
    if(oldData===undefined) delete process.env.CLI_AGENT_SESSION_DATA_DIR; else process.env.CLI_AGENT_SESSION_DATA_DIR=oldData;
  }
});

test("Claude PREPARED is not first-turn-ready when the actual stage launcher is disabled", async () => {
  const oldPreview=process.env.MC_PREVIEW;
  const oldIsolation=process.env.GAOS_STAGE_NATIVE_ISOLATED;
  const oldLauncher=process.env.CLAUDE_CODE_LAUNCHER;
  process.env.MC_PREVIEW="1";
  process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
  process.env.CLAUDE_CODE_LAUNCHER="/nonexistent/mc-preview-agents-disabled";
  try {
    const readiness=await readFirstTurnReadiness({
      agentId:"claude-code",sessionId:"acf-werkplaats-claude-code",status:"prepared",active:true,
    });
    assert.equal(readiness?.ready,false);
    assert.equal(readiness?.code,"CLAUDE_STAGE_LAUNCHER_DISABLED");
    assert.equal(readiness?.providerCalls,0);
  } finally {
    if(oldPreview===undefined) delete process.env.MC_PREVIEW; else process.env.MC_PREVIEW=oldPreview;
    if(oldIsolation===undefined) delete process.env.GAOS_STAGE_NATIVE_ISOLATED; else process.env.GAOS_STAGE_NATIVE_ISOLATED=oldIsolation;
    if(oldLauncher===undefined) delete process.env.CLAUDE_CODE_LAUNCHER; else process.env.CLAUDE_CODE_LAUNCHER=oldLauncher;
  }
});

test("Werkplaats with history but no explicit run opens compose state without probing old run", async () => {
  const old=process.env.MC_PREVIEW;
  process.env.MC_PREVIEW="1";
  const calls:string[][]=[];
  try {
    const snapshot=await readAcfTeamRoomSnapshot({
      projectRoot:"/tmp/acf-source-not-used",
      stateDir:"/tmp/acf-state-not-used",
      runner:async args=>{
        calls.push(args);
        assert.deepEqual(args,["runs"]);
        return JSON.stringify({
          export_version:1,
          runs:[{
            run_id:"RUN-MC-DYNAMIC-VALIDATION-20261019-001",
            goal:"Isolated membership layout proof. Never send model turns.",
            project:"MISSION_CONTROL_AGENTIC_OS",
            status:"PAUSED",
            last_seq:13,
            state_hash:"abc123",
            epoch:1,
            tasks:{},
            orchestrator:"DETERMINISTIC_LOCAL",
          }],
        });
      },
    });
    assert.equal(snapshot.availability,"empty");
    assert.equal(snapshot.selectedRun,null);
    assert.equal(snapshot.noRealTeamRunYet,true);
    assert.equal(snapshot.runs.length,1);
    assert.equal(calls.length,1);
  } finally {
    if(old===undefined) delete process.env.MC_PREVIEW; else process.env.MC_PREVIEW=old;
  }
});

test("Team composer roster is run-independent and recognizes explicit first-turn eligibility", () => {
  const source=fs.readFileSync(path.join(process.cwd(),"src/components/team-room/RosterTeamComposer.tsx"),"utf8");
  assert.ok(source.includes('fetch("/api/acf/team-room/roster"'));
  assert.ok(!source.includes('"/api/acf/team-room/roster"+(runId?'));
  assert.ok(source.includes('s.verdict === "ELIGIBLE_FIRST_TURN"'));
  assert.ok(!source.includes('prepareClaude&&'));
});

test("Historical runs remain explicitly selectable in the Werkplaats UI", () => {
  const source=fs.readFileSync(path.join(process.cwd(),"src/components/team-room/TeamRoomView.tsx"),"utf8");
  assert.ok(source.includes('data-testid="acf-historical-run-selector"'));
  assert.ok(source.includes("Historische runs · alleen openen als je ze bewust wilt bekijken"));
});
