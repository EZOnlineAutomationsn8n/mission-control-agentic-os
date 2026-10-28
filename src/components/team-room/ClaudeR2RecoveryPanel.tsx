"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * R2 — operator-only recovery of the EXISTING Claude Werkplaats registration at its
 * LIVE owner. Two explicit steps, both Dennis' own click, never automatic:
 *  1. "Herstel registratie" = compare-and-set error → prepared (same UUID), hold on.
 *  2. "Eén herstelbeurt"     = exactly one --resume turn on that UUID; success → idle.
 * Credentials: the browser's existing Mission Control login (Nginx realm) — nothing stored.
 */
const KEY = "acf-werkplaats-claude-code";
const RESUME_PROMPT =
  "Herstelcontrole Mission Control: bevestig in één korte zin dat je deze bestaande sessie hervat en klaar bent voor de Team Room.";

type R2Session = {
  status?: string; active?: boolean; claudeSessionId?: string;
  lastError?: string | null; historyLastError?: string | null;
  recoveryHold?: boolean; recoveryTurnStartedAt?: string | null;
};

export function ClaudeR2RecoveryPanel() {
  const [session, setSession] = useState<R2Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/connectors/claude-code/session?sessionId=" + KEY, { cache: "no-store" });
      const j = await r.json() as { session?: R2Session };
      setSession(j.session ?? null);
    } catch { setNote("Status kon niet gelezen worden."); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- asynchronous external GET read; state is updated only after the response
  useEffect(() => { void load(); }, [load]);

  if (!session) return null;
  const errorState = session.status === "error" && session.active === false && !session.recoveryHold;
  const holdState = session.recoveryHold === true && session.status === "prepared" && !session.recoveryTurnStartedAt;
  const recovered = session.recoveryHold === false && session.status === "idle";
  if (!errorState && !holdState && !recovered) return null;

  async function recover() {
    if (!session?.claudeSessionId) return;
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/connectors/claude-code/session?sessionId=" + KEY, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recover-existing", expectedNativeUuid: session.claudeSessionId }),
      });
      const j = await r.json() as { error?: string; code?: string };
      setNote(r.ok ? "Registratie hersteld (zelfde UUID). Stap 2: één herstelbeurt." : "Niet hersteld: " + (j.error ?? r.status));
    } catch { setNote("Uitkomst onbekend — NIET opnieuw klikken; status wordt opnieuw gelezen."); }
    finally { setBusy(false); void load(); }
  }

  async function resume() {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/connectors/claude-code/actions/ask", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: KEY, prompt: RESUME_PROMPT, recoveryResume: true }),
      });
      const j = await r.json() as { recovered?: boolean; text?: string; error?: string };
      setNote(j.recovered ? "Claude antwoordde: " + (j.text ?? "").slice(0, 240) : "Herstelbeurt niet gelukt: " + (j.error ?? r.status) + " — geen tweede poging.");
    } catch { setNote("Uitkomst onbekend — NIET opnieuw klikken; status wordt opnieuw gelezen."); }
    finally { setBusy(false); void load(); }
  }

  return (
    <div className="mt-2 rounded-md border border-cyan-400/40 bg-cyan-400/5 p-2 text-[11px]" data-testid="claude-r2-recovery">
      <p className="font-semibold text-cyan-200">Claude werkplaats-sessie herstellen (zelfde UUID)</p>
      <p className="mt-0.5 break-all text-muted">{KEY} · UUID {session.claudeSessionId}</p>
      {errorState && <>
        <p className="mt-1 text-warn">Deze sessie staat sinds de mislukte opstart op fout. Herstel zet hem terug zonder nieuwe sessie of modelbeurt.</p>
        <button type="button" disabled={busy} onClick={recover}
          title="Zet deze ene registratie van fout naar voorbereid. Zelfde UUID, geschiedenis blijft. Geen modelbeurt."
          className="mc-button mc-button-secondary mc-button-sm mt-1">Stap 1 · Herstel registratie</button>
      </>}
      {holdState && <>
        <p className="mt-1 text-warn">Registratie hersteld. Eén herstelbeurt hervat de bestaande Claude-sessie. Lukt die, dan doet Claude weer mee. Er komt nooit een tweede poging.</p>
        <button type="button" disabled={busy} onClick={resume}
          title="Stuurt precies één korte controlevraag naar Claude via de bestaande sessie (hervatten). Kost één modelbeurt."
          className="mc-button mc-button-secondary mc-button-sm mt-1">Stap 2 · Eén herstelbeurt</button>
      </>}
      {recovered && <p className="mt-1 text-ok">Hersteld: idle met dezelfde UUID. Vernieuw de status om Claude in de werkplaats te gebruiken.</p>}
      {note && <p className="mt-1 break-words">{note}</p>}
    </div>
  );
}
