"use client";

import { useEffect, useRef } from "react";

// TESTMEDIA ONLY: tundra-preview.mp4 is available on VPS; the original
// Galaxy BackGround 0_43 sec Looped (1).mp4 and transcoded WebM are NOT
// present in the referenced staging source. Do not claim final galaxy proof.
const SOURCES = [
  { src: "/backgrounds/tundra-preview.mp4", type: "video/mp4" },
];

export function MissionBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Autoplay is only allowed for muted media; set the property explicitly.
    video.muted = true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      if (reducedMotion.matches || document.hidden) {
        // Static fallback from the same source: the paused frame stays visible.
        video.pause();
        return;
      }
      const attempt = video.play();
      if (attempt) attempt.catch(() => { /* autoplay refused: paused frame remains as still */ });
    };

    sync();
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div className="mc-background-layer" aria-hidden="true">
      <video
        ref={videoRef}
        className="mc-background-video"
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
      >
        {SOURCES.map((s) => (
          <source key={s.src} src={s.src} type={s.type} />
        ))}
      </video>
      <div className="mc-background-veil" />
    </div>
  );
}
