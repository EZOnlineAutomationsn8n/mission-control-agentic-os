import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import fs from "node:fs";
const stage=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const project=path.dirname(stage);
const generator=path.join(stage,"scripts/werkplaats/werkplaats-routes.py");
const read=(p:string)=>fs.readFileSync(p,"utf8");
test("one canonical repository, two deployment environments, no source clone",()=>{
 assert.ok(fs.existsSync(path.join(project,".git")));
 assert.ok(fs.existsSync(path.join(stage,".git")));
 assert.ok(read(path.join(stage,"scripts/werkplaats/toon.sh")).includes("mc-preview-start .stage-$NAME native-stage"));
 assert.ok(!read(path.join(stage,"scripts/werkplaats/toon.sh")).includes('mc-preview-start .stage-$NAME agents"'));
});
test("isolated six-seat routes generated from SAFE stage fixture, never LIVE",async()=>{
 const dir=await mkdtemp(path.join(project,".stage-route-test-010-"));
 const dest=path.join(dir,".preview-acf-home","participant_routes.json");
 try{
  execFileSync("python3",[generator,dest],{timeout:10000});
  const value=JSON.parse(await readFile(dest,"utf8")) as {
    routes:Record<string,{base_url:string;ask_path:string;session_path:string}>;
    session_index:{base_url:string};session_ref_pattern:string;
  };
  assert.deepEqual(Object.keys(value.routes).sort(),["agy","claude-code","codex","gemini","hermes","openclaw"]);
  assert.equal(value.session_index.base_url,"http://127.0.0.1:3331");
  assert.ok(value.session_ref_pattern.startsWith("^acf-werkplaats-"));
  for(const [id,route] of Object.entries(value.routes)){
   assert.equal(route.base_url,"http://127.0.0.1:3331");
   assert.equal(route.ask_path,"/api/connectors/"+id+"/actions/ask");
   assert.equal(route.session_path,"/api/connectors/"+id+"/session");
  }
  assert.throws(()=>execFileSync("python3",[generator,dest],{timeout:10000,stdio:"pipe"}));
  assert.ok(!read(generator).includes('LIVE = "/workspace/projects/agentic-collaboration-fabric'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("live and stage roster show server provenance, not session inference",()=>{
 const api=read(path.join(stage,"src/app/api/acf/team-room/roster/route.ts"));
 const ui=read(path.join(stage,"src/components/team-room/RosterTeamComposer.tsx"));
 assert.ok(api.includes('process.env.MC_PREVIEW==="1"?"WERKPLAATS":"LIVE"'));
 assert.ok(api.includes("STAGE_OWN_SESSION_REGISTRY"));
 assert.ok(ui.includes('data-testid={"roster-provenance-"+a.agent_id}'));
 assert.ok(ui.includes('roster?.environment==="LIVE"'));
});
test("release helper accounts for owner moving .next and requires build provenance",()=>{
 const build=read(path.join(stage,"scripts/werkplaats/bouw.sh"));
 const post=read(path.join(stage,"scripts/werkplaats/na-live.sh"));
 assert.ok(build.includes('.werkplaats-release-source/SOURCE_COMMIT'));
 assert.ok(build.includes('git -C "$STAGE" diff --quiet HEAD'));
 assert.ok(post.includes('DENNIS_RELEASE_GO_CONFIRMED'));
 assert.ok(post.includes('EXPECTED_SOURCE'));
 assert.ok(post.includes('ACTUAL="$(cat "$ROOT/.next/BUILD_ID")"'));
 assert.ok(!post.includes('[[ -s "$STAGE/.next/BUILD_ID" ]] ||'));
});

test("promotable artifact excludes environment state and secret paths",()=>{
 const config=read(path.join(stage,"next.config.ts"));
 for(const dir of ["./data/**/*","./.preview-acf-home/**/*","./.preview-native-home/**/*","./.preview-ops/**/*","./.preview-omi/**/*","./theme/**/*"])
  assert.ok(config.includes(dir),"missing trace exclusion: "+dir);
 for(const m of ["stage-native-free-gate.ts","stage-native-secret.ts"]){
  const content=read(path.join(stage,"src/lib/cli-agents",m));
  assert.ok(content.includes("/* turbopackIgnore: true */"),"runtime profile reads must not be traced: "+m);
 }
});

test("Next instrumentation file-trace sanitizer operates only on isolated stage manifests",()=>{
 const build=read(path.join(stage,"scripts/werkplaats/bouw.sh"));
 const cleaner=read(path.join(stage,"scripts/werkplaats/sanitize-private-traces.py"));
 assert.ok(build.includes('python3 scripts/werkplaats/sanitize-private-traces.py "$STAGE"'));
 for(const d of ["data",".preview-native-home",".preview-acf-home",".werkplaats-release-source"])
   assert.ok(cleaner.includes('"'+d+'"'));
 assert.ok(cleaner.includes("INCOMPLETE_STAGE_BUILD"));
 assert.ok(cleaner.includes("UNSAFE_STAGE_TRACE_STILL_PRESENT"));
});

test("free panes do not dispatch conversation bootstrap fetches until shared session registry is confirmed",()=>{
 const source=read(path.join(stage,"src/components/control-room/TerminalWorkspace.tsx"));
 assert.ok(source.includes("sessionRegistryLoaded"));
 assert.ok(source.includes("setSessionRegistryLoaded(true)"));
 assert.ok(source.includes("sessionRegistryLoaded\n                  ? <TerminalSurface"));
 assert.ok(source.includes("pane-registry-loading-"));
 assert.ok(source.includes("startBoundedPoll"));
 assert.ok(!source.includes("window.location.reload()"));
});

test("cold-browser registry has bounded extended wait ahead of four pane transports",()=>{
 const source=read(path.join(stage,"src/components/control-room/TerminalWorkspace.tsx"));
 assert.ok(source.includes('"/api/cockpit/sessions", { signal, timeoutMs: 28_000 }'));
 assert.ok(source.includes('intervalMs: 5_000, timeoutMs: 30_000'));
 assert.ok(source.includes("setSessionRegistryLoaded(true)"));
});

test("persisted sessions appear before optional runtime-truth diagnostics",()=>{
 const content=read(path.join(stage,"src/components/control-room/AgentConversationPanel.tsx"));
 assert.ok(content.includes("setSession(data.session ?? null);"));
 assert.ok(content.indexOf("setSession(data.session ?? null);")<content.indexOf('fetch("/api/cockpit/runtime-truth"'));
 assert.ok(content.includes('data.session.status === "prepared"'));
 assert.ok(content.includes("loadEpoch.current"));
 assert.ok(content.includes("isCurrent()"));
 assert.ok(content.includes("6_000"));
 assert.ok(!content.includes("const [historyResponse, sessionResponse, runtimeResponse] = await Promise.all"));
});
