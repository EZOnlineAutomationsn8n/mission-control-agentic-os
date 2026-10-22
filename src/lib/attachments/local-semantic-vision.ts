/**
 * Explicit opt-in LOCAL Ollama vision tool for Mission Control attachment conversations.
 *
 * There is deliberately no arbitrary endpoint or external provider fallback.
 * This is not an OpenClaw/Claude CLI multimodal native turn; provenance stays distinct.
 * A local model is NEVER considered vision-capable without Ollama /api/show
 * reporting the "vision" capability. Real visual accuracy still needs fixture proof.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { AttachmentReference } from "./types";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";

const OLLAMA = "http://127.0.0.1:11434";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const SUPPORTED = /\.(?:png|jpe?g|webp|gif)$/i;
const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif|heic|svg)$/i;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_IMAGE_COUNT = 3;

type LocalFetch = typeof fetch;
export interface VerifiedLocalVisionModel {
  model: string;
  localOrigin: typeof OLLAMA;
  capability: "vision";
}
export const hasImageAttachments = (attachments: AttachmentReference[]): boolean =>
  attachments.some((item) => IMAGE_FILE.test(item.name));

function visionConfig(): string {
  if (process.env.MC_LOCAL_VISION_ENABLED !== "1") {
    throw new Error("VISION_MODEL_NOT_VERIFIED: no explicitly enabled local vision inference route");
  }
  const model = process.env.MC_LOCAL_VISION_MODEL?.trim() ?? "";
  if (!MODEL_NAME.test(model)) {
    throw new Error("VISION_MODEL_NOT_VERIFIED: MC_LOCAL_VISION_MODEL must name a specific installed local model");
  }
  return model;
}

async function getLocalJson(fetchFn: LocalFetch, pathPart: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  // Request paths are fixed; no user-controlled domain, redirect, transport or URL.
  const url = new URL(pathPart, OLLAMA);
  if (url.origin !== OLLAMA || !["/api/tags","/api/show","/api/chat"].includes(url.pathname)) {
    throw new Error("VISION_EGRESS_DENIED");
  }
  let response: Response;
  try {
    response = await fetchFn(url.href, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new Error("VISION_LOCAL_MODEL_UNREACHABLE: no access to the local Ollama runtime namespace");
  }
  if (!response.ok) throw new Error("VISION_LOCAL_MODEL_REFUSED: local Ollama did not accept the request");
  const body = await response.text();
  if (body.length > 120_000) throw new Error("VISION_LOCAL_RESPONSE_TOO_LARGE");
  try { return JSON.parse(body) as unknown; }
  catch { throw new Error("VISION_LOCAL_RESPONSE_INVALID"); }
}

export async function verifyLocalVisionModel(fetchFn: LocalFetch = fetch): Promise<VerifiedLocalVisionModel> {
  const model = visionConfig();
  const tags = await getLocalJson(fetchFn, "/api/tags", { method: "GET" }, 5_000) as {
    models?: Array<{ name?: string; model?: string }>;
  };
  if (!Array.isArray(tags?.models) || !tags.models.some((entry) =>
    entry?.name === model || entry?.model === model
  )) throw new Error("VISION_MODEL_NOT_INSTALLED: named model absent from local Ollama catalog");
  const show = await getLocalJson(fetchFn, "/api/show", {
    method: "POST", body: JSON.stringify({ model }),
  }, 6_000) as { capabilities?: unknown };
  if (!Array.isArray(show?.capabilities) || !show.capabilities.includes("vision")) {
    throw new Error("VISION_MODEL_NOT_VISION_CAPABLE: local model does not declare native vision capability");
  }
  return { model, localOrigin: OLLAMA, capability: "vision" };
}

async function imageBufferForLocalModel(attachment: AttachmentReference): Promise<{ base64: string; hash: string }> {
  if (!SUPPORTED.test(attachment.name)) throw new Error("VISION_IMAGE_FORMAT_UNSUPPORTED");
  if (attachment.size <= 0 || attachment.size > MAX_FILE_BYTES) throw new Error("VISION_IMAGE_SIZE_UNSUPPORTED");
  const root = path.resolve(process.env.ATTACHMENT_DATA_DIR || path.resolve("data", "attachments"));
  const expected = path.resolve(root, attachment.agentId, attachment.sessionId, attachment.id);
  const selected = path.resolve(attachment.storagePath);
  if (path.dirname(selected) !== expected || path.basename(selected) !== attachment.name) throw new Error("VISION_ATTACHMENT_SCOPE_DENIED");
  const realRoot = await fs.realpath(root);
  const realPath = await fs.realpath(selected);
  if (!realPath.startsWith(realRoot + path.sep)) throw new Error("VISION_ATTACHMENT_SCOPE_DENIED");
  const st = await fs.lstat(selected);
  if (!st.isFile() || st.isSymbolicLink() || st.size !== attachment.size) throw new Error("VISION_ATTACHMENT_INVALID_FILE");
  const bytes = await fs.readFile(selected);
  const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false, pages: 1 });
  const metadata = await image.metadata();
  if (!["png","jpeg","webp","gif"].includes(metadata.format ?? "") ||
      !metadata.width || !metadata.height ||
      metadata.width * metadata.height > MAX_PIXELS) throw new Error("VISION_IMAGE_FORMAT_UNSUPPORTED");
  // Bound decoding and inference memory. Original bytes never leave the process.
  const normalized = await image.rotate().resize({
    width: 1500, height: 1500, fit: "inside", withoutEnlargement: true,
  }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
  if (normalized.length > 6_000_000) throw new Error("VISION_IMAGE_TOO_LARGE_AFTER_DECODE");
  return { base64: normalized.toString("base64"), hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
}

export async function runLocalSemanticVision(options: {
  prompt: string;
  attachments: AttachmentReference[];
  sessionId: string;
  agentId: string;
  verified: VerifiedLocalVisionModel;
  fetchFn?: LocalFetch;
}): Promise<ConnectorConversationResult> {
  if (options.attachments.some((item) => IMAGE_FILE.test(item.name) && !SUPPORTED.test(item.name))) {
    throw new Error("VISION_IMAGE_FORMAT_UNSUPPORTED");
  }
  const model = visionConfig();
  if (model !== options.verified.model || options.verified.localOrigin !== OLLAMA) {
    throw new Error("VISION_VERIFICATION_STALE");
  }
  const files = options.attachments.filter((item) => IMAGE_FILE.test(item.name));
  if (files.length < 1 || files.length > MAX_IMAGE_COUNT) throw new Error("VISION_IMAGE_COUNT_LIMIT");
  const images = await Promise.all(files.map(imageBufferForLocalModel));
  const result = await getLocalJson(options.fetchFn ?? fetch, "/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: "0",
      options: { temperature: 0, num_predict: 450 },
      messages: [{
        role: "user",
        content: "Analyze the actual image(s), not their filenames. Answer the user's question using visible evidence; explicitly state uncertainty about illegible text or unclear objects.\n\n" + options.prompt,
        images: images.map((item) => item.base64),
      }],
    }),
  }, 120_000) as { message?: { content?: unknown }; model?: unknown };
  const answer = typeof result?.message?.content === "string" ? result.message.content.trim() : "";
  if (!answer) throw new Error("VISION_LOCAL_MODEL_EMPTY_ANSWER");
  if (typeof result.model === "string" && result.model !== model) throw new Error("VISION_MODEL_IDENTITY_MISMATCH");
  return {
    status: "completed",
    text: answer,
    error: null,
    agentIdentity: "Mission Control Local Vision Tool (not native agent CLI)",
    agentRuntime: "Ollama local vision inference",
    provider: "local-ollama",
    transportModelAlias: "local-ollama/" + model,
    actualRuntimeModel: model,
    responseProvenance: "LOCAL_BYTES->OLLAMA_VISION_MODEL->TEXT;NOT_OPENCLAW_OR_CLAUDE_CLI;SHA256_PREFIXES=" + images.map(i=>i.hash).join(","),
    runtimeVerifiedAt: new Date().toISOString(),
    agentSessionId: null, // No fake native agent session: the conversation service persists UI history by MC session.
    sessionState: "idle",
  };
}
