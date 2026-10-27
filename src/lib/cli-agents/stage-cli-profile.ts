import { lstat } from "node:fs/promises";
import path from "node:path";
import { werkplaatsRuntimeRoot } from "@/lib/acf/runtime-root";

type IsolatedAgent = "gemini" | "codex" | "claude-code";

/** Single existing Werkplaats native-home pool, distinct from LIVE/personal
 * CLI state; no credentials are copied and no new executor is created.
 * Fail before any model prompt when a profile is missing or untrusted.
 */
export async function stageCliProfileEnvironment(
  agent: IsolatedAgent,
  parent: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  if (parent.MC_PREVIEW !== "1") return { ...parent };
  const root = werkplaatsRuntimeRoot();
  if (!root) throw new Error("STAGE_NATIVE_CWD_NOT_ISOLATED");
  const pool = path.join(root, ".preview-native-home");
  const home = path.join(pool, agent);
  const identity = await lstat(root);
  for (const dir of [pool, home]) {
    const st = await lstat(dir).catch(() => null);
    if (!st?.isDirectory() || st.isSymbolicLink() ||
        (st.mode & 0o077) !== 0 || st.uid !== identity.uid ||
        st.gid !== identity.gid) {
      throw new Error("STAGE_NATIVE_PROFILE_NOT_ISOLATED");
    }
  }
  return {
    ...parent,
    HOME: home,
    XDG_CONFIG_HOME: home,
    XDG_DATA_HOME: home,
    XDG_CACHE_HOME: home,
    ...(agent === "codex" ? { CODEX_HOME: path.join(home, ".codex") } : {}),
  };
}
