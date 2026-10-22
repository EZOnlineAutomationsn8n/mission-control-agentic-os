export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  const flag = process.env.OMI_INTAKE_SCHEDULER?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return;

  const productionDefault = process.env.NODE_ENV === "production";
  const explicitlyEnabled = flag === "1" || flag === "true" || flag === "on";
  if (!productionDefault && !explicitlyEnabled) return;

  const { startOmiCandidateIntakeScheduler } = await import("@/lib/connectors/live/omi-intake-scheduler");
  startOmiCandidateIntakeScheduler();
}
