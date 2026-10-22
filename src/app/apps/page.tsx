"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FocusablePanel, PanelFocusButton } from "@/components/shell/PanelFocus";

// Apps inside Mission Control: other web apps in an embedded frame, so Dennis does not
// have to leave Mission Control. Sites that forbid embedding (X-Frame-Options / CSP
// frame-ancestors) stay blank in the frame; "Open in tabblad" always works.

// mode: "frame"  = shown directly in the frame (same-origin pages, sites that allow embedding)
//       "server" = opened as a tab in the server browser (/browser/), so logins and private
//                  network addresses work; the frame then shows that server browser.
type AppMode = "frame" | "server";
interface WebApp { id: string; name: string; url: string; mode?: AppMode; note?: string }

const SERVER_BROWSER: WebApp = { id: "browser", name: "Browser", url: "/browser/", mode: "frame" };
const DEFAULT_APPS: WebApp[] = [
  SERVER_BROWSER,
  { id: "obsidian-graph", name: "Kennisgraaf", url: "/graph", mode: "frame" },
  { id: "paperclip", name: "Paperclip", url: "http://72.61.91.176:3100/VIR/dashboard", mode: "server" },
  { id: "n8n", name: "n8n", url: "https://n8n.vireonhq.cloud/home/workflows", mode: "server" },
  { id: "openclaw", name: "OpenClaw Control", url: "http://172.19.0.1:18790/", mode: "server" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", mode: "server" },
  { id: "base44", name: "Base44", url: "https://app.base44.com", mode: "server" },
  { id: "google", name: "Google", url: "https://www.google.com/", mode: "server" },
  { id: "omi", name: "Omi", url: "", note: "Omi heeft op je server geen eigen webscherm: het is gekoppeld via MCP/API. Je Omi-herinneringen zie je in Memory (Shared Brain)." },
  { id: "portmontage", name: "PortMontage", url: "", mode: "server" },
];
const STORE_KEY = "mc.webapps.v1";
// Old embedded-Google default (unauthenticated frame context); migrated to the server browser where Dennis is signed in.
const LEGACY_GOOGLE_URL = "https://www.google.com/webhp?igu=1";
// One Selkies viewer can be primary at a time; a server app is not re-opened as a new tab within this window.
const REOPEN_GUARD_MS = 10 * 60 * 1000;
// Wall clock for the reopen guard; only used in event handlers, never during render.
function nowMs(): number { return Date.now(); }
const ACTIVE_KEY = "mc.apps.active.v1";
const OPENED_KEY = "mc.apps.opened.v1";
function readSession<T>(key: string, fallback: T): T {
  try { const raw = window.sessionStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeSession(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: ignore */ }
}

function loadApps(): WebApp[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_APPS;
    const parsed = JSON.parse(raw) as WebApp[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_APPS;
    // Keep operator-edited URLs, append newly discovered launch entries without overwriting preferences.
    const present = new Set(parsed.filter(app => app && typeof app.id === "string").map(app => app.id));
    const defaults = new Map(DEFAULT_APPS.map(app => [app.id, app]));
    const saved = parsed
      .filter(app => app && typeof app.id === "string" && typeof app.name === "string" && typeof app.url === "string")
      .map(app => {
        const def = defaults.get(app.id);
        if (!def) return app;
        // built-in entry: keep an address the operator filled in, otherwise take the verified default
        const url = app.id === "google" && app.url === LEGACY_GOOGLE_URL ? def.url : (app.url || def.url);
        return { ...def, url, name: def.name };
      });
    return [...saved, ...DEFAULT_APPS.filter(app => !present.has(app.id))];
  } catch {
    return DEFAULT_APPS;
  }
}

function isInternalPage(app: WebApp): boolean {
  return app.url.startsWith("/") && !app.url.startsWith("//") && app.url !== SERVER_BROWSER.url;
}

function saveApps(apps: WebApp[]) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(apps)); } catch { /* storage unavailable: keep in memory */ }
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export default function AppsPage() {
  const router = useRouter();
  const [apps, setApps] = useState<WebApp[]>(DEFAULT_APPS);
  const [activeId, setActiveId] = useState<string>(DEFAULT_APPS[0].id);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the operator's saved app list once in the browser
    setApps(loadApps());
    // Return to the tile the operator last used (the server browser itself keeps its own tabs); no new tab is opened here.
    setActiveId(readSession<string>(ACTIVE_KEY, DEFAULT_APPS[0].id));
  }, []);

  const active = apps.find((app) => app.id === activeId) ?? apps[0];
  const activeMode: AppMode = active?.mode ?? "frame";
  const [openState, setOpenState] = useState<{ appId: string; status: "busy" | "ok" | "already" | "error"; message?: string } | null>(null);
  // One persistent server-browser viewer for the whole Apps page (Selkies allows one primary client).
  const [viewerKey, setViewerKey] = useState(0);
  const [viewerDetached, setViewerDetached] = useState(false);
  const [viewerTerminated, setViewerTerminated] = useState(false);
  const viewerRef = useRef<HTMLIFrameElement | null>(null);
  const isViewerApp = Boolean(active) && (activeMode === "server" || active?.url === SERVER_BROWSER.url);

  useEffect(() => {
    // Read the same-origin viewer page: Selkies shows "Connection Terminated: ..." when another primary client took over.
    if (viewerDetached) return;
    const timer = window.setInterval(() => {
      const textOf = (doc: Document | null | undefined, depth: number): string => {
        if (!doc || depth > 2) return "";
        let text = "";
        try { text = doc.body?.innerText ?? ""; } catch { return ""; }
        for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
          try { text += "\n" + textOf(frame.contentDocument, depth + 1); } catch { /* cross-origin: ignore */ }
        }
        return text;
      };
      let doc: Document | null = null;
      try { doc = viewerRef.current?.contentDocument ?? null; } catch { doc = null; }
      setViewerTerminated(/Connection Terminated/i.test(textOf(doc, 0)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [viewerDetached, viewerKey]);

  function reconnectViewer() {
    setViewerTerminated(false);
    setViewerDetached(false);
    setViewerKey((key) => key + 1);
  }

  function detachViewerToTab() {
    window.open(SERVER_BROWSER.url, "_blank", "noopener");
    setViewerDetached(true);
    setViewerTerminated(false);
  }

  async function openInServerBrowser(app: WebApp, force = false) {
    if (!app.url) return;
    const last = readSession<Record<string, number>>(OPENED_KEY, {})[app.id] ?? 0;
    if (!force && nowMs() - last < REOPEN_GUARD_MS) {
      setOpenState({ appId: app.id, status: "already" });
      return;
    }
    setOpenState({ appId: app.id, status: "busy" });
    try {
      const response = await fetch("/api/apps/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: app.url }) });
      const body = await response.json() as { ok: boolean; error?: string; result?: string };
      if (body.ok) writeSession(OPENED_KEY, { ...readSession<Record<string, number>>(OPENED_KEY, {}), [app.id]: nowMs() });
      setOpenState({ appId: app.id, status: body.ok ? "ok" : "error", message: body.ok ? undefined : (body.error ?? body.result ?? "mislukt") });
    } catch (error) {
      setOpenState({ appId: app.id, status: "error", message: error instanceof Error ? error.message : "mislukt" });
    }
  }

  function selectApp(app: WebApp) {
    // Mission Control's own pages (e.g. /graph) are opened as pages, never framed: a framed MC page nests the whole
    // shell and can start a second server-browser viewer that takes over the first (single primary).
    if (isInternalPage(app)) { router.push(app.url); return; }
    setActiveId(app.id);
    writeSession(ACTIVE_KEY, app.id);
    if ((app.mode ?? "frame") === "server" && app.url) void openInServerBrowser(app);
  }

  function update(next: WebApp[]) {
    setApps(next);
    saveApps(next);
  }

  function setUrl(id: string, url: string) {
    update(apps.map((app) => (app.id === id ? { ...app, url: normalizeUrl(url) } : app)));
  }

  function addApp() {
    const name = newName.trim();
    const url = normalizeUrl(newUrl);
    if (!name || !url) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nowMs().toString(36)}`;
    update([...apps, { id, name, url }]);
    setActiveId(id);
    setNewName("");
    setNewUrl("");
  }

  function removeApp(id: string) {
    const next = apps.filter((app) => app.id !== id);
    update(next.length > 0 ? next : DEFAULT_APPS);
    if (activeId === id) setActiveId((next[0] ?? DEFAULT_APPS[0]).id);
  }

  return (
    <div className="mc-apps-page">
      <div className="mc-apps-tabs">
        {apps.map((app) => (
          <button key={app.id} type="button" onClick={() => selectApp(app)}
            className={"mc-apps-tab " + (app.id === active?.id ? "mc-apps-tab-active" : "")}>
            {app.name}
          </button>
        ))}
        <button type="button" className="mc-apps-tab mc-apps-tab-edit" onClick={() => setEditing((open) => !open)}>
          {editing ? "Klaar" : "Apps beheren"}
        </button>
      </div>

      {editing && (
        <section className="mc-apps-editor">
          {apps.map((app) => (
            <div key={app.id} className="mc-apps-editor-row">
              <span className="mc-apps-editor-name">{app.name}</span>
              <input defaultValue={app.url} placeholder="https://…" onBlur={(event) => setUrl(app.id, event.target.value)} className="mc-apps-input mono" />
              <select value={app.mode ?? "frame"} onChange={(event) => update(apps.map((item) => item.id === app.id ? { ...item, mode: event.target.value as AppMode } : item))} className="mc-apps-input mc-apps-input-mode">
                <option value="frame">In venster</option>
                <option value="server">Via server-browser</option>
              </select>
              <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => removeApp(app.id)}>Verwijderen</button>
            </div>
          ))}
          <div className="mc-apps-editor-row">
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Naam" className="mc-apps-input mc-apps-input-name" />
            <input value={newUrl} onChange={(event) => setNewUrl(event.target.value)} placeholder="Adres, bijv. n8n.jouwdomein.nl" className="mc-apps-input mono" />
            <button type="button" className="mc-button mc-button-success mc-button-sm" onClick={addApp}>Toevoegen</button>
          </div>
        </section>
      )}

      {active && (
        <FocusablePanel id={`webapp-${active.id}`} label={`App · ${active.name}`} className="mc-apps-panel" inlineControls>
          <section className="mc-apps-frame-wrap">
            <header className="mc-apps-frame-head">
              <span className="font-semibold">{active.name}</span>
              <span className="mono text-[11px] text-muted truncate min-w-0 flex-1">{active.url || "nog geen adres ingesteld"}</span>
              {activeMode === "server" && active.url && (
                <>
                  <span className="text-[11px] text-muted">{openState?.appId === active.id ? (openState.status === "busy" ? "tabblad openen in server-browser…" : openState.status === "ok" ? "tabblad-opdracht uitgevoerd in server-browser" : openState.status === "already" ? "staat al als tabblad open in de server-browser" : `niet gelukt: ${openState.message ?? ""}`) : "via server-browser"}</span>
                  <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => void openInServerBrowser(active, true)}>Nieuw tabblad in server-browser</button>
                </>
              )}
              {active.url && <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => (isViewerApp ? reconnectViewer() : setFrameKey((key) => key + 1))}>Herladen</button>}
              {isViewerApp && <button type="button" className="mc-button mc-button-secondary mc-button-sm" title="Opent de server-browser in een eigen tabblad; het kijkvenster hier wordt dan losgekoppeld (er kan er maar één tegelijk)." onClick={detachViewerToTab}>Server-browser in eigen tabblad</button>}
              {activeMode === "server" && active.url && <a href={active.url} target="_blank" rel="noreferrer" title="Opent op je eigen pc in je gewone browser, met de inlog van die browser — niet in de server-browser." className="mc-button mc-button-secondary mc-button-sm">Lokaal openen</a>}
              {!isViewerApp && active.url && <a href={active.url} target="_blank" rel="noreferrer" className="mc-button mc-button-secondary mc-button-sm">Open in tabblad</a>}
              <PanelFocusButton />
            </header>
            <div className="mc-apps-stack">
              {!viewerDetached && (
                <iframe key={`server-viewer-${viewerKey}`} ref={viewerRef} src={SERVER_BROWSER.url} title="Server-browser" className="mc-apps-frame mc-apps-stack-layer"
                  aria-hidden={!isViewerApp}
                  style={isViewerApp ? undefined : { visibility: "hidden", pointerEvents: "none" }}
                  allow="clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera" />
              )}
              {isViewerApp && viewerDetached && (
                <div className="mc-apps-empty mc-apps-stack-layer">
                  <div className="grid gap-2 justify-items-center text-center">
                    <span>De server-browser staat open in een eigen tabblad. Er kan maar één kijkvenster tegelijk verbonden zijn.</span>
                    <button type="button" className="mc-button mc-button-success mc-button-sm" onClick={reconnectViewer}>Hier terughalen</button>
                  </div>
                </div>
              )}
              {isViewerApp && !viewerDetached && viewerTerminated && (
                <div className="mc-apps-viewer-banner">
                  <span>Kijkvenster losgekoppeld: een ander venster nam de server-browser over.</span>
                  <button type="button" className="mc-button mc-button-success mc-button-sm" onClick={reconnectViewer}>Weer verbinden</button>
                </div>
              )}
              {!isViewerApp && active.url && (
                <iframe key={`${active.id}-${frameKey}`} src={active.url} title={active.name} className="mc-apps-frame mc-apps-stack-layer"
                  referrerPolicy="no-referrer"
                  sandbox={active.url.startsWith("/") ? undefined : "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"}
                  allow="clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera" />
              )}
              {!active.url && (
                <div className="mc-apps-empty mc-apps-stack-layer">

                {active.note ?? <>Voor {active.name} is nog geen geverifieerd browseradres beschikbaar. De connector/API-health is geen bewijs van een interactieve webinterface. Voeg via &ldquo;Apps beheren&rdquo; uitsluitend een echt bereikbaar UI-adres toe.</>}
                </div>
              )}
            </div>
            {active.url && <div className="mc-apps-note">{isViewerApp ? <>{active.name === SERVER_BROWSER.name ? "Dit is een echte browser op je server" : `${active.name} draait in de browser op je server`}: inloggen werkt daar en blijft bewaard. Eén kijkvenster tegelijk; wisselen tussen apps houdt de verbinding open.</> : active.url.startsWith("/") ? <>Onderdeel van Mission Control.</> : <>Inloggen (Google, Microsoft enz.) kan niet binnen een ander venster: die sites staan dat niet toe. Gebruik &ldquo;Open in tabblad&rdquo; of zet de app via &ldquo;Apps beheren&rdquo; op &ldquo;Via server-browser&rdquo;.</>}</div>}
          </section>
        </FocusablePanel>
      )}
    </div>
  );
}
