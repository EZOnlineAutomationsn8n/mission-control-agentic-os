/**
 * R2 recovery operator authorization — reuses the existing Nginx Basic realm of
 * the environment that OWNS the session row. No app users are invented and the
 * credential is never stored or logged (same contract as validateWerkplaatsOperator).
 *
 *  - LIVE owner (:3330, DATABASE_URL present): browser request from the LIVE edge,
 *    Basic credential accepted by the LIVE realm, identity preview === false.
 *  - Native-isolated stage (fixture tests only): existing Werkplaats operator check.
 *  - Werkplaats AGENTS MODE: refused — the real row lives at the LIVE owner.
 */
import { databaseEnabled } from "@/lib/persistence/database";
import { validateWerkplaatsOperator } from "@/lib/connectors/live/manus-stage-setup";

export const LIVE_EDGE = "https://mc.vireonhq.cloud";

export async function validateLiveOperator(req: Request): Promise<string | null> {
  if (process.env.MC_PREVIEW === "1") return "NOT_LIVE_OWNER";
  if (!databaseEnabled()) return "RECOVERY_LIVE_OWNER_DATABASE_REQUIRED";
  if (req.headers.get("origin") !== LIVE_EDGE) return "ORIGIN_MISMATCH";
  if (!["same-origin", "none"].includes(req.headers.get("sec-fetch-site") || "")) return "FETCH_SITE_MISMATCH";
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Basic [a-zA-Z0-9+/=]{12,512}$/.test(authorization)) return "LIVE_LOGIN_REQUIRED";
  try {
    const response = await fetch(LIVE_EDGE + "/api/preview-identity", {
      headers: { authorization, accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !String(response.headers.get("content-type")).includes("application/json")) return "LIVE_LOGIN_INVALID";
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("preview" in body) || body.preview !== false) return "NOT_LIVE_IDENTITY";
    return null;
  } catch { return "LIVE_AUTH_CHECK_UNAVAILABLE"; }
}

/** One decision point for both R2 steps (CAS and the single resume turn). */
export async function validateRecoveryOperator(req: Request): Promise<string | null> {
  if (process.env.MC_PREVIEW === "1") {
    if (process.env.GAOS_STAGE_NATIVE_ISOLATED === "1") return validateWerkplaatsOperator(req);
    return "RECOVERY_RUNS_AT_LIVE_OWNER_USE_LIVE_MISSION_CONTROL";
  }
  return validateLiveOperator(req);
}
