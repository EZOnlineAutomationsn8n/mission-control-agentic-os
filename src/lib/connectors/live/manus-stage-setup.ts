import { promises as fs, constants } from "node:fs";
import path from "node:path";

export const WERKPLAATS_EDGE = "https://mc.vireonhq.cloud:8443";
export const MANUS_KEY_MAX = 4096;

export function stageManusKeyPath(): string | null {
  if (process.env.MC_PREVIEW !== "1") return null;
  const dataHome = process.env.CLI_AGENT_SESSION_DATA_DIR;
  if (!dataHome) return null;
  const absolute = path.resolve(dataHome);
  // Never use the global production secret. Only the certified workshop data tree.
  if (!absolute.endsWith("/.stage-achtergrond/data")) return null;
  return path.join(absolute, "secrets", "manus-stage-api-key");
}

export async function validateWerkplaatsOperator(req: Request): Promise<string | null> {
  if (process.env.MC_PREVIEW !== "1") return "NOT_STAGE";
  if (req.headers.get("origin") !== WERKPLAATS_EDGE) return "ORIGIN_MISMATCH";
  if (!["same-origin", "none"].includes(req.headers.get("sec-fetch-site") || "")) return "FETCH_SITE_MISMATCH";
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Basic [a-zA-Z0-9+/=]{12,512}$/.test(authorization)) return "WORKPLACE_LOGIN_REQUIRED";
  // Do not invent app users: validate the exact Basic credential against the already
  // protected existing Nginx Werkplaats realm, without storing or logging it.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(WERKPLAATS_EDGE + "/api/preview-identity", {
        headers: { authorization, accept: "application/json" },
        cache: "no-store", redirect: "error", signal: controller.signal,
      });
      if (!response.ok || !String(response.headers.get("content-type")).includes("application/json")) return "WORKPLACE_LOGIN_INVALID";
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("preview" in body) || body.preview !== true) return "NOT_WORKSHOP_IDENTITY";
      return null;
    } finally { clearTimeout(timer); }
  } catch { return "WORKPLACE_AUTH_CHECK_UNAVAILABLE"; }
}

export async function writeStageManusSecret(secret: unknown): Promise<string> {
  const filepath = stageManusKeyPath();
  if (!filepath) return "STAGE_SECRET_HOME_UNAVAILABLE";
  if (typeof secret !== "string" || secret.length < 16 || secret.length > MANUS_KEY_MAX || /\s/.test(secret)) return "INVALID_KEY_FORMAT";
  const dir = path.dirname(filepath);
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const st = await fs.lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) !== 0) return "SECRET_DIR_NOT_PRIVATE";
    const prior = await fs.lstat(filepath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (prior) return "KEY_ALREADY_CONFIGURED_NO_SILENT_ROTATION";
    const handle = await fs.open(filepath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(secret, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await fs.chmod(filepath, 0o600);
    return "STAGE_SECRET_STORED";
  } catch { return "SECRET_WRITE_DENIED"; }
}
