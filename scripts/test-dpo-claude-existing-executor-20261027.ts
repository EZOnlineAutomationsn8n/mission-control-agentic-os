import assert from "node:assert/strict";
import {test} from "node:test";
import {isExistingSharedClaudeBinding,sharedClaudeOwnerUrl,
  canSendToExistingClaudeOwner,existingClaudeOwnerGet,existingClaudeOwnerAsk,
  WORKPLACE_CLAUDE_KEY} from "../src/lib/claude-code/werkplaats-existing-executor";
test("only the original Claude workplace session is shared in AGENTS MODE",()=>{
  const a=process.env.MC_PREVIEW,b=process.env.GAOS_STAGE_NATIVE_ISOLATED;
  try{
    process.env.MC_PREVIEW="1";delete process.env.GAOS_STAGE_NATIVE_ISOLATED;
    assert.equal(isExistingSharedClaudeBinding(WORKPLACE_CLAUDE_KEY),true);
    for(const other of ["operator-default","acf-dlg-proof-claude","acf-werkplaats-claude-code-recovery-01"])
      assert.equal(isExistingSharedClaudeBinding(other),false);
    process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
    assert.equal(isExistingSharedClaudeBinding(WORKPLACE_CLAUDE_KEY),false);
    delete process.env.GAOS_STAGE_NATIVE_ISOLATED;delete process.env.MC_PREVIEW;
    assert.equal(isExistingSharedClaudeBinding(WORKPLACE_CLAUDE_KEY),false);
  }finally{if(a===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=a;
    if(b===undefined)delete process.env.GAOS_STAGE_NATIVE_ISOLATED;else process.env.GAOS_STAGE_NATIVE_ISOLATED=b;}
});
test("session and history route share exactly the ACF executor; no new registry",()=>{
  assert.match(sharedClaudeOwnerUrl("session"),/shared-agentic-sandbox:3330\/api\/connectors\/claude-code\/session/);
  assert.match(sharedClaudeOwnerUrl("history"),/shared-agentic-sandbox:3330\/api\/agent-conversations\/claude-code\/acf-werkplaats-claude-code/);
});
test("never allow ERROR, PREPARED, stopped or unrelated key to dispatch",()=>{
  for(const status of ["error","prepared","stopped","running","starting"]){
    assert.equal(canSendToExistingClaudeOwner({sessionKey:WORKPLACE_CLAUDE_KEY,status,active:true},true),false);
  }
  assert.equal(canSendToExistingClaudeOwner({sessionKey:WORKPLACE_CLAUDE_KEY,status:"idle",active:false},true),false);
  assert.equal(canSendToExistingClaudeOwner({sessionKey:"operator-default",status:"idle",active:true},true),false);
  assert.equal(canSendToExistingClaudeOwner({sessionKey:WORKPLACE_CLAUDE_KEY,status:"idle",active:true},false),false);
  assert.equal(canSendToExistingClaudeOwner({sessionKey:WORKPLACE_CLAUDE_KEY,status:"idle",active:true},true),true);
});
test("existing executor GET reads native owner and never changes session",async()=>{
  const orig=globalThis.fetch;
  const requests:Array<{url:string;method:string}>=[];
  globalThis.fetch=(async(input:RequestInfo|URL, init?:RequestInit)=>{
    requests.push({url:String(input),method:init?.method??"GET"});
    return Response.json({session:{sessionKey:WORKPLACE_CLAUDE_KEY,status:"error",active:false}});
  }) as typeof fetch;
  try{const res=await existingClaudeOwnerGet("session");assert.equal(res.status,200);
    assert.equal((await res.json()).session.status,"error");
    assert.deepEqual(requests.map(x=>x.method),["GET"]);
  }finally{globalThis.fetch=orig;}
});
test("ERROR cannot dispatch a model call even when operator sends a prompt",async()=>{
  const orig=globalThis.fetch;const methods:string[]=[];
  globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{
    methods.push(init?.method??"GET");return Response.json({session:{
      sessionKey:WORKPLACE_CLAUDE_KEY,status:"error",active:false,
    }});
  }) as typeof fetch;
  try{const res=await existingClaudeOwnerAsk(JSON.stringify({sessionId:WORKPLACE_CLAUDE_KEY,prompt:"diagnostic"}));
    assert.equal(res.status,409);assert.deepEqual(methods,["GET","GET"]);
  }finally{globalThis.fetch=orig;}
});
test("one ready native request goes to existing executor once, no synthetic retries",async()=>{
  const orig=globalThis.fetch;let askCalls=0;
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    if(String(input).endsWith("/actions/ask")){askCalls++;return Response.json({status:"completed",text:"synthetic offline fixture"});}
    if(String(input).endsWith("/roster"))return Response.json({agents:[{
      agent_id:"claude-code",can_join_now:true,suggested_session:WORKPLACE_CLAUDE_KEY
    }]});
    return Response.json({session:{sessionKey:WORKPLACE_CLAUDE_KEY,status:"idle",active:true}});
  }) as typeof fetch;
  try{const res=await existingClaudeOwnerAsk(JSON.stringify({sessionId:WORKPLACE_CLAUDE_KEY,prompt:"offline test"}));
    assert.equal(res.status,200);assert.equal(askCalls,1);
  }finally{globalThis.fetch=orig;}
});
