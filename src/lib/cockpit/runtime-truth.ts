import { execFile } from "child_process";
import { promises as fs } from "fs";
import { promisify } from "util";
import type { CockpitAgentId } from "./agent-registry";

const execFileAsync = promisify(execFile);
export type LiveCockpitAgentId = Extract<CockpitAgentId, "hermes" | "claude-code" | "openclaw" | "antigravity">;

export interface RuntimeTruth {
  targetId: LiveCockpitAgentId;
  agentIdentity: string;
  runtime: string;
  installedVersion: string | null;
  runningServiceVersion: string | null;
  provider: string | null;
  actualModel: string | null;
  transport: string | null;
  workspace: string;
  project: string;
  lastVerifiedAt: string;
  evidence: string[];
}

const workspace = () => process.env.MISSION_CONTROL_AGENT_WORKSPACE || process.cwd();
const project = () => "mission-control";
const clean = (value: unknown) => String(value ?? "").trim() || null;

async function command(binary: string, args: string[], cwd = workspace()): Promise<string | null> {
  try {
    const result = await execFileAsync(binary, args, { cwd, env: { ...process.env }, timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8" });
    return clean(result.stdout);
  } catch {
    return null;
  }
}
async function hermesTruth(): Promise<RuntimeTruth> {
  const binary = process.env.HERMES_AGENT_BINARY || "/usr/local/bin/hermes";
  const [provider, model] = await Promise.all([
    command(binary, ["config", "get", "model.provider"]),
    command(binary, ["config", "get", "model.default"]),
  ]);
  let installedVersion: string | null = null;
  let runningServiceVersion: string | null = null;
  let hostEvidenceAt: string | null = null;
  try {
    const host = JSON.parse(await fs.readFile(`${workspace()}/runtime-evidence/live-host.json`, "utf8")) as {
      generatedAt?: unknown; hermes?: { installedVersion?: unknown; runningServiceVersion?: unknown; runningServiceVersionStatus?: unknown };
    };
    installedVersion = clean(host.hermes?.installedVersion);
    runningServiceVersion = clean(host.hermes?.runningServiceVersion) ?? clean(host.hermes?.runningServiceVersionStatus);
    hostEvidenceAt = clean(host.generatedAt);
  } catch {}
  if (!installedVersion) {
    try {
      const stamp = JSON.parse(await fs.readFile("/usr/local/lib/hermes-agent/install-stamp.json", "utf8")) as { displayVersion?: unknown };
      installedVersion = clean(stamp.displayVersion);
    } catch {
      installedVersion = clean((await command(binary, ["--version"]))?.split("\n")[0]);
    }
  }
  return {
    targetId: "hermes", agentIdentity: "Hermes Agent", runtime: "Hermes Agent CLI",
    installedVersion, runningServiceVersion, provider, actualModel: model,
    transport: provider && model ? `${provider}/${model}` : model,
    workspace: workspace(), project: project(), lastVerifiedAt: new Date().toISOString(),
    evidence: [hostEvidenceAt ? `host runtime evidence ${hostEvidenceAt}` : "install-stamp.json or hermes --version", "hermes config model.provider", "hermes config model.default"],
  };
}

async function claudeTruth(): Promise<RuntimeTruth> {
  const launcher = process.env.CLAUDE_CODE_LAUNCHER || "/runtime/bin/start-claude-fcc.sh";
  const version = await command(launcher, ["--version"]);
  return {
    targetId: "claude-code", agentIdentity: "Claude Code", runtime: "Claude Code CLI",
    installedVersion: version, runningServiceVersion: null, provider: null, actualModel: null,
    transport: "FCC route selected per Claude Code turn",
    workspace: process.env.CLAUDE_CODE_WORKSPACE || workspace(), project: project(), lastVerifiedAt: new Date().toISOString(),
    evidence: ["Mission Control Claude launcher --version", "per-turn Claude Code JSON result"],
  };
}
async function openClawTruth(): Promise<RuntimeTruth> {
  const binary = process.env.OPENCLAW_AGENT_BINARY || "/usr/bin/openclaw";
  const version = await command(binary, ["--version"]);
  return {
    targetId: "openclaw", agentIdentity: "OpenClaw", runtime: "OpenClaw CLI agent route",
    installedVersion: version, runningServiceVersion: null, provider: null, actualModel: null,
    transport: process.env.OPENCLAW_GATEWAY_URL ? "Mission Control sandbox gateway relay" : "OpenClaw gateway",
    workspace: process.env.OPENCLAW_AGENT_WORKSPACE || workspace(), project: project(), lastVerifiedAt: new Date().toISOString(),
    evidence: ["Mission Control OpenClaw launcher --version", "per-turn OpenClaw JSON agentMeta"],
  };
}

async function antigravityTruth(): Promise<RuntimeTruth> {
  const binary = process.env.AGY_AGENT_BINARY || "/root/.local/bin/agy";
  const version = await command(binary, ["--version"]);
  return {
    targetId: "antigravity", agentIdentity: "Antigravity", runtime: "Antigravity CLI",
    installedVersion: version, runningServiceVersion: null, provider: null, actualModel: null,
    transport: "Antigravity CLI conversation route",
    workspace: process.env.AGY_AGENT_WORKSPACE || workspace(), project: project(), lastVerifiedAt: new Date().toISOString(),
    evidence: ["agy --version", "per-turn Antigravity execution log"],
  };
}

let cache: { at: number; values: RuntimeTruth[] } | null = null;
export async function readRuntimeTruth(): Promise<RuntimeTruth[]> {
  if (cache && Date.now() - cache.at < 10_000) return cache.values;
  const values = await Promise.all([hermesTruth(), claudeTruth(), openClawTruth(), antigravityTruth()]);
  cache = { at: Date.now(), values };
  return values;
}
