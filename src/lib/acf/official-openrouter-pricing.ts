/** Read-only official OpenRouter model+endpoint catalogs. Never use a provider
 * completion endpoint, credentials, redirects to arbitrary hosts or paid tools.
 * Catalog proof is NOT a certificate for the existing live native Claude route.
 */
import { FALLBACK_MODEL_ROUTES } from "@/lib/connectors/live/fcc-actions";
import { verifyFccFreeBinding, type FreeCostProof, type GateResult } from "./fcc-zero-cost-gate";
const root="https://openrouter.ai/api/v1";
const selected=FALLBACK_MODEL_ROUTES[10]; // fixed operator 11, never a dynamic fallback
const id=selected.replace(/^open_router\//,"");
const safeId=/^nvidia\/[a-z0-9-]+:free$/;
async function getJson(path:string):Promise<unknown>{
 const u=root+path;
 const response=await fetch(u,{cache:"no-store",redirect:"error",
   headers:{"accept":"application/json"},signal:AbortSignal.timeout(7000)});
 if(!response.ok)throw new Error("OFFICIAL_CATALOG_HTTP_"+response.status);
 const payload:unknown=await response.json();
 return payload;
}
export type CatalogReadiness={status:"CATALOG_SAFE_TEXT_ONLY"|"CATALOG_UNVERIFIED";
  code:string; operatorRoute:11; requestedModel:string; checkedAt:string|null};
export async function readOfficialUatCatalog():Promise<CatalogReadiness>{
 const fail=(code:string):CatalogReadiness=>({status:"CATALOG_UNVERIFIED",code,
   operatorRoute:11,requestedModel:id,checkedAt:null});
 if(!safeId.test(id))return fail("FCC_UNSAFE_MODEL_ID");
 try{
   // Separate model and endpoints URLs: both official, fixed, read-only GET.
   const [modelResponse,epResponse]=await Promise.all([
     getJson("/model/"+id),getJson("/models/"+id+"/endpoints")
   ]);
   const m=(modelResponse as {data?:unknown})?.data as FreeCostProof["model"]|undefined;
   const e=(epResponse as {data?:{endpoints?:unknown}})?.data?.endpoints;
   const checkedAt=new Date();
   const proof:FreeCostProof={
     issuer:"openrouter-official-model-and-endpoint-catalog",
     checkedAt:checkedAt.toISOString(),expiresAt:new Date(checkedAt.getTime()+5*60000).toISOString(),
     effectiveModel:FALLBACK_MODEL_ROUTES[3],effectiveSonnet:selected,
     effectiveHaiku:FALLBACK_MODEL_ROUTES[3],effectiveOpus:selected,
     effectiveFallbacks:[FALLBACK_MODEL_ROUTES[3],selected],
     model:m as FreeCostProof["model"],endpoints:e as FreeCostProof["endpoints"]
   };
   const verdict:GateResult=verifyFccFreeBinding(selected,proof,checkedAt);
   return {status:verdict.ok?"CATALOG_SAFE_TEXT_ONLY":"CATALOG_UNVERIFIED",
     code:verdict.code,operatorRoute:11,requestedModel:id,checkedAt:checkedAt.toISOString()};
 }catch(e){
   return fail(e instanceof Error&&e.message.startsWith("OFFICIAL_CATALOG_HTTP_")?
      e.message:"FCC_PUBLIC_CATALOG_UNAVAILABLE");
 }
}
