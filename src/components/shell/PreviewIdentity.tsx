"use client";
import { useEffect, useState } from "react";

export function PreviewIdentity() {
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
  if (!preview) return null;
  return (
    <div role="status" className="mc-preview-identity">
      WERKPLAATS — testversie · agents staan uit · niks hier is echt
    </div>
  );
}
