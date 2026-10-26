"use client";

import { useState, type ReactNode } from "react";
import { FocusablePanel, PanelFocusButton } from "@/components/shell/PanelFocus";

/** Presentation-only actions on one ACF-exported answer; no session or model request. */
export function AcfReplyPanel({ messageId, namespace, author, body, children, className = "" }: {
  messageId: string;
  namespace: string;
  author: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  async function copyFullReply() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body);
      } else {
        const field = document.createElement("textarea");
        field.value = body;
        field.readOnly = true;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        try {
          field.select();
          if (!document.execCommand("copy")) throw Error("Clipboard not available");
        } finally {
          field.remove();
        }
      }
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return <FocusablePanel id={`acf-answer-${namespace}-${messageId}`}
    label={`ACF-antwoord van ${author}`}
    className={`mc-acf-reply-panel ${className}`} inlineControls>
    <div className="mc-acf-reply-actions" role="group" aria-label={`Antwoordacties ${author}`}>
      <button type="button" className="mc-acf-reply-action" data-testid="acf-copy-reply"
        aria-label={`Kopieer volledig antwoord van ${author}`}
        onClick={()=>void copyFullReply()}>
        {copyState === "copied" ? "✓ Gekopieerd" : "⧉ Kopieer"}
      </button>
      <span data-testid="acf-expand-reply"><PanelFocusButton className="mc-acf-reply-expand" /></span>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState==="copied" ? "Volledig antwoord gekopieerd" : copyState==="failed" ? "Kopiëren mislukt; selecteer de tekst handmatig" : ""}
      </span>
      {copyState==="failed" && <span className="text-xs text-warn">Kopiëren niet toegestaan</span>}
    </div>
    {children}
  </FocusablePanel>;
}
