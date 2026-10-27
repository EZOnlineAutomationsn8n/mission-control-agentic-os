"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NativeStageTransportPanel } from "./NativeStageTransportPanel";
import { PanelFocusButton } from "@/components/shell/PanelFocus";
import type { AgentConversationEntry } from "@/lib/agent-conversations/types";
import type { AttachmentReference } from "@/lib/attachments/types";
import { getCockpitAgentByApiId, getCockpitAgentTarget } from "@/lib/cockpit/agent-registry";
import { getCockpitRoutePresentation } from "@/lib/cockpit-route-presentation";
import { reconstructSpeechTranscript } from "@/lib/cockpit/speech-transcript";

const DEFAULT_SESSION_ID = "operator-default";
const CLIENT_TIMEOUT_MS = 660000;
const COMPOSER_MIN_HEIGHT_PX = 104; // roughly four comfortable work-order lines before growth
const COMPOSER_MAX_HEIGHT_PX = 260; // keep history usable; longer prompts scroll inside the composer
const COMPOSER_BORDER_ALLOWANCE_PX = 2;
const NOTICE_INLINE_LIMIT = 280;

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

interface RuntimeTruthView {
  targetId: string;
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
}

interface AgentSessionView {
  sessionKey: string;
  claudeSessionId?: string;
  runtimeSessionId?: string;
  displayName: string;
  workspace: string;
  permissionMode: string;
  executionMode: string;
  status: "starting" | "prepared" | "idle" | "running" | "stopped" | "error";
  active: boolean;
  lastError: string | null;
  profileId?: string | null;
  projectId?: string | null;
  role?: string | null;
  assignmentPath?: string | null;
  agentRuntime?: string | null;
  transportModelAlias?: string | null;
  actualRuntimeModel?: string | null;
}


function statusClass(status: AgentConversationEntry["status"]): string {
  return status === "completed" ? "text-ok" : status === "timeout" ? "text-warn" : "text-danger";
}

type UiIconName = "paperclip" | "image" | "mic" | "trash" | "send" | "copy";

function UiIcon({ name }: { name: UiIconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="mc-icon" aria-hidden="true">
      {name === "paperclip" && <path {...common} d="m20.5 11.5-8.8 8.8a5.1 5.1 0 0 1-7.2-7.2l9.5-9.5a3.5 3.5 0 0 1 5 5l-9.6 9.6a1.9 1.9 0 0 1-2.7-2.7l8.9-8.9" />}
      {name === "image" && <><rect {...common} x="3" y="5" width="18" height="14" rx="2" /><circle {...common} cx="8.5" cy="10" r="1.5" /><path {...common} d="m5 17 4.5-4.5 3.2 3.1 2.1-2.1L19 17" /></>}
      {name === "mic" && <><rect {...common} x="9" y="3" width="6" height="11" rx="3" /><path {...common} d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></>}
      {name === "trash" && <><path {...common} d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>}
      {name === "send" && <><path {...common} d="m3 11 17-8-7.5 18-2.2-7.3L3 11Z" /><path {...common} d="m10.3 13.7 4.5-4.5" /></>}
      {name === "copy" && <><rect {...common} x="8" y="8" width="11" height="11" rx="2" /><path {...common} d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>}
    </svg>
  );
}

function MessageText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return (
    <div className="text-sm leading-6 text-foreground/90">
      {parts.map((part, index) => part.startsWith("```") && part.endsWith("```")
        ? <pre key={index} className="mc-code-block"><code>{part.slice(3, -3).trim()}</code></pre>
        : <span key={index} className="whitespace-pre-wrap break-words">{part}</span>)}
    </div>
  );
}

// Session / request notices. In the terminal pane they live inside the single conversation
// scroll and never get a scrollbar of their own: short text is shown inline, oversized
// technical output collapses behind a one-line summary.
function StreamNotice({ tone, title, text, terminal }: { tone: "warn" | "danger"; title?: string; text: string; terminal: boolean }) {
  const toneClass = tone === "warn" ? "border border-warn/40 bg-warn/10 text-warn" : "bg-danger/10 text-danger";
  const full = title ? `${title}: ${text}` : text;
  if (!terminal) {
    return <div role="alert" className={`rounded ${toneClass} p-2 text-xs shrink-0 ${tone === "warn" ? "max-h-32" : "max-h-24"} overflow-y-auto whitespace-pre-wrap break-words`}>{full}</div>;
  }
  if (full.length <= NOTICE_INLINE_LIMIT) {
    return <div role="alert" className={`rounded ${toneClass} p-2 text-xs whitespace-pre-wrap break-words`}>{full}</div>;
  }
  const firstLine = full.split("\n", 1)[0];
  return (
    <details role="alert" className={`rounded ${toneClass} text-xs`}>
      <summary className="cursor-pointer select-none truncate p-2">{firstLine.length > 110 ? `${firstLine.slice(0, 110)}…` : firstLine}</summary>
      <div className="border-t border-white/10 p-2 whitespace-pre-wrap break-words">{full}</div>
    </details>
  );
}

