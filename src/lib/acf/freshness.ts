export type AcfRefreshFailureKind = "unavailable" | "malformed" | null;

export interface AcfReadPresentation {
  stale: boolean;
  label: "CURRENT READ" | "STALE / LAST KNOWN" | "UNAVAILABLE" | "MALFORMED / NO STATE";
}

export function acfReadPresentation(input: {
  hasLastGood: boolean;
  lastGoodAt: number | null;
  now: number;
  staleAfterMs: number;
  refreshFailureKind: AcfRefreshFailureKind;
}): AcfReadPresentation {
  if (input.refreshFailureKind && !input.hasLastGood) {
    return {
      stale: false,
      label: input.refreshFailureKind === "malformed" ? "MALFORMED / NO STATE" : "UNAVAILABLE",
    };
  }

  const staleByFailure = Boolean(input.refreshFailureKind && input.hasLastGood);
  const staleByAge = Boolean(
    input.hasLastGood &&
    input.lastGoodAt !== null &&
    input.now - input.lastGoodAt > input.staleAfterMs
  );
  const stale = staleByFailure || staleByAge;

  return {
    stale,
    label: stale ? "STALE / LAST KNOWN" : "CURRENT READ",
  };
}
