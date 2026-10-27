/** Existing native first-turn semantics for a prepared WEG2 or Werkplaats session.
 * A session registry UUID is not a Codex thread ID; first prompt MUST create
 * its own native thread, never attempt resume with the prepared placeholder.
 * The first Gemini prompt similarly creates the native session; no hidden
 * bootstrap or model call is permitted at "Start".
 */
export function isPreparedStageNativeFirstTurn(
  isPreview: boolean,
  agentId: string,
  status: string,
): boolean {
  return status === "prepared" &&
    (agentId === "codex" || agentId === "gemini" || agentId === "agy" ||
      (isPreview && agentId === "hermes"));
}
