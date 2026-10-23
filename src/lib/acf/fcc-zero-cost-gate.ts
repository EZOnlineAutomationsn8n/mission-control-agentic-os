/** FCC read-only pricing proof, model AND endpoint specific.
 * Official OpenRouter docs: omitted SKU is NOT a synthetic zero price;
 * :free endpoint is free for inference, external tools are separate charges.
 * No browser inputs or environment toggles can authorize a native Claude turn.
 */
import { FALLBACK_MODEL_ROUTES } from "@/lib/connectors/live/fcc-actions";

type Pricing = Record<string, unknown> & { prompt?:unknown; completion?:unknown; overrides?:unknown };
export type CatalogModel = {id:string;pricing:Pricing;architecture?:{modality?:string;input_modalities?:string[];output_modalities?:string[]}};
export type CatalogEndpoint = {model_id:string;pricing:Pricing;status?:number|null;native_tools?:Record<string,unknown>|null;service_tier?:string|null;provider_name?:string};
export type FreeCostProof = {
  issuer:"openrouter-official-model-and-endpoint-catalog";
  checkedAt:string;expiresAt:string;
  effectiveModel:string;effectiveSonnet:string;effectiveHaiku:string;effectiveOpus:string;
  effectiveFallbacks:string[];
  model:CatalogModel;
  endpoints:CatalogEndpoint[];
};
export type GateCode =
 "CATALOG_TEXT_PRICE_ZERO"|"FCC_COST_PROOF_MISSING"|"FCC_PROOF_EXPIRED"|
 "FCC_ROUTE_NOT_OPERATOR_APPROVED"|"FCC_PRICE_UNVERIFIED"|"FCC_PRICE_NONZERO"|
 "FCC_ALIAS_ROUTE_MISMATCH"|"FCC_ENDPOINT_UNAVAILABLE"|
 "FCC_ENDPOINT_ID_MISMATCH"|"FCC_MULTIPLE_ENDPOINTS_UNPINNED"|
 "FCC_EXTRA_CHARGE_UNVERIFIED"|"FCC_TEXT_ONLY_UNVERIFIED";
export type GateResult={ok:boolean;code:GateCode;sdkModel:"sonnet"|"haiku"|null;
  resolvedOperatorRoute:number|null;optionalPricing:"not_applicable_for_text_only_free_endpoint"|null};

const knownPriceKeys=new Set([
 "prompt","completion","request","image","image_token","image_output","audio","audio_output",
 "input_audio_cache","input_cache_read","input_cache_write","input_cache_write_1h",
 "web_search","internal_reasoning","discount","overrides"
]);
function numericZero(value:unknown):boolean{
  if(typeof value!=="string" && typeof value!=="number")return false;
  const s=String(value).trim();
  // Inspect mantissa, not JS Number conversion (which underflows for tiny fees).
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))return false;
  const mantissa=s.split(/e/i)[0].replace(/[+\-.]/g,"");
  return mantissa.length>0 && /^[0]+$/.test(mantissa);
}
function assessPrices(price:Pricing):"safe"|"unknown"|"paid"{
  if(!price || typeof price!=="object"||Array.isArray(price))return "unknown";
  if(!numericZero(price.prompt)||!numericZero(price.completion))return "unknown";
  if(Object.keys(price).some(k=>!knownPriceKeys.has(k)))return "unknown";
  if(price.overrides!==undefined && (!Array.isArray(price.overrides)||price.overrides.length>0))return "unknown";
  for(const [k,v] of Object.entries(price)){
    if(k==="prompt"||k==="completion"||k==="overrides"||k==="discount")continue;
    // Missing optional SKUs are not zeroed. The provider's :free/text-only
    // endpoint contract says absent SKUs are not billed. Explicit prices,
    // including cache or request, must be verified as zero.
    if(!numericZero(v))return v===undefined||v===null?"unknown":"paid";
  }
  if(price.discount!==undefined &&
    (typeof price.discount!=="number"||!Number.isFinite(price.discount)||
      price.discount<0||price.discount>1))return "unknown";
  return "safe";
}
export function verifyFccFreeBinding(selectedRoute:string,proof:FreeCostProof|null|undefined,
  now:Date=new Date()):GateResult{
  const fail=(code:GateCode):GateResult=>({ok:false,code,sdkModel:null,resolvedOperatorRoute:null,optionalPricing:null});
  if(!FALLBACK_MODEL_ROUTES.includes(selectedRoute)||selectedRoute==="open_router/openrouter/free")
    return fail("FCC_ROUTE_NOT_OPERATOR_APPROVED");
  if(!proof||proof.issuer!=="openrouter-official-model-and-endpoint-catalog")return fail("FCC_COST_PROOF_MISSING");
  const from=Date.parse(proof.checkedAt),until=Date.parse(proof.expiresAt);
  if(!Number.isFinite(from)||!Number.isFinite(until)||from>now.getTime()||until<=now.getTime()||
     until-from>15*60_000)return fail("FCC_PROOF_EXPIRED");
  const configured=[proof.effectiveModel,proof.effectiveSonnet,proof.effectiveHaiku,proof.effectiveOpus,...proof.effectiveFallbacks];
  if(configured.some(x=>!FALLBACK_MODEL_ROUTES.includes(x)||x==="open_router/openrouter/free"))
    return fail("FCC_ROUTE_NOT_OPERATOR_APPROVED");
  const sdkModel=selectedRoute===proof.effectiveSonnet?"sonnet":
      selectedRoute===proof.effectiveHaiku?"haiku":null;
  if(!sdkModel)return fail("FCC_ALIAS_ROUTE_MISMATCH");
  const expectedModel=selectedRoute.replace(/^open_router\//,"");
  if(!expectedModel.endsWith(":free")||proof.model?.id!==expectedModel)
    return fail("FCC_ENDPOINT_ID_MISMATCH");
  const arch=proof.model.architecture;
  if(arch?.modality!=="text->text"||!arch.input_modalities?.includes("text")||
      !arch.output_modalities?.includes("text")||
      arch.input_modalities?.some(m=>m!=="text")||arch.output_modalities?.some(m=>m!=="text"))
    return fail("FCC_TEXT_ONLY_UNVERIFIED");
  if(!Array.isArray(proof.endpoints)||proof.endpoints.length!==1)
    return fail("FCC_MULTIPLE_ENDPOINTS_UNPINNED");
  const ep=proof.endpoints[0];
  if(ep.model_id!==expectedModel||ep.service_tier!==null||ep.native_tools===undefined||
    !ep.native_tools||Object.keys(ep.native_tools).length)
    return fail("FCC_ENDPOINT_ID_MISMATCH");
  if(typeof ep.status!=="number"||ep.status<0)return fail("FCC_ENDPOINT_UNAVAILABLE");
  const modelPrice=assessPrices(proof.model.pricing),endpointPrice=assessPrices(ep.pricing);
  if(modelPrice!=="safe"||endpointPrice!=="safe")
    return fail(modelPrice==="paid"||endpointPrice==="paid"?"FCC_PRICE_NONZERO":"FCC_PRICE_UNVERIFIED");
  return {ok:true,code:"CATALOG_TEXT_PRICE_ZERO",sdkModel,
    resolvedOperatorRoute:FALLBACK_MODEL_ROUTES.indexOf(selectedRoute)+1,
    optionalPricing:"not_applicable_for_text_only_free_endpoint"};
}
