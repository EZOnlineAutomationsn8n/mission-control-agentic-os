import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_MODEL_ROUTES } from "../src/lib/connectors/live/fcc-actions";
import { verifyFccFreeBinding, type FreeCostProof } from "../src/lib/acf/fcc-zero-cost-gate";

const now=new Date("2026-10-24T00:00:00Z");
const r4=FALLBACK_MODEL_ROUTES[3],r11=FALLBACK_MODEL_ROUTES[10];
function quote(route=r11):FreeCostProof{
 const id=route.replace("open_router/","");
 return {issuer:"openrouter-official-model-and-endpoint-catalog",
  checkedAt:"2026-10-23T23:59:00Z",expiresAt:"2026-10-24T00:05:00Z",
  effectiveModel:r4,effectiveSonnet:r11,effectiveHaiku:r4,effectiveOpus:r11,
  effectiveFallbacks:[r4,r11],
  model:{id,pricing:{prompt:"0",completion:"0"},architecture:{modality:"text->text",
    input_modalities:["text"],output_modalities:["text"]}},
  endpoints:[{model_id:id,pricing:{prompt:"0",completion:"0",discount:0},status:0,
    native_tools:{},service_tier:null,provider_name:"Nvidia"}]};
}
test("actual OpenRouter endpoint schema omits 4 optional price fields; do not fill them in",()=>{
 const p=quote();
 assert.deepEqual(Object.keys(p.endpoints[0].pricing).sort(),["completion","discount","prompt"]);
 const v=verifyFccFreeBinding(r11,p,now);
 assert.equal(v.code,"CATALOG_TEXT_PRICE_ZERO");
 assert.equal(v.optionalPricing,"not_applicable_for_text_only_free_endpoint");
 assert.equal(v.resolvedOperatorRoute,11);
 assert.equal(v.sdkModel,"sonnet");
});
test("route 4 maps via haiku and requires an AVAILABLE endpoint",()=>{
 const p=quote(r4);
 assert.equal(verifyFccFreeBinding(r4,p,now).resolvedOperatorRoute,4);
 p.endpoints[0].status=-5;
 assert.equal(verifyFccFreeBinding(r4,p,now).code,"FCC_ENDPOINT_UNAVAILABLE");
});
test("never treat unlisted, paid, or dynamic models as free fallback",()=>{
 for(const id of ["open_router/anthropic/claude-haiku","open_router/openrouter/free","sonnet"]){
  assert.equal(verifyFccFreeBinding(id,quote(),now).code,"FCC_ROUTE_NOT_OPERATOR_APPROVED");
 }
 const p=quote();p.effectiveFallbacks.push("open_router/some-unknown:free");
 assert.equal(verifyFccFreeBinding(r11,p,now).code,"FCC_ROUTE_NOT_OPERATOR_APPROVED");
});
test("absent model or endpoint quote, expiration, or missing trust issuer fail",()=>{
 assert.equal(verifyFccFreeBinding(r11,null,now).code,"FCC_COST_PROOF_MISSING");
 const p=quote();p.issuer="bad" as FreeCostProof["issuer"];
 assert.equal(verifyFccFreeBinding(r11,p,now).code,"FCC_COST_PROOF_MISSING");
 const q=quote();q.expiresAt="2026-10-23T23:59:00Z";
 assert.equal(verifyFccFreeBinding(r11,q,now).code,"FCC_PROOF_EXPIRED");
});
test("any explicit positive auxiliary price is rejected, even on a :free model",()=>{
 for(const field of ["request","image","image_token","audio","input_cache_read",
   "input_cache_write","web_search","internal_reasoning"]){
   const p=quote();p.endpoints[0].pricing[field]="0.00000000000000000001";
   assert.equal(verifyFccFreeBinding(r11,p,now).code,"FCC_PRICE_NONZERO",field);
 }
});
test("unknown pricing fields, conditions and non-zero required token price block",()=>{
 for(const p of [
  {...quote(),model:{...quote().model,pricing:{prompt:"0.0001",completion:"0"}}},
  {...quote(),model:{...quote().model,pricing:{prompt:"0",completion:"0",overrides:[{price:5}]}}},
  {...quote(),model:{...quote().model,pricing:{prompt:"0",completion:"0",newCharge:"0"}}},
  {...quote(),model:{...quote().model,pricing:{completion:"0"}}},
 ]){
   assert.equal(verifyFccFreeBinding(r11,p,now).ok,false);
 }
});
test("endpoint identity, tier, provider tools, and modality cannot be inferred",()=>{
 for(const patch of [{model_id:"other:free"},{service_tier:"priority"},{native_tools:{web_search:true}}]){
  const p=quote();Object.assign(p.endpoints[0],patch);
  assert.equal(verifyFccFreeBinding(r11,p,now).ok,false);
 }
 const q=quote();q.model.architecture={modality:"text+image->text",
  input_modalities:["text","image"],output_modalities:["text"]};
 assert.equal(verifyFccFreeBinding(r11,q,now).code,"FCC_TEXT_ONLY_UNVERIFIED");
});
test("no auto endpoint switch when more than one endpoint exists",()=>{
 const p=quote();p.endpoints.push({...p.endpoints[0],model_id:p.model.id});
 assert.equal(verifyFccFreeBinding(r11,p,now).code,"FCC_MULTIPLE_ENDPOINTS_UNPINNED");
});
test("stage check cannot claim native Claude ready or Dennis UAT passed",()=>{
 const result=verifyFccFreeBinding(r11,quote(),now);
 assert.equal(result.ok,true);
 assert.equal("nativeClaudeResumeProven" in result,false);
 assert.equal("DENNIS_UAT_PASS" in result,false);
});
test("fallback list has identical 12 operator entries",()=>{
 assert.equal(FALLBACK_MODEL_ROUTES.length,12);
 assert.equal(FALLBACK_MODEL_ROUTES[0],"open_router/poolside/laguna-xs-2.1:free");
 assert.equal(FALLBACK_MODEL_ROUTES[10],r11);
 assert.equal(FALLBACK_MODEL_ROUTES[11],"open_router/openrouter/free");
});
