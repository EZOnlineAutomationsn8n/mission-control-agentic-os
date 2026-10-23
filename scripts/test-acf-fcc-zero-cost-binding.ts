import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_MODEL_ROUTES } from "../src/lib/connectors/live/fcc-actions";
import { verifyFccFreeBinding,type FreeCostProof } from "../src/lib/acf/fcc-zero-cost-gate";

const clock=new Date("2026-10-24T00:00:00Z");
const zero="0";
const price=(model:string)=>({model,prompt:zero,completion:zero,request:zero,image:zero,
 web_search:zero,internal_reasoning:zero});
const normal=():FreeCostProof=>({
 issuer:"fcc-effective-configuration-and-provider-pricing",checkedAt:"2026-10-23T23:59:00Z",
 expiresAt:"2026-10-24T00:05:00Z",effectiveModel:FALLBACK_MODEL_ROUTES[3],
 effectiveSonnet:FALLBACK_MODEL_ROUTES[10],effectiveOpus:FALLBACK_MODEL_ROUTES[10],
 effectiveHaiku:FALLBACK_MODEL_ROUTES[3],
 effectiveFallbacks:[FALLBACK_MODEL_ROUTES[3],FALLBACK_MODEL_ROUTES[10]],
 modelPricing:[price(FALLBACK_MODEL_ROUTES[3]),price(FALLBACK_MODEL_ROUTES[10])],
 provenance:"offline test fixture only",
});
test("a model suffix ':free' or environment flag without real pricing proof is NOT authorization",()=>{
 for(const model of FALLBACK_MODEL_ROUTES){
  const result=verifyFccFreeBinding(model,null,clock);
  assert.equal(result.ok,false);
  assert.equal(result.code,"FCC_COST_PROOF_MISSING");
 }
});
test("unknown and paid models are fail-closed independent of aliases",()=>{
 const unsafe=["open_router/anthropic/claude-fable-5", "open_router/nvidia/nemotron-3-ultra-550b-a55b","sonnet"];
 for(const route of unsafe) assert.equal(verifyFccFreeBinding(route,normal(),clock).code,"FCC_ROUTE_NOT_OPERATOR_APPROVED");
});
test("all mapped FCC defaults and fallback routes must remain on the operator's exact list",()=>{
 const p=normal();p.effectiveFallbacks.push("open_router/something-paid");
 assert.equal(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[10],p,clock).code,"FCC_ROUTE_NOT_OPERATOR_APPROVED");
});
test("nonzero and unknown prices fail, even for an advertised free-name route",()=>{
 for(const field of ["prompt","completion","request","image","web_search","internal_reasoning"] as const){
  const p=normal();p.modelPricing[0][field]="0.0001";
  assert.equal(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[10],p,clock).code,"FCC_PRICE_NONZERO");
 }
 const q=normal();q.modelPricing[0].completion="";
 assert.equal(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[3],q,clock).code,"FCC_PRICE_NONZERO");
 const r=normal();r.modelPricing=[];
 assert.equal(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[10],r,clock).code,"FCC_PRICE_UNVERIFIED");
});
test("expired, future, longer-than-15-minute snapshots fail",()=>{
 for(const p of [
  {...normal(),expiresAt:"2026-10-23T23:59:59Z"},
  {...normal(),checkedAt:"2026-10-24T00:01:00Z"},
  {...normal(),expiresAt:"2026-10-24T01:00:00Z"},
 ]){
  assert.equal(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[10],p,clock).code,"FCC_PROOF_EXPIRED");
 }
});
test("canonical SDK model alias maps to the exact EFFECTIVE configured FCC operator route",()=>{
 const p=normal();
 assert.deepEqual(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[10],p,clock),
  {ok:true,code:"ZERO_COST_PROVEN",sdkModel:"sonnet",resolvedOperatorRoute:11});
 assert.deepEqual(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[3],p,clock),
  {ok:true,code:"ZERO_COST_PROVEN",sdkModel:"haiku",resolvedOperatorRoute:4});
 assert.equal(verifyFccFreeBinding(FALLBACK_MODEL_ROUTES[0],p,clock).code,"FCC_ALIAS_ROUTE_MISMATCH");
});
test("operator's twelve ordered fallback routes are neither changed nor auto-completed",()=>{
 assert.equal(FALLBACK_MODEL_ROUTES.length,12);
 assert.equal(FALLBACK_MODEL_ROUTES[0],"open_router/poolside/laguna-xs-2.1:free");
 assert.equal(FALLBACK_MODEL_ROUTES.at(-1),"open_router/openrouter/free");
});
