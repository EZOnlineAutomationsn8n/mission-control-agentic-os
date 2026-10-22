import { importOmiToObsidianIntake, type OmiIntakeReceipt } from "@/lib/connectors/live/omi-bridge";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 10_000;

type Timer = ReturnType<typeof setTimeout>;

export interface OmiIntakeSchedulerState {
  startedAt: string;
  intervalMs: number;
  initialDelayMs: number;
  running: boolean;
  runs: number;
  skippedOverlaps: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastReceiptPath: string | null;
  lastError: string | null;
  initialTimer: Timer | null;
  intervalTimer: Timer | null;
}

type SchedulerGlobal = typeof globalThis & {
  __missionControlOmiIntakeScheduler?: OmiIntakeSchedulerState;
};

function parseMilliseconds(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function resolveIntervalMs(raw = process.env.OMI_INTAKE_INTERVAL_MS): number {
  return Math.max(MIN_INTERVAL_MS, parseMilliseconds(raw, DEFAULT_INTERVAL_MS));
}

function resolveInitialDelayMs(raw = process.env.OMI_INTAKE_INITIAL_DELAY_MS): number {
  return parseMilliseconds(raw, DEFAULT_INITIAL_DELAY_MS);
}

export async function runScheduledOmiCandidatePull(): Promise<OmiIntakeReceipt> {
  return importOmiToObsidianIntake();
}

export function startOmiCandidateIntakeScheduler(): OmiIntakeSchedulerState {
  const root = globalThis as SchedulerGlobal;
  if (root.__missionControlOmiIntakeScheduler) return root.__missionControlOmiIntakeScheduler;

  const state: OmiIntakeSchedulerState = {
    startedAt: new Date().toISOString(),
    intervalMs: resolveIntervalMs(),
    initialDelayMs: resolveInitialDelayMs(),
    running: false,
    runs: 0,
    skippedOverlaps: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastReceiptPath: null,
    lastError: null,
    initialTimer: null,
    intervalTimer: null,
  };

  const execute = async () => {
    if (state.running) {
      state.skippedOverlaps += 1;
      return;
    }
    state.running = true;
    state.lastStartedAt = new Date().toISOString();
    try {
      const receipt = await runScheduledOmiCandidatePull();
      state.runs += 1;
      state.lastReceiptPath = receipt.receiptPath;
      state.lastError = null;
      console.info("[mission-control][omi-intake] read-only candidate pull completed", {
        memories: receipt.counts.memories,
        conversations: receipt.counts.conversations,
        receiptPath: receipt.receiptPath,
        canonicalVaultMutation: receipt.canonicalVaultMutation,
      });
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "OMI candidate pull failed";
      console.error("[mission-control][omi-intake] read-only candidate pull failed", state.lastError);
    } finally {
      state.running = false;
      state.lastCompletedAt = new Date().toISOString();
    }
  };

  state.initialTimer = setTimeout(() => void execute(), state.initialDelayMs);
  state.intervalTimer = setInterval(() => void execute(), state.intervalMs);
  root.__missionControlOmiIntakeScheduler = state;
  return state;
}

export const omiIntakeSchedulerTestSupport = {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  DEFAULT_INITIAL_DELAY_MS,
  resolveIntervalMs,
  resolveInitialDelayMs,
};
