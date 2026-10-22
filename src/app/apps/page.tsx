"use client";

import { useEffect, useState } from "react";
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
  { id: "google", name: "Google", url: "https://www.google.com/webhp?igu=1", mode: "frame" },
  { id: "omi", name: "Omi", url: "", note: "Omi heeft op je server geen eigen webscherm: het is gekoppeld via MCP/API. Je Omi-herinneringen zie je in Memory (Shared Brain)." },
  { id: "portmontage", name: "PortMontage", url: "", mode: "server" },
];
const STORE_KEY = "mc.webapps.v1";

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
        return { ...def, url: app.url || def.url, name: def.name };
      });
    return [...saved, ...DEFAULT_APPS.filter(app => !present.has(app.id))];
  } catch {
    return DEFAULT_APPS;
  }
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
  const [apps, setApps] = useState<WebApp[]>(DEFAULT_APPS);
  const [activeId, setActiveId] = useState<string>(DEFAULT_APPS[0].id);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the operator's saved app list once in the browser
    setApps(loadApps());
  }, []);

  const active = apps.find((app) => app.id === activeId) ?? apps[0];
  const activeMode: AppMode = active?.mode ?? "frame";
  const [openState, setOpenState] = useState<{ appId: string; status: "busy" | "ok" | "error"; message?: string } | null>(null);

  async function openInServerBrowser(app: WebApp) {
    if (!app.url) return;
    setOpenState({ appId: app.id, status: "busy" });
    try {
      const response = await fetch("/api/apps/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: app.url }) });
      const body = await response.json() as { ok: boolean; error?: string; result?: string };
      setOpenState({ appId: app.id, status: body.ok ? "ok" : "error", message: body.ok ? undefined : (body.error ?? body.result ?? "mislukt") });
    } catch (error) {
      setOpenState({ appId: app.id, status: "error", message: error instanceof Error ? error.message : "mislukt" });
    }
  }

  function selectApp(app: WebApp) {
    setActiveId(app.id);
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
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
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
                  <span className="text-[11px] text-muted">{openState?.appId === active.id ? (openState.status === "busy" ? "openen in server-browser…" : openState.status === "ok" ? "geopend in server-browser" : `niet gelukt: ${openState.message ?? ""}`) : "via server-browser"}</span>
                  <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => void openInServerBrowser(active)}>Opnieuw openen</button>
                </>
              )}
              {active.url && <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={() => setFrameKey((key) => key + 1)}>Herladen</button>}
              {active.url && <a href={active.url} target="_blank" rel="noreferrer" className="mc-button mc-button-secondary mc-button-sm">Open in tabblad</a>}
              <PanelFocusButton />
            </header>
            {active.url ? (
              <>
                <iframe key={activeMode === "server" ? `server-browser-${frameKey}` : `${active.id}-${frameKey}`} src={activeMode === "server" ? SERVER_BROWSER.url : active.url} title={active.name} className="mc-apps-frame"
                  referrerPolicy="no-referrer"
                  sandbox={activeMode === "server" || active.url.startsWith("/") ? undefined : "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"}
                  allow="clipboard-read; clipboard-write; fullscreen; autoplay; microphone; camera" />
                <div className="mc-apps-note">{activeMode === "server" ? <>{active.name} draait in de browser op je server: inloggen werkt daar en blijft bewaard. Elke app opent als eigen tabblad in die browser.</> : active.url.startsWith("/") ? <>Dit is een echte browser op je server: inloggen werkt hier overal en blijft bewaard.</> : <>Inloggen (Google, Microsoft enz.) kan niet binnen een ander venster: die sites staan dat niet toe. Log in via &ldquo;Open in tabblad&rdquo;. Blijft het vak leeg, dan weigert de site ingesloten te worden; gebruik dan ook &ldquo;Open in tabblad&rdquo; of de app &ldquo;Browser&rdquo;.</>}</div>
              </>
            ) : (
              <div className="mc-apps-empty">
                {active.note ?? <>Voor {active.name} is nog geen geverifieerd browseradres beschikbaar. De connector/API-health is geen bewijs van een interactieve webinterface. Voeg via &ldquo;Apps beheren&rdquo; uitsluitend een echt bereikbaar UI-adres toe.</>}
              </div>
            )}
          </section>
        </FocusablePanel>
      )}
    </div>
  );
}
