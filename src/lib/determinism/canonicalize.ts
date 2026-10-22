import { createHash } from "node:crypto";

export const NORMALIZATION_VERSION = "mc-canonical-json-v1" as const;
export type CanonicalJsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue = CanonicalJsonPrimitive | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

function normalize(value: CanonicalJsonValue): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CANONICAL_NON_FINITE_NUMBER");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  const result: Record<string, CanonicalJsonValue> = {};
  for (const key of Object.keys(value).sort()) result[key] = normalize(value[key]);
  return result;
}

export function canonicalize(value: CanonicalJsonValue, version: string = NORMALIZATION_VERSION): string {
  if (version !== NORMALIZATION_VERSION) throw new Error("NORMALIZATION_UNAVAILABLE");
  return JSON.stringify(normalize(value));
}

export function canonicalSha256(value: CanonicalJsonValue, version: string = NORMALIZATION_VERSION): string {
  return createHash("sha256").update(canonicalize(value, version)).digest("hex");
}
