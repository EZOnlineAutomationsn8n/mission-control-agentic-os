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

export type NativeStagePreflight = {
  code: string;
  isolated: boolean;
  binaryAvailable: boolean;
  loginVerified: boolean | null;
  modelCalls: 0;
};

/** A read-only real-runtime probe, never a model request or session write. */
export async function inspectStageCliPreflight(agent: "gemini" | "codex"): Promise<NativeStagePreflight> {
  if (process.env.MC_PREVIEW !== "1") {
    return { code: "NOT_WERKPLAATS", isolated: false, binaryAvailable: false, loginVerified: null, modelCalls: 0 };
  }
  let env: NodeJS.ProcessEnv;
  try { env = await stageCliProfileEnvironment(agent); }
  catch {
    return { code: "STAGE_NATIVE_PROFILE_NOT_ISOLATED", isolated: false, binaryAvailable: false, loginVerified: null, modelCalls: 0 };
  }
  const binary = agent === "codex"
    ? process.env.CODEX_AGENT_BINARY || "/usr/bin/codex"
    : process.env.GEMINI_AGENT_BINARY || "/usr/bin/gemini";
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    await run(binary, ["--version"], {
      cwd: werkplaatsRuntimeRoot()!, env, timeout: 8_000, encoding: "utf8", maxBuffer: 100_000,
    });
  } catch {
    return { code: "STAGE_NATIVE_BINARY_UNAVAILABLE", isolated: true, binaryAvailable: false, loginVerified: null, modelCalls: 0 };
  }
  if (agent === "gemini") {
    return { code: "GEMINI_BINARY_PRESENT_AUTH_UNVERIFIED", isolated: true, binaryAvailable: true, loginVerified: null, modelCalls: 0 };
  }
  try {
    const { stdout, stderr } = await run(binary, ["login", "status"], {
      cwd: werkplaatsRuntimeRoot()!, env, timeout: 8_000, encoding: "utf8", maxBuffer: 100_000,
    });
    const output = String(stdout) + "\n" + String(stderr);
    const verified = /^Logged in using ChatGPT\s*$/m.test(output) &&
      !/api.key|pay.as.you.go|openai_api_key/i.test(output);
    return { code: verified ? "CODEX_STAGE_SUBSCRIPTION_AUTH_VERIFIED" : "CODEX_STAGE_AUTH_NOT_VERIFIED",
      isolated: true, binaryAvailable: true, loginVerified: verified, modelCalls: 0 };
  } catch {
    return { code: "CODEX_STAGE_AUTH_NOT_VERIFIED", isolated: true, binaryAvailable: true, loginVerified: false, modelCalls: 0 };
  }
}
