"use client";
import { useEffect, useRef, useState } from "react";

type Theme = { background: string; backgroundWebm?: string; poster?: string; panelOpacity: number; veil: number; blur: number; focusY: string };
const ROOT = "/api/theme/";
const MEDIA = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function mediaFile(value: unknown, exts: string[]): string | null {
  if (typeof value !== "string" || !MEDIA.test(value) || value.includes("..") || /original/i.test(value)) return null;
  return exts.some(ext => value.toLowerCase().endsWith(ext)) ? value : null;
}
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function parseTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const background = mediaFile(o.background, [".mp4", ".webm", ".jpg", ".jpeg", ".png"]);
  if (!background) return null;
  return {
    background, backgroundWebm: mediaFile(o.backgroundWebm, [".webm"]) ?? undefined,
    poster: mediaFile(o.poster, [".jpg", ".jpeg", ".png"]) ?? undefined,
    panelOpacity: bounded(o.panelOpacity, 0.72, 0.6, 0.95),
    veil: bounded(o.veil, 0.35, 0.18, 0.8),
    blur: bounded(o.blur, 6, 0, 16),
    // The focal starburst is at the video/image source centre. Translate that
    // centre to an explicit viewport percentage; CSS scales to keep all edges filled.
    focusY: typeof o.focusY === "string" && /^\d{1,3}(?:\.\d{1,4})?%$/.test(o.focusY)
      && Number.parseFloat(o.focusY) >= 15 && Number.parseFloat(o.focusY) <= 85 ? o.focusY : "50%",
  };
}
const asset = (file: string) => ROOT + encodeURIComponent(file);

export function MissionBackground() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let active = true;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => { if (active) setReducedMotion(motion.matches); };
    syncMotion();
    motion.addEventListener("change", syncMotion);
    const abort = new AbortController();
    fetch(ROOT + "theme.json", { cache: "no-store", signal: abort.signal })
      .then(res => { if (!res.ok) throw new Error("Theme not present"); return res.json(); })
      .then((payload: unknown) => { if (active) setTheme(parseTheme(payload)); })
      .catch(() => { if (active) setTheme(null); });
    return () => { active = false; abort.abort(); motion.removeEventListener("change", syncMotion); };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--mc-panel-alpha", String(theme?.panelOpacity ?? 0.9));
    root.style.setProperty("--mc-veil", String(theme?.veil ?? 0.5));
    root.style.setProperty("--mc-glass-blur", (theme?.blur ?? 0) + "px");
    root.style.setProperty("--mc-focus-y", theme?.focusY ?? "50%");
    return () => {
      root.style.removeProperty("--mc-panel-alpha");
      root.style.removeProperty("--mc-veil");
      root.style.removeProperty("--mc-glass-blur");
      root.style.removeProperty("--mc-focus-y");
    };
  }, [theme]);
  const video = Boolean(theme && /\.(mp4|webm)$/i.test(theme.background));
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    const sync = () => {
      if (reducedMotion || document.hidden) { el.pause(); return; }
      const p = el.play();
      if (p) void p.catch(() => { el.pause(); });
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { el.pause(); document.removeEventListener("visibilitychange", sync); };
  }, [theme, video, reducedMotion]);
  const still = theme && (reducedMotion && video ? theme.poster : theme.background);
  return (
    <div className="mc-background-layer" aria-hidden="true" data-mc-theme={theme?.background ?? "dark"}>
      {theme && (reducedMotion || !video) && still && (
        <div className="mc-background-still" style={{ backgroundImage: 'url("' + asset(still) + '")' }} />
      )}
      {theme && video && !reducedMotion && (
        <video key={theme.background} ref={videoRef} className="mc-background-video" muted loop playsInline
          preload="metadata" disablePictureInPicture tabIndex={-1}
          poster={theme.poster ? asset(theme.poster) : undefined}>
          {theme.backgroundWebm && <source src={asset(theme.backgroundWebm)} type="video/webm" />}
          <source src={asset(theme.background)} type={theme.background.endsWith(".webm") ? "video/webm" : "video/mp4"} />
        </video>
      )}
      <div className="mc-background-veil" />
    </div>
  );
}
