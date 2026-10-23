/** Workshop UI policy for schema-2 Free Room.
 * The ACF journal/board owns every actual state transition. UI never invents one.
 * One operator click may advance only a bounded chunk; chunks never consume a
 * lifetime room budget or automatically dispatch another chunk.
 */
import type { AcfTeamViewV1 } from "./types";

export const FREE_ROOM_STEPS_PER_CLICK = 16;
export type FreeRoomPendingKind = "replies" | "collaboration";
export type FreeRoomReading = { kind: "ready" | "paused" | "pending" | "blocked" | "ended" | "unknown";
  label: string; detail: string; mayStep: boolean; mayResume: boolean; };

export function readFreeRoomState(view: AcfTeamViewV1 | null, mode: FreeRoomPendingKind): FreeRoomReading {
  if (!view) return { kind: "unknown", label: "ACF-status onbekend", detail: "Geen recente team-view. Geen nieuwe beurt starten.", mayStep: false, mayResume: false };
  if (view.in_flight) return { kind: "pending", label: "Beurt in behandeling", detail: "ACF heeft een open journal-intent. Eerst status en bewijs reconciliëren; geen dubbele dispatch.", mayStep: false, mayResume: false };
  const action = view.next_safe_action || "";
  const reason = [view.collaboration?.reason, action, view.run_status].filter(Boolean).join(" · ");
  const isPaused = view.run_status === "PAUSED" || /^PAUSED(?:_|$)/.test(view.run_status);
  if (isPaused) {
    const owed = view.intervention?.open?.owed?.length ?? 0;
    const open = Boolean(view.intervention?.open);
    // Existing ACF operator intervention deliberately keeps the run PAUSED
    // while owed directed replies are processed. Only these already-owed turns
    // may step; this cannot resume autonomous collaboration.
    if (mode === "replies" && open && owed > 0) return {
      kind: "ready", label: "Antwoord op operatorvraag open",
      detail: "ACF staat één gerichte beurt toe binnen de open operatorinterventie.",
      mayStep: true, mayResume: false,
    };
    return { kind: "paused", label: "ACF gepauzeerd", detail: reason || "De run is gepauzeerd.",
      mayStep: false, mayResume: open && owed === 0 };
  }
  if (view.run_status !== "ACTIVE") return {
    kind: "ended", label: "ACF-run niet actief", detail: reason || "De run accepteert geen volgende beurt.",
    mayStep: false, mayResume: false,
  };
  if (mode === "collaboration") {
    const collab = view.collaboration;
    if (!collab) return { kind: "unknown", label: "Samenwerkingsvenster ontbreekt", detail: "Geen bevestigd ACF-venster: geen beurt dispatchen.", mayStep: false, mayResume: false };
    if (collab.status === "BLOCKED" || /^PAUSED/.test(collab.status)) return {
      kind: "blocked", label: "Samenwerking geblokkeerd", detail: reason || "ACF heeft het venster geblokkeerd.",
      mayStep: false, mayResume: false,
    };
    if (collab.status === "ENDED") return {
      kind: "ended", label: "Uitvoeringsvenster afgerond", detail: "Je kunt zelf een volgend venster starten. Dit is geen limiet voor de hele kamer.",
      mayStep: false, mayResume: false,
    };
    if (!["ACTIVE", "RUNNING", "OPEN"].includes(collab.status)) return {
      kind: "unknown", label: "Nieuwe ACF-vensterstatus", detail: reason,
      mayStep: false, mayResume: false,
    };
  } else if (!(view.intervention?.open?.owed ?? []).length) {
    return { kind: "ended", label: "Geen gerichte antwoorden open", detail: "ACF meldt momenteel geen openstaande gerichte antwoorden.",
      mayStep: false, mayResume: false };
  }
  return { kind: "ready", label: "Volgende beurt beschikbaar", detail: "Alleen één journalled beurt binnen dit werkvenster.", mayStep: true, mayResume: false };
}

/** Persisted ACF state is sufficient to recover a due work-window after refresh.
 * No browser/local-storage counter is used as a source of execution authority. */
export function availableWindowFromStore(view: AcfTeamViewV1 | null): FreeRoomPendingKind | null {
  if (!view || view.in_flight) return null;
  if (view.intervention?.open?.owed?.length) return "replies";
  if (view.run_status === "ACTIVE" &&
      view.collaboration && ["ACTIVE", "RUNNING", "OPEN"].includes(view.collaboration.status)) return "collaboration";
  return null;
}

export function isUncertainTurnOutcome(code: string | undefined) {
  if (!code) return true;
  return /TIMEOUT|UNKNOWN|PENDING|IN_FLIGHT|RECONCIL|NETWORK|429|RATE_LIMIT|INTERRUPTED/i.test(code);
}
