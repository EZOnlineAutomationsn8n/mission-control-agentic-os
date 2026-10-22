"use client";
import { useEffect, useState } from "react";

/** True only in the WERKPLAATS (preview server answers /api/preview-identity with preview:true). */
export function useIsWerkplaats(): boolean {
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/preview-identity", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: unknown) => {
        if (data && typeof data === "object" && "preview" in data && data.preview === true) setPreview(true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return preview;
}

/** Dennis 2026-10-22 16:45: no banner. The werkplaats is marked by the sidebar label only (see Sidebar). */
export function PreviewIdentity() {
  return null;
}
