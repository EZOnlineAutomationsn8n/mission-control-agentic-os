/** ACF roster truth only. No runtime, model, or session is started here. */
export interface SessionEligibility {
  session_ref: string;
  verdict: string;
}
export interface AgentEligibility {
  agent_id: string;
  route: string;
  suggested_session: string | null;
  sessions: readonly SessionEligibility[];
}
export function resolveRosterSession(
  agent: AgentEligibility,
  explicitlyPinned: string | undefined,
): string {
  // Operator's explicit choice may select an individually pinned session.
  if (explicitlyPinned) return agent.sessions.some(s => s.session_ref === explicitlyPinned)
    ? explicitlyPinned : "";
  // ACF suggestion is canonical only if the verdict currently permits binding.
  const suggested = agent.sessions.find(s => s.session_ref === agent.suggested_session
    && s.verdict === "ELIGIBLE");
  if (suggested) return suggested.session_ref;
  // Stable, deterministic reuse of an already eligible ACF session. Never auto-pin
  // a personal pane or an excluded/failed session.
  const eligible = agent.sessions.filter(s => s.verdict === "ELIGIBLE")
    .sort((a,b) => a.session_ref.localeCompare(b.session_ref));
  return eligible[0]?.session_ref ?? "";
}
export function isSessionBindable(
  agent: AgentEligibility,
  sessionRef: string,
  explicitlyPinned: string | undefined,
): boolean {
  if (agent.route !== "ENABLED" || !sessionRef) return false;
  const item = agent.sessions.find(s => s.session_ref === sessionRef);
  return item?.verdict === "ELIGIBLE" ||
    (Boolean(explicitlyPinned) && item?.verdict === "ELIGIBLE_PIN_REQUIRED");
}
export function operatorReadiness(
  agent: AgentEligibility,
  explicitlyPinned: string | undefined,
): "SESSION_READY" | "ELIGIBLE_PIN_REQUIRED" | "BLOCKED" {
  const session = resolveRosterSession(agent,explicitlyPinned);
  if (isSessionBindable(agent,session,explicitlyPinned)) return "SESSION_READY";
  return agent.sessions.some(s => s.verdict === "ELIGIBLE_PIN_REQUIRED") &&
    agent.route === "ENABLED" ? "ELIGIBLE_PIN_REQUIRED" : "BLOCKED";
}
