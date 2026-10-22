/** RB9: serial, visibility-aware polling. Never starts another cycle while one is unsettled.
 * A non-cooperative adapter may remain in-flight after abort: deliberately DO NOT schedule another.
 * AbortSignal-aware fetches settle on timeout; backoff remains bounded.
 */
export interface BoundedPollOptions {
  intervalMs: number;
  timeoutMs?: number;
  maxBackoffMs?: number;
  onError?: (error: unknown) => void;
}

export function startBoundedPoll(
  task: (signal: AbortSignal) => Promise<boolean | void>,
  options: BoundedPollOptions
): () => void {
  const interval = options.intervalMs;
  const maxBackoff = options.maxBackoffMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 8_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let failures = 0;

  const isVisible = () => document.visibilityState !== "hidden";
  const clearScheduled = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (delay: number) => {
    if (stopped || !isVisible() || controller) return;
    clearScheduled();
    timer = setTimeout(() => { timer = null; void run(); }, delay);
  };
  const run = async () => {
    if (stopped || !isVisible() || controller) return;
    const current = new AbortController();
    controller = current;
    const deadline = setTimeout(() => current.abort(new DOMException("Poll deadline exceeded", "TimeoutError")), timeoutMs);
    let ok = false;
    try {
      const outcome = await task(current.signal);
      ok = outcome !== false && !current.signal.aborted;
    } catch (error) {
      if (!stopped && isVisible()) options.onError?.(error);
    } finally {
      clearTimeout(deadline);
      if (controller === current) controller = null;
      if (!stopped && isVisible()) {
        failures = ok ? 0 : Math.min(failures + 1, 6);
        schedule(ok ? interval : Math.min(maxBackoff, interval * 2 ** failures));
      }
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      clearScheduled();
      controller?.abort();
    } else if (!stopped && !controller) {
      failures = 0;
      schedule(0);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  schedule(0);
  return () => {
    stopped = true;
    clearScheduled();
    controller?.abort();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Bound a one-off GET too (operator Refresh, direct read). */
export async function fetchJsonBounded<T>(url: string, options: {
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Promise<T> {
  const controller = new AbortController();
  const relay = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", relay, { once: true });
  const deadline = setTimeout(
    () => controller.abort(new DOMException("Request deadline exceeded", "TimeoutError")),
    options.timeoutMs ?? 8_000
  );
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", relay);
  }
}
