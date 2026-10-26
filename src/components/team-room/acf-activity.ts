import type { AcfTeamRoomRun } from "@/lib/acf/types";

/** Never equate the latest ACF message, a PENDING ledger entry, or an MC session with running execution. */
export function activityFromAcf(run: AcfTeamRoomRun | null, role: string | null, stale: boolean) {
  if (stale) return { state: "UNKNOWN", label: "ACF-stand verouderd", evidence: "Laatste ACF-leesresultaat is niet actueel" } as const;
  if (!run || !role || !run.participants.some(p => p.role === role)) {
    return { state: "NOT_BOUND", label: "Niet in ACF-run", evidence: "Geen bevestigde rolbinding in deze run" } as const;
  }
  const view=run.teamView;
  const inFlight=view?.in_flight;
  // ACF in_flight is unknown-typed in the read contract: confirm the exact role before indicating activity.
  const active=inFlight && typeof inFlight==="object" && !Array.isArray(inFlight)
    ? inFlight as Record<string,unknown> : null;
  if (active?.role===role && active.status!=="FAILED" && active.status!=="UNKNOWN") {
    return { state: "RUNNING", label: "ACF-beurt loopt", evidence: "ACF teamView.in_flight bevestigt deze rol" } as const;
  }
  const pending=(view?.collaboration?.open_pending ?? []).filter(p=>p.role===role);
  if (pending.length) {
    const failures=pending.filter(p=>typeof (p as {code?:unknown}).code==="string").map(p=>String((p as {code?:string}).code));
    return { state: "PENDING", label: failures.length ? "Openstaand · "+failures.join(", ") : "ACF-beurt openstaand",
      evidence: "ACF collaboration.open_pending · geen bewijs dat het model nu draait" } as const;
  }
  if (view?.intervention?.open?.owed?.some(owed=>owed.to===role)) {
    return { state: "WAITING", label: "Antwoord nog verschuldigd", evidence: "ACF intervention.open.owed · wacht op operator/step" } as const;
  }
  const last=[...run.messages].reverse().find(m=>m.from===role);
  if (last) return { state: "ANSWERED", label: "Laatste bericht · #"+last.sequence,
    evidence: "ACF-journal bevat een antwoord, maar geen bewijs van een lopende beurt" } as const;
  return { state: "IDLE", label: "Geen lopende ACF-beurt", evidence: "ACF heeft geen actieve beurt of openstaand antwoord voor deze rol" } as const;
}
export type AcfActivity = ReturnType<typeof activityFromAcf>;
