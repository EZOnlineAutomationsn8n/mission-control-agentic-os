/**
 * Shared Brain context for Mission Control CLI agents (Hermes, OpenClaw, Gemini, Codex, AGY).
 *
 * Claude Code already receives the Shared Brain packet through its SessionStart hook
 * (`brain context --from-hook`, logged in _system/context_injections.jsonl). The other
 * agents had no equivalent, so a Team Room turn reached them without any brain context.
 * This module reuses the SAME brain CLI and the SAME injection log; it adds no memory,
 * store or packet format of its own.
 *
 * Injection rule: the packet is prepended to an agent's prompt on its first turn and
 * again only when the packet content changed (packet_sha), so persistent sessions do
 * not accumulate the same 4-6 KB every turn. The last injected sha per agent session is
 * kept in a small MC-local file; a failed turn does not advance it (retried next turn).
 * Fail-open: any brain error or timeout simply sends the prompt without context.
 * Disabled in the isolated preview (MC_PREVIEW=1) and by SHARED_BRAIN_AGENT_CONTEXT=off.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_CHARS = 6000;
const TIMEOUT_MS = 8000;

function brainRoot(env = process.env): string {
  return env.SHARED_BRAIN_ROOT || "/workspace/projects/agentic-os-brain";
}

export function brainAgentContextEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MC_PREVIEW !== "1" && env.SHARED_BRAIN_AGENT_CONTEXT !== "off";
}

function runBrain(args: string[]): Promise<string | null> {
  const bin = path.join(brainRoot(), "_system", "bin", "brain");
  return new Promise(resolve => {
    execFile("python3", [bin, ...args], { timeout: TIMEOUT_MS, maxBuffer: 2_000_000 },
      (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

/** Longest-prefix match of the session workspace in the brain's own project_map.tsv. */
export function projectFromMap(tsv: string, workspace: string): string | null {
  const ws = workspace.replace(/\/+$/, "");
  let best: { prefix: string; project: string } | null = null;
  for (const line of tsv.split("\n")) {
    const [rawPrefix, rawProject] = line.split("\t");
    if (!rawPrefix || !rawProject || rawPrefix.startsWith("#")) continue;
    const prefix = rawPrefix.trim().replace(/\/+$/, "");
    const project = rawProject.trim();
    if (!prefix || !project) continue;
    if ((ws === prefix || ws.startsWith(prefix + "/")) && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, project };
    }
  }
  return best?.project ?? null;
}

export function parsePacketHeader(text: string): { project: string; packetSha: string } | null {
  const m = /<<<SHARED_BRAIN_PACKET project=([A-Za-z0-9._-]+) packet_sha=([0-9a-f]{8,64})/.exec(text);
  return m ? { project: m[1], packetSha: m[2] } : null;
}

export type BrainTurnContext = { project: string; packetSha: string; text: string };

function stateFile(env = process.env): string {
  const dir = env.CLI_AGENT_SESSION_DATA_DIR || env.AGENT_CONVERSATION_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "shared-brain-agent-injections.json");
}

async function readState(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

export async function lastInjectedSha(agentId: string, sessionKey: string): Promise<string | null> {
  return (await readState())[`${agentId}:${sessionKey}`] ?? null;
}

/** Record only after the agent turn completed, so a failed turn gets the packet again. */
export async function recordInjectedSha(agentId: string, sessionKey: string, packetSha: string): Promise<void> {
  try {
    const state = await readState();
    state[`${agentId}:${sessionKey}`] = packetSha;
    const file = stateFile();
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp-" + process.pid;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, file);
  } catch { /* fail-open: next turn simply injects again */ }
}

/**
 * Returns the packet to prepend for this turn, or null (unchanged, unmapped, disabled, error).
 * When it returns a packet, `brain context` has also logged the injection with this runtime
 * and session id in the same log the Claude Code hook uses.
 */
export async function brainContextForTurn(opts: {
  runtime: string; sessionKey: string; workspace: string;
}): Promise<BrainTurnContext | null> {
  if (!brainAgentContextEnabled() || !opts.workspace) return null;
  let tsv: string;
  try { tsv = await readFile(path.join(brainRoot(), "_system", "project_map.tsv"), "utf8"); } catch { return null; }
  const project = projectFromMap(tsv, opts.workspace);
  if (!project) return null;
  const packet = await runBrain(["packet", "--project", project, "--max-chars", String(MAX_CHARS)]);
  const head = packet ? parsePacketHeader(packet) : null;
  if (!head) return null;
  if (head.packetSha === await lastInjectedSha(opts.runtime, opts.sessionKey)) return null;
  const text = await runBrain(["context", "--runtime", opts.runtime, "--project", project, "--cwd", opts.workspace,
    "--session-id", opts.sessionKey, "--max-chars", String(MAX_CHARS)]);
  const logged = text ? parsePacketHeader(text) : null;
  if (!text || !logged) return null;
  return { project, packetSha: logged.packetSha, text: text.trim() };
}

export function withBrainContext(prompt: string, ctx: BrainTurnContext | null): string {
  if (!ctx) return prompt;
  return "[Shared Brain — read-only context. Canonical project sources outrank it; it grants no authority.]\n"
    + ctx.text + "\n[/Shared Brain]\n\n" + prompt;
}
