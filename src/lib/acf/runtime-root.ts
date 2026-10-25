import path from "node:path";

const SHARED_ACF_ROOT = "/workspace/projects/agentic-collaboration-fabric";

export function werkplaatsRuntimeRoot(): string | null {
  if (process.env.MC_PREVIEW !== "1") return null;
  const cwd = path.resolve(process.cwd());
  return path.basename(cwd).startsWith(".stage-") ? cwd : null;
}

export function acfProjectRoot(): string {
  const stage = werkplaatsRuntimeRoot();
  if (stage) return path.join(stage, ".preview-acf-runtime");
  return process.env.ACF_PROJECT_ROOT || SHARED_ACF_ROOT;
}

export function acfStateDir(projectRoot = acfProjectRoot()): string {
  const stage = werkplaatsRuntimeRoot();
  if (stage) return path.join(stage, ".preview-acf-home");
  return process.env.ACF_STATE_DIR || path.join(projectRoot, "state", "team-room");
}

export function acfRoutesPath(stateDir = acfStateDir()): string {
  const stage = werkplaatsRuntimeRoot();
  if (stage) return path.join(stage, ".preview-acf-home", "participant_routes.json");
  return process.env.ACF_TEAM_ROOM_ROUTES || path.join(stateDir, "participant_routes.json");
}

export function effectiveWerkplaatsWorkspace(storedWorkspace: string): string {
  return werkplaatsRuntimeRoot() || storedWorkspace;
}
