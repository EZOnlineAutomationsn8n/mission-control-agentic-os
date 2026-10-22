import test from "node:test";
import assert from "node:assert/strict";
import { startBoundedPoll, fetchJsonBounded } from "../src/lib/cockpit/bounded-poll";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function mockVisibility() {
  const listeners = new Set<() => void>();
  let state = "visible";
  const original = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get visibilityState() { return state; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    },
  });
  return {
    set(next: string) { state = next; for (const listener of listeners) listener(); },
    restore() { Object.defineProperty(globalThis, "document", { configurable: true, value: original }); },
  };
}

test("slow request never overlaps and timeout aborts current fetch", { concurrency: false }, async () => {
  const visibility = mockVisibility();
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const stop = startBoundedPoll(async (signal) => {
    calls++; active++; maxActive = Math.max(active, maxActive);
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    active--;
    return false;
  }, { intervalMs: 10, timeoutMs: 20, maxBackoffMs: 50 });
  await sleep(130);
  stop();
  visibility.restore();
  assert.equal(maxActive, 1);
  assert.ok(calls >= 1 && calls <= 4, `calls=${calls}`);
});

test("hidden tab aborts and suspends; resumes when visible", { concurrency: false }, async () => {
  const visibility = mockVisibility();
  let calls = 0;
  let aborted = 0;
  const stop = startBoundedPoll(async (signal) => {
    calls++;
    return new Promise<boolean>((resolve) => {
      signal.addEventListener("abort", () => { aborted++; resolve(false); }, { once: true });
    });
  }, { intervalMs: 10, timeoutMs: 500, maxBackoffMs: 40 });
  await sleep(15);
  visibility.set("hidden");
  await sleep(35);
  assert.equal(calls, 1);
  assert.equal(aborted, 1);
  visibility.set("visible");
  await sleep(20);
  assert.equal(calls, 2);
  stop();
  visibility.restore();
});

test("bounded JSON fetch cancels hung transport", { concurrency: false }, async () => {
  const previous = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    })) as typeof fetch;
  try {
    await assert.rejects(() => fetchJsonBounded("/slow", { timeoutMs: 20 }));
    assert.equal(aborted, true);
  } finally { globalThis.fetch = previous; }
});

test("failed polls back off instead of rapid retry storm", { concurrency: false }, async () => {
  const visibility = mockVisibility();
  const starts: number[] = [];
  const stop = startBoundedPoll(async () => {
    starts.push(Date.now());
    return false;
  }, { intervalMs: 10, timeoutMs: 20, maxBackoffMs: 80 });
  await sleep(120);
  stop();
  visibility.restore();
  assert.ok(starts.length >= 2 && starts.length <= 3, `starts=${starts}`);
  assert.ok(starts[1] - starts[0] >= 18);
});
