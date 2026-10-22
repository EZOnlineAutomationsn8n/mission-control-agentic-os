import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

// Opens a URL as a new tab in the server browser (container mc-browser) through the root-side
// claude-ops runner (action "browser-open"). Only http(s) URLs; nothing else is executed.
export const dynamic = "force-dynamic";

const OPS_DIR = process.env.MC_OPS_DIR || "/workspace/ops";
const URL_RE = /^https?:\/\/[A-Za-z0-9._:@/?&=%#~+,[\]>-]{1,500}$/;

export async function POST(request: Request) {
  let url = "";
  try { url = String(((await request.json()) as { url?: unknown }).url ?? ""); } catch { /* empty */ }
  if (!URL_RE.test(url)) return NextResponse.json({ ok: false, error: "Alleen gewone http(s)-adressen zonder spaties of aanhalingstekens." }, { status: 400 });
  const id = `mco-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestFile = path.join(OPS_DIR, "requests", `${id}.req`);
  const resultFile = path.join(OPS_DIR, "results", `${id}.txt`);
  try {
    await fs.writeFile(requestFile, `browser-open ${url}\n`, { mode: 0o660 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: `Kon het verzoek niet klaarzetten: ${error instanceof Error ? error.message : "onbekend"}` }, { status: 503 });
  }
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const text = await fs.readFile(resultFile, "utf8");
      const ok = /rc=0\s*$/.test(text.trim());
      return NextResponse.json({ ok, result: text });
    } catch { /* not ready yet */ }
  }
  return NextResponse.json({ ok: false, error: "De server-browser reageerde niet binnen 10 seconden." }, { status: 504 });
}
