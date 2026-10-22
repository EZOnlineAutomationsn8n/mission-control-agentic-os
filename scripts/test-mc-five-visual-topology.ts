import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {COCKPIT_AGENT_TARGETS} from "../src/lib/cockpit/agent-registry";
const source=readFileSync("src/components/team-room/TeamRoomView.tsx","utf8");
const stylesheet=readFileSync("src/app/globals.css","utf8");
test("primary five-card surface exists outside and before the 3x2 selection+conversation",()=>{
 const stage=source.indexOf('data-testid="original-five-card-room"');
 const selection=source.indexOf('className="acf-shell-layout"');
 assert.ok(stage>0 && stage<selection);
 assert.ok(!source.includes('className="mc-team-confirmed-details"'));
 assert.ok(source.includes('data-testid="acf-shared-conversation"'));
 assert.ok(source.includes('mc-team-original-five'));
});
test("four surrounding windows on six registry agents are presentation state, not ACF membership",()=>{
 assert.equal(COCKPIT_AGENT_TARGETS.length,6);
 assert.ok(source.includes('Array.from({length:Math.min(4,SHELL_AGENTS.length)}'));
 assert.ok(source.includes('onClick={()=>{setPreviewPlaying(false);setVisualSlotOffset'));
 assert.ok(source.includes('membershipKind={member?.kind==="DRAFT" ? "DRAFT" : "SHELL"}'));
 assert.ok(source.includes('runCard={runCard}'));
});
test("center focus exists by default, changes via visible agent focus button, without agent turns",()=>{
 assert.ok(source.includes('focusedId ?? speakerKey ?? visualSlots[0]?.id'));
 assert.ok(source.includes('data-testid={"shell-focus-pill-"+agent.id}'));
 assert.ok(source.includes('onFocus={()=>focusAgent(agent.id)}'));
 assert.ok(source.includes('className={"acf-shell-focus-card"'));
});
test("restored focus overlay scoped only to original visual stage",()=>{
 assert.ok(stylesheet.includes('.acf-shell .mc-team-visual-canvas > .acf-shell-focus-overlay'));
 assert.ok(stylesheet.includes('grid-template-columns: repeat(2,minmax(0,1fr))'));
 assert.ok(stylesheet.includes('.acf-shell .mc-team-composer-agent-grid'));
 assert.ok(stylesheet.includes('.acf-shell .mc-team-shared-conversation'));
});
