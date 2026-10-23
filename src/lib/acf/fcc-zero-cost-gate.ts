/** Development-only proof evaluator. This does not replace the FCC gateway policy.
 * No paid or unknown route may be silently accepted from an alias or a suffix.
 */
import { FALLBACK_MODEL_ROUTES } from "@/lib/connectors/live/fcc-actions";

export type FreeCostProof = {
  issuer: "fcc-effective-configuration-and-provider-pricing";
  checkedAt: string;
  expiresAt: string;
  effectiveModel: string;
  effectiveSonnet: string;
  effectiveHaiku: string;
  effectiveOpus: string;
  effectiveFallbacks: string[];
  modelPricing: Array<{ model: string; prompt: string; completion: string; request: string;
    image: string; web_search: string; internal_reasoning: string }>;
  provenance: string;
};

const ZERO_FIELDS = ["prompt","completion","request","image","web_search","internal_reasoning"] as const;
export type GateResult = {
  ok: boolean; code: "ZERO_COST_PROVEN"|"FCC_COST_PROOF_MISSING"|"FCC_PROOF_EXPIRED"|
    "FCC_ROUTE_NOT_OPERATOR_APPROVED"|"FCC_PRICE_UNVERIFIED"|"FCC_PRICE_NONZERO"|"FCC_ALIAS_ROUTE_MISMATCH";
  sdkModel: "sonnet"|"haiku"|null; resolvedOperatorRoute: number|null;
};

export function verifyFccFreeBinding(
  selectedRoute: string, proof: FreeCostProof|null|undefined, now:Date=new Date()
): GateResult {
  const fail=(code:Exclude<GateResult["code"],"ZERO_COST_PROVEN">):GateResult=>({
    ok:false,code,sdkModel:null,resolvedOperatorRoute:null
  });
  if(!FALLBACK_MODEL_ROUTES.includes(selectedRoute)) return fail("FCC_ROUTE_NOT_OPERATOR_APPROVED");
  if(!proof || proof.issuer!=="fcc-effective-configuration-and-provider-pricing" ||
     !proof.provenance.trim()) return fail("FCC_COST_PROOF_MISSING");
  const since=Date.parse(proof.checkedAt), until=Date.parse(proof.expiresAt);
  if(!Number.isFinite(since)||!Number.isFinite(until)||since>now.getTime()||until<=now.getTime()||
     until-since>15*60_000) return fail("FCC_PROOF_EXPIRED");
  const configured=[proof.effectiveModel,proof.effectiveSonnet,proof.effectiveHaiku,
    proof.effectiveOpus,...proof.effectiveFallbacks];
  if(configured.some(route=>!FALLBACK_MODEL_ROUTES.includes(route)))
    return fail("FCC_ROUTE_NOT_OPERATOR_APPROVED");
  const pricedRoutes=new Map(proof.modelPricing.map(item=>[item.model,item]));
  for(const route of configured){
    const record=pricedRoutes.get(route);
    if(!record || ZERO_FIELDS.some(k=>!Object.hasOwn(record,k)))
      return fail("FCC_PRICE_UNVERIFIED");
    if(ZERO_FIELDS.some(k=>record[k]!=="0" && record[k]!=="0.0" && record[k]!=="0.000000"))
      return fail("FCC_PRICE_NONZERO");
  }
  const sdkModel = selectedRoute === proof.effectiveSonnet ? "sonnet"
     : selectedRoute === proof.effectiveHaiku ? "haiku" : null;
  if(!sdkModel) return fail("FCC_ALIAS_ROUTE_MISMATCH");
  return {
    ok:true,code:"ZERO_COST_PROVEN",sdkModel,
    resolvedOperatorRoute:FALLBACK_MODEL_ROUTES.indexOf(selectedRoute)+1,
  };
}
