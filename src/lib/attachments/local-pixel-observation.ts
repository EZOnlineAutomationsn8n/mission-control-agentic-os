/** Zero-network, zero-provider image pixel observations for existing attachment sessions.
 * Not OCR, object recognition, a vision-language model, or semantic image understanding.
 * Never labels an agent VISION_READY from these limited observations.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { AttachmentReference } from "./types";
import { promptWithAttachments } from "./store";

const ANALYZABLE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;

type ColorLabel = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink" | "black" | "white" | "gray";

function classifyPixel(r: number, g: number, b: number): ColorLabel {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max < 45) return "black";
  if (min > 215 && delta < 30) return "white";
  if (delta < 32) return "gray";
  // Hue in degrees. This is measured pixel information, not semantic interpretation.
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 45) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "cyan";
  if (hue < 255) return "blue";
  if (hue < 295) return "purple";
  return "pink";
}

function dominant(colors: ColorLabel[]): string {
  const totals = new Map<ColorLabel, number>();
  for (const c of colors) totals.set(c, (totals.get(c) ?? 0) + 1);
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
    .map(([label, count]) => `${label} ${Math.round(100 * count / colors.length)}%`).join(", ");
}

export async function inspectLocalImagePixels(attachment: AttachmentReference): Promise<string | null> {
  if (!ANALYZABLE.has(path.extname(attachment.name).toLowerCase())) return null;
  if (attachment.size < 1 || attachment.size > MAX_BYTES) throw new Error("VISION_IMAGE_SIZE_UNSUPPORTED");
  const expectedRoot = path.resolve(process.env.ATTACHMENT_DATA_DIR || path.resolve("data", "attachments"));
  const expectedDirectory = path.resolve(expectedRoot, attachment.agentId, attachment.sessionId, attachment.id);
  const filePath = path.resolve(attachment.storagePath);
  if (path.dirname(filePath) !== expectedDirectory || path.basename(filePath) !== attachment.name) {
    throw new Error("VISION_ATTACHMENT_OUTSIDE_SCOPED_STORE");
  }
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== attachment.size) throw new Error("VISION_ATTACHMENT_INVALID_FILE");
  const buffer = await fs.readFile(filePath);
  // Reject vector, HEIC, PDF, and any other unverified format even if renamed.
  const image = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false, pages: 1 });
  const meta = await image.metadata();
  if (!(["jpeg", "png", "webp", "gif"] as Array<string>).includes(meta.format ?? "") || !meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) {
    throw new Error("VISION_IMAGE_FORMAT_UNSUPPORTED");
  }
  const { data, info } = await image.resize(64, 64, { fit: "fill" }).flatten({ background: "#ffffff" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3 || data.length !== 64 * 64 * 3) throw new Error("VISION_PIXELS_UNAVAILABLE");
  const all: ColorLabel[] = [];
  const left: ColorLabel[] = [];
  const right: ColorLabel[] = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const idx = (y * 64 + x) * 3;
    const label = classifyPixel(data[idx], data[idx + 1], data[idx + 2]);
    all.push(label);
    (x < 32 ? left : right).push(label);
  }
  const fingerprint = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  return `${attachment.name}: decoded ${meta.width}x${meta.height} ${meta.format} pixels; ` +
    `content SHA-256 prefix ${fingerprint}; main pixel colors ${dominant(all)}; ` +
    `left half ${dominant(left)}; right half ${dominant(right)}.`;
}

/** The only extra information forwarded is measured local pixel text, never image bytes.
 * If an image cannot be inspected, refuse rather than silently pass a path as vision proof.
 */
export async function promptWithLocalPixelEvidence(prompt: string, attachments: AttachmentReference[]): Promise<string> {
  const original = promptWithAttachments(prompt, attachments);
  const evidence: string[] = [];
  for (const attachment of attachments) {
    const extension = path.extname(attachment.name).toLowerCase();
    if (ANALYZABLE.has(extension)) {
      try { evidence.push((await inspectLocalImagePixels(attachment)) ?? ""); }
      catch { throw new Error(`VISION_LOCAL_PIXEL_INSPECTION_FAILED: ${attachment.name}`); }
    } else if ([".heic", ".svg"].includes(extension)) {
      throw new Error(`VISION_IMAGE_FORMAT_UNSUPPORTED: ${attachment.name}`);
    }
  }
  if (!evidence.length) return original;
  return `${original}\n\nLOCAL IMAGE PIXEL EVIDENCE (decoded from actual bytes on Mission Control; no external image API):\n${evidence.join("\n")}\n` +
    "LIMITATION: These are verified colors and regions ONLY. They do not establish objects, words, persons, actions, or scene meaning. " +
    "Do not invent semantic visual details. Say that full vision recognition is unavailable unless you actually invoke a separately certified, authorized vision tool on the image bytes.";
}