export function AgentConversationPanel({
  agentId,
  endpoint,
  label,
  terminal = false,
  sessionId: requestedSessionId,
  targetId: requestedTargetId,
}: {
  agentId: string;
  endpoint: string;
  label: string;
  terminal?: boolean;
  sessionId?: string;
  targetId?: string;
}) {
  const [entries, setEntries] = useState<AgentConversationEntry[]>([]);
  const [session, setSession] = useState<AgentSessionView | null>(null);
  const [runtimeTruth, setRuntimeTruth] = useState<RuntimeTruthView | null>(null);
  const [bootstrap, setBootstrap] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentReference[]>([]);
  const [uploading, setUploading] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceNeedsReview, setVoiceNeedsReview] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<{ prompt: string; attachments: AttachmentReference[] } | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const scrollSurface = useRef<HTMLDivElement>(null);
  // A replaced pane binding must not be overwritten by an older late read.
  // This is UI request bookkeeping only, never session ownership.
  const loadEpoch = useRef(0);

  const target = (requestedTargetId ? getCockpitAgentTarget(requestedTargetId) : undefined) ?? getCockpitAgentByApiId(agentId);
  const routePresentation = target ? getCockpitRoutePresentation(target) : null;
  const sessionId = requestedSessionId ?? target?.defaultSessionId ?? DEFAULT_SESSION_ID;
  const historyEndpoint = `/api/agent-conversations/${agentId}/${sessionId}`;
  const sessionEndpoint = `/api/connectors/${agentId}/session?sessionId=${sessionId}`;
  const runtimeSessionId = session?.runtimeSessionId ?? session?.claudeSessionId ?? null;
  const latestObservedEntry = [...entries].reverse().find((entry) => entry.status === "completed");
  const processLabel = target?.processLabel ?? "persistent on-demand agent session";
  const runtimeLabel = runtimeTruth?.runtime ?? session?.agentRuntime ?? routePresentation?.runtimeIdentity ?? target?.runtimeFallback ?? "UNKNOWN";
  const installedVersionLabel = runtimeTruth?.installedVersion ?? "not verified";
  const providerLabel = latestObservedEntry?.provider ?? runtimeTruth?.provider ?? routePresentation?.configuredProvider ?? "UNKNOWN";
  const modelLabel = latestObservedEntry?.actualRuntimeModel ?? runtimeTruth?.actualModel ?? session?.actualRuntimeModel ?? routePresentation?.configuredModel ?? "UNKNOWN";
  const transportLabel = latestObservedEntry?.transportModelAlias ?? runtimeTruth?.transport ?? session?.transportModelAlias ?? "UNKNOWN";
  const routeTypeLabel = routePresentation?.routeType ?? "NORMAL";
  const routeStatusLabel = session?.status === "error" ? "BLOCKED" : routePresentation?.routeStatus ?? "UNKNOWN";
  const projectLabel = runtimeTruth?.project === "mission-control" ? "Mission Control" : runtimeTruth?.project ?? (session?.projectId === "mission-control" ? "Mission Control" : session?.projectId ?? "not assigned");
  const assignmentLabel = session?.assignmentPath?.split("/").at(-1)?.replace(/\.md$/i, "") ?? "not assigned";

  const loadState = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    const isCurrent = () => epoch === loadEpoch.current;
    try {
      // A real persisted session is the primary operator truth. Never make
      // this READY/PREPARED state wait on the optional runtime diagnostics.
      const response = await fetch(sessionEndpoint, { cache: "no-store" });
      const data = await response.json() as { session?: AgentSessionView | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? `session returned HTTP ${response.status}`);
      if (!isCurrent()) return;
      setSession(data.session ?? null);
      setLoadError(null);
      setLoading(false);
      // History belongs to the session, not to the pane. Read it independently
      // after the selected session was established; never lose the session on
      // a transient history or optional-diagnostic failure.
      try {
        const historyResponse = await fetch(historyEndpoint, { cache: "no-store" });
        const historyData = await historyResponse.json() as { entries?: AgentConversationEntry[]; error?: string };
        if (!historyResponse.ok) throw new Error(historyData.error ?? `history returned HTTP ${historyResponse.status}`);
        if (isCurrent()) setEntries(historyData.entries ?? []);
      } catch (error) {
        if (isCurrent()) setLoadError(error instanceof Error ? error.message : "Session history unavailable");
      }
      if (!isCurrent()) return;
      // A PREPARED native session has not executed. There is no live runtime
      // observation to look up; preserve UNKNOWN rather than invent readiness.
      if (!data.session || data.session.status === "prepared") {
        setRuntimeTruth(null);
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6_000);
      try {
        const runtimeResponse = await fetch("/api/cockpit/runtime-truth", {
          cache: "no-store", signal: controller.signal,
        });
        if (runtimeResponse.ok) {
          const runtimeData = await runtimeResponse.json() as { runtimes?: RuntimeTruthView[] };
          if (isCurrent()) setRuntimeTruth(runtimeData.runtimes?.find((entry) => entry.targetId === target?.id) ?? null);
        }
      } catch {
        // Optional evidence unavailable; neither session nor history are reset.
        if (isCurrent()) setRuntimeTruth(null);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (isCurrent()) setLoadError(error instanceof Error ? error.message : `${label} session state unavailable`);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [historyEndpoint, label, sessionEndpoint, target?.id]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadState();
    });
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  useEffect(() => {
    return () => {
      speechRecognition.current?.abort();
      speechRecognition.current = null;
    };
  }, []);

  // The composer grows with its text and never scrolls internally; the pane owns the only scrollbar.
  const sizeComposer = useCallback(() => {
    const composer = composerInput.current;
    if (!composer) return;
    const surface = scrollSurface.current;
    const inStream = surface?.contains(composer) ?? false;
    const previousScrollTop = surface?.scrollTop ?? 0;
    composer.style.height = "auto";
    // An empty composer is always one compact line: a wrapped placeholder must not inflate it.
    const contentHeight = composer.value ? composer.scrollHeight + COMPOSER_BORDER_ALLOWANCE_PX : 0;
    const nextHeight = Math.min(Math.max(contentHeight, COMPOSER_MIN_HEIGHT_PX), COMPOSER_MAX_HEIGHT_PX);
    composer.style.height = `${nextHeight}px`;
    composer.style.overflowY = contentHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
    if (surface && inStream) {
      const typingAtEnd = document.activeElement === composer && composer.selectionStart === composer.value.length;
      surface.scrollTop = typingAtEnd ? surface.scrollHeight : previousScrollTop;
    }
  }, []);

  useEffect(() => {
    sizeComposer();
  }, [prompt, sizeComposer]);

  // Re-fit the composer when the pane width changes (text re-wraps).
  useEffect(() => {
    const composer = composerInput.current;
    if (!composer || typeof ResizeObserver === "undefined") return;
    let lastWidth = composer.clientWidth;
    const observer = new ResizeObserver(() => {
      if (composer.clientWidth === lastWidth) return;
      lastWidth = composer.clientWidth;
      sizeComposer();
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, [sizeComposer]);

  // Jump to the newest turn / next-prompt composer on first load, on send and when a requested
  // turn finishes. Passive refreshes never move the viewport, so reading old history is not fought.
  // Runs synchronously after the composer has been sized (no requestAnimationFrame: that is
  // suspended while the browser tab is in the background, which is exactly when turns finish).
  useEffect(() => {
    if (loading) return;
    const surface = scrollSurface.current;
    if (surface) surface.scrollTop = surface.scrollHeight;
  }, [loading, scrollTick]);

  async function copyMessage(text: string, messageKey: string) {
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch {
          // Embedded and tunneled browsers can expose Clipboard API while denying writes.
        }
      }
      if (!copied) {
        const fallback = document.createElement("textarea");
        fallback.value = text;
        fallback.setAttribute("readonly", "");
        fallback.style.position = "fixed";
        fallback.style.left = "-9999px";
        fallback.style.opacity = "0";
        document.body.appendChild(fallback);
        fallback.select();
        copied = document.execCommand("copy");
        fallback.remove();
      }
      if (!copied) throw new Error("browser rejected clipboard copy");
      setCopiedMessage(messageKey);
      window.setTimeout(() => setCopiedMessage((current) => current === messageKey ? null : current), 1600);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "message copy failed");
    }
  }

  function toggleVoiceInput() {
    if (listening) {
      speechRecognition.current?.stop();
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setLoadError("Speech input is not supported by this browser.");
      return;
    }

    const recognition = new Recognition();
    const promptBeforeDictation = prompt;
    recognition.lang = "nl-NL";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      // Each event.results is the complete indexed recognition snapshot.
      // Never append repeated final results as if the event were a delta.
      setPrompt(reconstructSpeechTranscript(promptBeforeDictation, event).text);
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setLoadError(`Speech input failed: ${event.error}`);
      }
    };
    recognition.onend = () => {
      speechRecognition.current = null;
      setListening(false);
    };

    try {
      speechRecognition.current = recognition;
      setLoadError(null);
      recognition.start();
      setVoiceNeedsReview(true);
      setListening(true);
    } catch (error) {
      speechRecognition.current = null;
      setListening(false);
      setLoadError(error instanceof Error ? error.message : "speech input could not start");
    }
  }

  async function lifecycle(action: "start" | "stop") {
    if (running) return;
    setRunning(true);
    setLoadError(null);
    setBootstrap(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch(sessionEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal: controller.signal,
      });
      const data = (await response.json()) as {
        session?: AgentSessionView | null;
        bootstrap?: string;
        error?: string;
        auditError?: string;
      };
      if (!response.ok) throw new Error(data.error ?? data.auditError ?? `session action returned HTTP ${response.status}`);
      setSession(data.session ?? null);
      setBootstrap(data.bootstrap ?? (action === "stop" ? `${label} session stopped.` : null));
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const message = aborted ? `${label} start timed out in the browser. Refresh to read server state.` :
        error instanceof Error ? error.message : `${label} session action failed`;
      await loadState();
      setLoadError(message);
    } finally {
      clearTimeout(timer);
      setRunning(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || running || !session?.active || listening || voiceNeedsReview) return;
    const submittedPrompt = prompt.trim();
    const submittedAttachments = attachments;
    setRunning(true);
    setLoadError(null);
    // The prompt leaves the composer at once and becomes a card in the conversation flow.
    setPendingTurn({ prompt: submittedPrompt, attachments: submittedAttachments });
    setPrompt("");
    setAttachments([]);
    setScrollTick((tick) => tick + 1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: submittedPrompt, sessionId, attachments: submittedAttachments.map((attachment) => attachment.id) }),
        signal: controller.signal,
      });
      const data = (await response.json()) as AgentConversationEntry & { error?: string; auditError?: string };
      if (!data.id) throw new Error(data.auditError ?? data.error ?? `request returned HTTP ${response.status}`);
      setEntries((current) => [...current, data]);
      setPendingTurn(null);
      if (!response.ok) setLoadError(data.auditError ?? "request persisted but audit recording failed");
      await loadState();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const message = aborted ? `${label} turn timed out in the browser. Refresh to read the server-side result.` :
        error instanceof Error ? error.message : `${label} agent request failed`;
      await loadState();
      // No turn card came back for this request: hand the prompt back to the composer.
      setPrompt(submittedPrompt);
      setAttachments(submittedAttachments);
      setLoadError(message);
    } finally {
      clearTimeout(timer);
      setPendingTurn(null);
      setRunning(false);
      setScrollTick((tick) => tick + 1);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0 || uploading || busy) return;
    setUploading(true);
    setLoadError(null);
    try {
      const form = new FormData();
      form.set("agentId", agentId);
      form.set("sessionId", sessionId);
      Array.from(files).slice(0, 5).forEach((file) => form.append("files", file));
      const response = await fetch("/api/attachments", { method: "POST", body: form });
      const data = (await response.json()) as { attachments?: AttachmentReference[]; error?: string };
      if (!response.ok || !data.attachments) throw new Error(data.error ?? `upload returned HTTP ${response.status}`);
      setAttachments((current) => [...current, ...data.attachments!].slice(0, 5));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "attachment upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  async function clearConversation() {
    const response = await fetch(historyEndpoint, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "CLEAR CONVERSATION" }),
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      setLoadError(data.error ?? `clear returned HTTP ${response.status}`);
      return;
    }
    setEntries([]);
    setClearConfirm(false);
  }

  const active = session?.active === true;
  const busy = running || session?.status === "starting" || session?.status === "running";

  return (
    <div className={terminal ? "mc-terminal-surface h-full min-h-0 flex flex-col gap-2.5 p-3" : "rounded-lg border border-accent/40 bg-panel p-3 space-y-3"}>
      {terminal ? (
        <div className="mc-lifecycle-row flex items-center justify-end gap-1.5 shrink-0">
          <PanelFocusButton />
          {!active ? (
            <button type="button" onClick={() => void lifecycle("start")} disabled={busy}
              className="mc-button mc-button-success mc-button-sm" aria-label={`Start ${label} session`}>
              {busy ? "Starting…" : "Start"}
            </button>
          ) : (
            <button type="button" onClick={() => void lifecycle("stop")} disabled={busy}
              className="mc-button mc-button-danger mc-button-sm" aria-label={`Stop ${label} session`}>
              Stop
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 shrink-0 min-h-8 border-b border-border/70 pb-2">
          <span className="text-[14px] font-semibold tracking-tight text-foreground truncate">{label}</span>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${busy ? "border-warn/30 bg-warn/10 text-warn" : active ? "border-ok/30 bg-ok/10 text-ok" : "border-border bg-panel-2 text-muted"}`}>
              {busy ? "Running" : active ? (session?.status ?? "idle") : "Stopped"}
            </span>
            {!active ? (
              <button type="button" onClick={() => void lifecycle("start")} disabled={busy}
                className="mc-button mc-button-success mc-button-sm" aria-label={`Start ${label} session`}>
                {busy ? "Starting…" : "Start"}
              </button>
            ) : (
              <button type="button" onClick={() => void lifecycle("stop")} disabled={busy}
                className="mc-button mc-button-danger mc-button-sm" aria-label={`Stop ${label} session`}>
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className="mc-route-identity-strip grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-border/80 bg-panel-2/70 px-2.5 py-2 text-[10px] mono shrink-0 lg:grid-cols-6"
        data-route-identity={routeTypeLabel}
        title={routePresentation?.routeStatusDetail ?? "Route presentation evidence unavailable"}
      >
        <div><span className="text-muted">AGENT</span><div className="text-accent truncate">{label}</div></div>
        <div><span className="text-muted">ROUTE_TYPE</span><div className="text-foreground font-semibold">{routeTypeLabel}</div></div>
        <div><span className="text-muted">RUNTIME</span><div className="text-foreground truncate">{runtimeLabel}</div></div>
        <div><span className="text-muted">PROVIDER</span><div className="text-foreground truncate">{providerLabel}</div></div>
        <div><span className="text-muted">MODEL</span><div className="text-foreground truncate">{modelLabel}</div></div>
        <div><span className="text-muted">ROUTE_STATUS</span><div className={routeStatusLabel === "BLOCKED" ? "text-danger font-semibold" : "text-foreground font-semibold"}>{routeStatusLabel}</div></div>
      </div>

      {/* Terminal panes: everything below the header is ONE scroll surface (notices, turns, composer). */}
      <div ref={terminal ? scrollSurface : undefined} className={terminal ? "flex-1 min-h-0 overflow-y-auto pr-1 space-y-2.5" : "space-y-3"} data-conversation-stream={terminal ? "true" : undefined}>
      {session?.status==="prepared" && (agentId==="hermes"||agentId==="openclaw") && <p role="status" data-testid="stage-native-prepared"
        className="rounded border border-warn/40 p-2 text-xs text-warn">
        Werkplaats-native CLI gecontroleerd met eigen geïsoleerd profiel. De sessie is voorbereid,
        maar de provider- en gratis transportgrens is nog niet bewezen.
        Modelverzoeken zijn geblokkeerd; ACF mag deze sessie nog niet ELIGIBLE noemen.
      </p>}
      {session?.status==="prepared" && (agentId==="hermes"||agentId==="openclaw") &&
        sessionId.startsWith("acf-werkplaats-") &&
        <NativeStageTransportPanel agentId={agentId}/>}
      {session?.status==="prepared" && agentId==="gemini" && sessionId.startsWith("acf-werkplaats-") && <p
        role="status" data-testid="gemini-staged-prepared"
        className="rounded border border-warn/40 p-2 text-xs text-warn">
        Gemini Werkplaats-sessie alleen voorbereid: geen verborgen bootstrap, modelbeurt of bevestigde native login.
        Jouw eerste eigen Verstuur probeert de bestaande Gemini CLI te bereiken. ACF mag deze sessie pas na
        aantoonbaar geslaagde uitvoering en persistente history bindbaar noemen.
      </p>}
      {session?.status==="prepared" && agentId==="codex" && <p role="status" data-testid="codex-staged-prepared"
        className="rounded border border-accent/40 p-2 text-xs text-accent">
        Codex Werkplaats-sessie voorbereid zonder modelaanvraag. ChatGPT CLI-login is geverifieerd;
        er is nog geen native thread. Alleen je eerste eigen bericht start de nieuwe stage-thread.
        ACF meldt pas ELIGIBLE na een echte succesvolle beurt.
      </p>}
      {session?.lastError && <StreamNotice tone="warn" title="Runtime blocker" text={session.lastError} terminal={terminal} />}
      {!terminal && loadError && <StreamNotice tone="danger" text={loadError} terminal={false} />}

      {terminal ? (
        <details className="mc-disclosure shrink-0">
          <summary>Details / Diagnostics</summary>
          <div className="mc-diagnostics-scroll">
            <section className="mc-diagnostic-group">
              <div className="mc-diagnostic-heading">IDENTITY</div>
              <div className="mc-diagnostic-grid">
                <div><span className="mc-diagnostic-label">Agent</span><span className="mc-diagnostic-value">{runtimeTruth?.agentIdentity ?? label}</span></div>
                <div><span className="mc-diagnostic-label">Route type</span><span className="mc-diagnostic-value">{routeTypeLabel}</span></div>
                <div><span className="mc-diagnostic-label">Route status</span><span className="mc-diagnostic-value">{routeStatusLabel}</span></div>
                <div><span className="mc-diagnostic-label">Profile</span><span className="mc-diagnostic-value">{session?.profileId ?? agentId}</span></div>
                <div><span className="mc-diagnostic-label">Project</span><span className="mc-diagnostic-value">{projectLabel}</span></div>
                <div><span className="mc-diagnostic-label">Role</span><span className="mc-diagnostic-value">{session?.role ?? "not declared"}</span></div>
              </div>
            </section>
            <section className="mc-diagnostic-group">
              <div className="mc-diagnostic-heading">RUNTIME</div>
              <div className="mc-diagnostic-grid">
                <div><span className="mc-diagnostic-label">Runtime</span><span className="mc-diagnostic-value">{runtimeLabel}</span></div>
                <div><span className="mc-diagnostic-label">Model</span><span className="mc-diagnostic-value">{modelLabel}</span></div>
                <div><span className="mc-diagnostic-label">Installed version</span><span className="mc-diagnostic-value">{installedVersionLabel}</span></div>
                <div><span className="mc-diagnostic-label">Service version</span><span className="mc-diagnostic-value">{runtimeTruth?.runningServiceVersion ?? "not independently reported / not on chat path"}</span></div>
              </div>
            </section>
            <section className="mc-diagnostic-group">
              <div className="mc-diagnostic-heading">SESSION</div>
              <div className="mc-diagnostic-grid">
                <div><span className="mc-diagnostic-label">State</span><span className="mc-diagnostic-value">{session?.status ?? "not started"}</span></div>
                <div><span className="mc-diagnostic-label">Session key</span><span className="mc-diagnostic-value">{sessionId}</span></div>
                <div><span className="mc-diagnostic-label">Runtime session</span><span className="mc-diagnostic-value">{runtimeSessionId ?? "not started"}</span></div>
                <div><span className="mc-diagnostic-label">Permission mode</span><span className="mc-diagnostic-value">{session?.permissionMode ?? "runtime policy"}</span></div>
              </div>
            </section>
            <section className="mc-diagnostic-group">
              <div className="mc-diagnostic-heading">WORKSPACE</div>
              <div className="mc-diagnostic-grid">
                <div><span className="mc-diagnostic-label">Workspace</span><span className="mc-diagnostic-value">{runtimeTruth?.workspace ?? session?.workspace ?? "not verified"}</span></div>
                <div><span className="mc-diagnostic-label">Assignment</span><span className="mc-diagnostic-value">{assignmentLabel}</span></div>
              </div>
            </section>
            <section className="mc-diagnostic-group">
              <div className="mc-diagnostic-heading">TRANSPORT</div>
              <div className="mc-diagnostic-grid">
                <div><span className="mc-diagnostic-label">Provider</span><span className="mc-diagnostic-value">{providerLabel}</span></div>
                <div><span className="mc-diagnostic-label">Transport</span><span className="mc-diagnostic-value">{transportLabel}</span></div>
                <div className="col-span-2"><span className="mc-diagnostic-label">Interaction route</span><span className="mc-diagnostic-value">{processLabel}</span></div>
              </div>
            </section>
            <section className="mc-diagnostic-group">
              <div className="mc-diagnostic-heading">VERIFICATION</div>
              <div className="mc-diagnostic-grid">
                <div><span className="mc-diagnostic-label">Runtime verified</span><span className="mc-diagnostic-value">{runtimeTruth?.lastVerifiedAt ?? "not verified"}</span></div>
                <div><span className="mc-diagnostic-label">Historical runtime snapshot</span><span className="mc-diagnostic-value">{session?.agentRuntime ?? "not reported"}</span></div>
                <div className="col-span-2"><span className="mc-diagnostic-label">Route certification</span><span className="mc-diagnostic-value">{routePresentation?.certificationRef ?? "no certification bound"}</span></div>
              </div>
            </section>
          </div>
        </details>
      ) : (
        <>
          <div className="rounded border border-border/80 bg-panel-2/70 p-2 text-[10px] mono space-y-1.5">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div><span className="text-muted">Agent</span><div className="text-accent break-all">{runtimeTruth?.agentIdentity ?? label}</div></div>
              <div><span className="text-muted">Profile</span><div className="text-foreground break-all">{session?.profileId ?? agentId}</div></div>
              <div><span className="text-muted">Runtime</span><div className="text-foreground break-words">{runtimeLabel}</div></div>
              <div><span className="text-muted">Installed version</span><div className="text-foreground break-words">{installedVersionLabel}</div></div>
              <div><span className="text-muted">Service version</span><div className="text-foreground break-words">{runtimeTruth?.runningServiceVersion ?? "not independently reported / not on chat path"}</div></div>
              <div><span className="text-muted">Project</span><div className="text-foreground">{projectLabel}</div></div>
              <div><span className="text-muted">Provider</span><div className="text-foreground break-all">{providerLabel}</div></div>
              <div><span className="text-muted">Model</span><div className="text-foreground break-all">{modelLabel}</div></div>
              <div><span className="text-muted">Transport</span><div className="text-foreground break-all">{transportLabel}</div></div>
              <div><span className="text-muted">Session state</span><div className="text-foreground">{session?.status ?? "not started"}</div></div>
              <div><span className="text-muted">Role</span><div className="text-foreground break-words">{session?.role ?? "not declared"}</div></div>
              <div><span className="text-muted">Assignment</span><div className="text-foreground break-words">{assignmentLabel}</div></div>
            </div>
            <div className="border-t border-border/70 pt-1 text-muted break-all"><span>Workspace </span><span className="text-foreground/90">{runtimeTruth?.workspace ?? session?.workspace ?? "not verified"}</span></div>
            <div className="text-muted break-all"><span>Session </span><span className="text-foreground/90">{runtimeSessionId ?? "not started"}</span></div>
            <div className="text-muted break-all"><span>Runtime verified </span><span className="text-foreground/90">{runtimeTruth?.lastVerifiedAt ?? "not verified"}</span></div>
            {session?.agentRuntime && <div className="text-muted break-all"><span>Historical session runtime snapshot </span><span className="text-foreground/70">{session.agentRuntime}</span></div>}
          </div>
          <div className="rounded border border-border bg-panel-2 p-2 text-[10px] mono space-y-1">
            <div><span className="text-muted">Agent identity:</span> <span className={active ? "text-ok" : "text-foreground"}>{label}</span></div>
            <div><span className="text-muted">Agent runtime:</span> {runtimeLabel}</div>
            <div><span className="text-muted">Interaction route:</span> {processLabel}</div>
            <div><span className="text-muted">Session:</span> {runtimeSessionId ?? "not started"}</div>
            <div><span className="text-muted">Workspace:</span> {session?.workspace ?? "assigned when session starts"}</div>
            <div><span className="text-muted">Permission mode:</span> {session?.permissionMode ?? "runtime policy"}</div>
          </div>
        </>
      )}

      {bootstrap && (
        <div className="rounded bg-ok/10 border border-ok/30 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-ok mb-1">{label} session bootstrap</div>
          <div className="mono whitespace-pre-wrap">{bootstrap}</div>
        </div>
      )}

      <div ref={terminal ? undefined : scrollSurface} className={terminal ? "space-y-4" : "space-y-4 max-h-72 overflow-y-auto"} aria-label={`${label} conversation history`}>
        {loading && <div className="text-[13px] text-muted py-2">Loading {label} session...</div>}
        {!loading && entries.length === 0 && !pendingTurn && <div className="text-[13px] text-muted py-2">No {label} agent turns yet.</div>}
        {entries.map((entry) => (
          <article key={entry.id} className="space-y-2.5 border-b border-border/70 pb-4 last:border-0">
            <div className="mc-message-user">
              <div className="mc-message-speaker text-foreground">You</div>
              <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{entry.prompt}</div>
              <button type="button" onClick={() => void copyMessage(entry.prompt, `${entry.id}:prompt`)}
                className="mc-copy-button" aria-label="Copy your message">
                <UiIcon name="copy" /> {copiedMessage === `${entry.id}:prompt` ? "Copied" : "Copy"}
              </button>
            </div>
            <div className={`mc-message-agent mc-message-agent-${entry.status}`}>
              <div className={`mc-message-speaker ${statusClass(entry.status)}`}>{label} · {entry.status}</div>
              <MessageText text={entry.text ?? entry.error ?? "No output returned."} />
              <button type="button" onClick={() => void copyMessage(entry.text ?? entry.error ?? "No output returned.", `${entry.id}:response`)}
                className="mc-copy-button" aria-label={`Copy ${label} response`}>
                <UiIcon name="copy" /> {copiedMessage === `${entry.id}:response` ? "Copied" : "Copy"}
              </button>
            </div>
            {(entry.attachments ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(entry.attachments ?? []).map((attachment) => (
                  <span key={attachment.id} className="rounded-md bg-panel-2 border border-border px-2 py-1 text-[10px] text-muted">
                    {attachment.name} · {(attachment.size / 1024).toFixed(1)} KB
                  </span>
                ))}
              </div>
            )}
            <details className="mc-evidence">
              <summary>Evidence / provenance</summary>
              <div className="mc-evidence-body space-y-1">
                <div>response provenance: {entry.responseProvenance ?? "legacy response — provenance fields unavailable"}</div>
                <div>agent {entry.agentIdentity ?? label} · runtime {entry.agentRuntime ?? "not reported"} · installed {entry.installedVersion ?? "not reported"}</div>
                <div>session {entry.agentSessionId ?? "not reported"} · state {entry.sessionState ?? "not reported"} · duration {(entry.durationMs / 1000).toFixed(1)}s</div>
                <div>provider {entry.provider ?? "not independently reported"} · transport {entry.transportModelAlias ?? "not reported"}</div>
                <div>model {entry.actualRuntimeModel ?? "not reported"} · verified {entry.runtimeVerifiedAt ?? "not reported"}</div>
                <div>workspace {entry.workspace ?? "not reported"} · permission {entry.permissionMode ?? "not reported"}</div>
              </div>
            </details>
          </article>
        ))}
        {pendingTurn && (
          <article className="space-y-2.5 pb-1" aria-label={`${label} turn in progress`}>
            <div className="mc-message-user">
              <div className="mc-message-speaker text-foreground">You</div>
              <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{pendingTurn.prompt}</div>
              <button type="button" onClick={() => void copyMessage(pendingTurn.prompt, "pending:prompt")}
                className="mc-copy-button" aria-label="Copy your message">
                <UiIcon name="copy" /> {copiedMessage === "pending:prompt" ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mc-message-agent mc-message-agent-running">
              <div className="mc-message-speaker text-warn">{label} · running</div>
              <div className="text-sm leading-6 text-muted">Working on it…</div>
            </div>
            {pendingTurn.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingTurn.attachments.map((attachment) => (
                  <span key={attachment.id} className="rounded-md bg-panel-2 border border-border px-2 py-1 text-[10px] text-muted">
                    {attachment.name} · {(attachment.size / 1024).toFixed(1)} KB
                  </span>
                ))}
              </div>
            )}
          </article>
        )}
      </div>

      {terminal && loadError && <StreamNotice tone="danger" text={loadError} terminal />}

      <form onSubmit={submit} className="mc-composer-shell space-y-2.5 shrink-0 pt-2.5">
        <input ref={fileInput} type="file" multiple className="hidden"
          accept=".pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.heic,.svg,.zip"
          onChange={(event) => void uploadFiles(event.target.files)} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(event) => void uploadFiles(event.target.files)} />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label={`${label} pending attachments`}>
            {attachments.map((attachment) => (
              <button key={attachment.id} type="button" title="Remove from this prompt"
                onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))}
                className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">
                {attachment.name} ×
              </button>
            ))}
          </div>
        )}
        <textarea ref={composerInput} value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={busy || !active || listening} rows={1}
          placeholder={active ? `Send a prompt to ${label}...` : `Start ${label} before sending a prompt`}
          aria-label={`${label} agent prompt`}
          className="mc-composer overflow-hidden disabled:opacity-50"
          style={{ minHeight: COMPOSER_MIN_HEIGHT_PX }} />
        {voiceNeedsReview && (
          <div className="mc-voice-review" role="status" data-testid="voice-review">
            <span>{listening ? "Dictation in progress — stop the mic, then review your words." : "Review the dictated text. Nothing is sent automatically."}</span>
            {!listening && (
              <button type="button" className="mc-button mc-button-secondary mc-button-sm"
                onClick={() => setVoiceNeedsReview(false)} aria-label="Confirm dictated text for sending">
                Confirm text
              </button>
            )}
          </div>
        )}
        <div className="mc-toolbar">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy || uploading || attachments.length >= 5}
              className="mc-button mc-button-secondary" aria-label={`Attach files for ${label}`}>
              <UiIcon name="paperclip" /> {uploading ? "Uploading…" : "Files"}
            </button>
            <button type="button" onClick={() => cameraInput.current?.click()} disabled={busy || uploading || attachments.length >= 5}
              className="mc-button mc-button-secondary" aria-label={`Attach image for ${label}`}>
              <UiIcon name="image" /> Image
            </button>
            <button type="button" onClick={toggleVoiceInput} disabled={busy || !active}
              title="Speak Dutch into this prompt"
              className={`mc-button ${listening ? "mc-button-info" : "mc-button-secondary"}`}
              aria-label={listening ? `Stop voice input for ${label}` : `Start voice input for ${label}`}>
              <UiIcon name="mic" /> {listening ? "Stop mic" : "Mic"}
            </button>
            <button type="button" onClick={() => setClearConfirm(true)} disabled={busy || entries.length === 0}
              className="mc-button mc-button-danger mc-clear-history-desktop" aria-label={`Clear ${label} conversation history`}>
              <UiIcon name="trash" /> Clear history
            </button>
            <details className="mc-clear-history-mobile">
              <summary aria-label="More conversation options">More</summary>
              <button type="button" onClick={() => setClearConfirm(true)} disabled={busy || entries.length === 0}
                className="mc-button mc-button-danger mc-button-sm" aria-label="Clear conversation history on mobile">
                <UiIcon name="trash" /> Clear history
              </button>
            </details>
          </div>
          <button type="submit" disabled={busy || uploading || !active || listening || voiceNeedsReview || !prompt.trim()} className="mc-button mc-button-primary px-4">
            <UiIcon name="send" /> {busy ? `${label} running...` : "Send"}
          </button>
        </div>
      </form>

      {clearConfirm && (
        <div role="dialog" aria-label="Confirm clear conversation" className="rounded-lg border border-danger/35 bg-danger/10 p-3 text-xs space-y-2 shadow-lg">
          <div>This clears Mission Control conversation history. It does not delete the agent runtime session. Continue?</div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setClearConfirm(false)} className="mc-button mc-button-secondary mc-button-sm">Cancel</button>
            <button onClick={() => void clearConversation()} className="mc-button mc-button-danger mc-button-sm">Confirm clear</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
