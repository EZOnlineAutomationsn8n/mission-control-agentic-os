"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

interface PanelFocusState {
  panelId: string;
  label: string;
}

interface PanelFocusContextValue {
  focusedPanelId: string | null;
  focusedPanelLabel: string | null;
  focusPanel: (panelId: string, label: string) => void;
  restoreLayout: () => void;
}

const PanelFocusContext = createContext<PanelFocusContextValue | null>(null);

export function PanelFocusProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [focused, setFocused] = useState<PanelFocusState | null>(null);
  const previousPath = useRef(pathname);

  const restoreLayout = useCallback(() => setFocused(null), []);
  const focusPanel = useCallback((panelId: string, label: string) => {
    setFocused({ panelId, label });
  }, []);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setFocused(null);
  }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    if (focused) {
      root.dataset.mcPanelFocus = "active";
      root.dataset.mcPanelFocusId = focused.panelId;
    } else {
      delete root.dataset.mcPanelFocus;
      delete root.dataset.mcPanelFocusId;
    }
    return () => {
      delete root.dataset.mcPanelFocus;
      delete root.dataset.mcPanelFocusId;
    };
  }, [focused]);

  useEffect(() => {
    if (!focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      restoreLayout();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focused, restoreLayout]);

  const value = useMemo<PanelFocusContextValue>(() => ({
    focusedPanelId: focused?.panelId ?? null,
    focusedPanelLabel: focused?.label ?? null,
    focusPanel,
    restoreLayout,
  }), [focused, focusPanel, restoreLayout]);

  return <PanelFocusContext.Provider value={value}>{children}</PanelFocusContext.Provider>;
}

export function usePanelFocus(): PanelFocusContextValue {
  const value = useContext(PanelFocusContext);
  if (!value) throw new Error("usePanelFocus must be used inside PanelFocusProvider");
  return value;
}

function MaximizeIcon({ restore }: { restore: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="mc-panel-focus-icon" aria-hidden="true">
      {restore ? (
        <>
          <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
          <path d="m4 4 5 5m11-5-5 5M4 20l5-5m11 5-5-5" />
        </>
      ) : (
        <>
          <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
          <path d="m4 9 5-5m11 5-5-5M4 15l5 5m11-5-5 5" />
        </>
      )}
    </svg>
  );
}

interface PanelIdentity { id: string; label: string; }
const PanelIdentityContext = createContext<PanelIdentity | null>(null);

/**
 * Maximize/restore button placed by the panel's own content (e.g. next to Stop),
 * used together with <FocusablePanel inlineControls>. Renders a span when it sits
 * inside another button.
 */
export function PanelFocusButton({ id: explicitId, label: explicitLabel, asSpan = false, className = "" }: { id?: string; label?: string; asSpan?: boolean; className?: string }) {
  const identity = useContext(PanelIdentityContext);
  const { focusedPanelId, focusPanel, restoreLayout } = usePanelFocus();
  const id = explicitId ?? identity?.id;
  const label = explicitLabel ?? identity?.label ?? "panel";
  if (!id) return null;
  const focused = focusedPanelId === id;
  const toggle = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (focused) restoreLayout();
    else focusPanel(id, label);
  };
  const common = {
    className: `mc-panel-focus-button mc-panel-focus-inline ${className}`.trim(),
    "aria-label": focused ? `Restore ${label} to previous layout` : `Maximize ${label}`,
    title: focused ? "Terug naar vorige indeling (Esc)" : "Vergroten",
  };
  if (asSpan) {
    return (
      <span role="button" tabIndex={0} aria-pressed={focused} {...common} onClick={toggle}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") toggle(event); }}>
        <MaximizeIcon restore={focused} />
      </span>
    );
  }
  return (
    <button type="button" aria-pressed={focused} {...common} onClick={toggle}>
      <MaximizeIcon restore={focused} />
    </button>
  );
}

interface FocusablePanelProps {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
  tone?: "default" | "gold";
  moreOptions?: ReactNode;
  /** The panel content places <PanelFocusButton/> itself; no floating controls. */
  inlineControls?: boolean;
}

export function FocusablePanel({
  id,
  label,
  children,
  className = "",
  tone = "default",
  moreOptions,
  inlineControls = false,
}: FocusablePanelProps) {
  const { focusedPanelId, focusPanel, restoreLayout } = usePanelFocus();
  const focused = focusedPanelId === id;
  const anyFocused = focusedPanelId !== null;

  function toggleFocus() {
    if (focused) restoreLayout();
    else focusPanel(id, label);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.altKey && event.key === "Enter") {
      event.preventDefault();
      toggleFocus();
    }
  }

  return (
    <div
      className={[
        "mc-focusable-panel",
        focused ? "mc-panel-focused" : "",
        anyFocused && !focused ? "mc-panel-background" : "",
        tone === "gold" ? "mc-focusable-panel-gold" : "",
        className,
      ].filter(Boolean).join(" ")}
      data-mc-panel-id={id}
      data-mc-panel-focused={focused ? "true" : "false"}
      data-panel-tone={tone}
      tabIndex={0}
      aria-label={`${label} work pane`}
      onKeyDown={onKeyDown}
    >
      {!inlineControls && (
      <div className="mc-panel-focus-controls" onClick={(event) => event.stopPropagation()}>
        {moreOptions && (
          <details className="mc-panel-more">
            <summary className="mc-panel-focus-button" aria-label={`More options for ${label}`} title="More options">
              <span aria-hidden="true">•••</span>
            </summary>
            <div className="mc-panel-more-menu">{moreOptions}</div>
          </details>
        )}
        <button
          type="button"
          onClick={toggleFocus}
          className="mc-panel-focus-button"
          aria-label={focused ? `Restore ${label} to previous layout` : `Maximize ${label}`}
          aria-pressed={focused}
          title={focused ? "Restore previous layout (Esc)" : "Maximize / focus panel (Alt+Enter when panel is focused)"}
        >
          <MaximizeIcon restore={focused} />
        </button>
      </div>
      )}
      <PanelIdentityContext.Provider value={{ id, label }}>
        <div className="mc-focus-panel-body">{children}</div>
      </PanelIdentityContext.Provider>
    </div>
  );
}
