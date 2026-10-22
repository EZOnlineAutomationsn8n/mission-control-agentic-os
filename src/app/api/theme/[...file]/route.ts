import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-cache, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff" };
const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4", ".webm": "video/webm",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
};
type Params = { params: Promise<{ file: string[] }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { file } = await params;
  if (!Array.isArray(file) || file.length !== 1) {
    return NextResponse.json({ error: "INVALID_THEME_FILE" }, { status: 400, headers: HEADERS });
  }
  const name = file[0];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name.includes("..") || /original/i.test(name)) {
    return NextResponse.json({ error: "INVALID_THEME_FILE" }, { status: 400, headers: HEADERS });
  }
  const extension = path.extname(name).toLowerCase();
  if (!TYPES[extension] || (extension === ".json" && name !== "theme.json")) {
    return NextResponse.json({ error: "UNSUPPORTED_THEME_FILE" }, { status: 404, headers: HEADERS });
  }
  const absolute = path.join(process.cwd(), "theme", name);
  let data: Buffer;
  try {
    const st = await fs.lstat(absolute);
    if (!st.isFile() || st.size > 32 * 1024 * 1024) throw new Error("NOT_REGULAR_FILE");
    data = await fs.readFile(absolute);
  } catch {
    return NextResponse.json({ error: "THEME_FILE_MISSING" }, { status: 404, headers: HEADERS });
  }
  const size = data.length;
  const range = request.headers.get("range");
  const media = extension === ".mp4" || extension === ".webm";
  const base = { ...HEADERS, "Content-Type": TYPES[extension], "Accept-Ranges": media ? "bytes" : "none" };
  if (range && media) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : (match?.[2] ? Math.max(0, size - Number(match[2])) : NaN);
    const end = match?.[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size || end >= size) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": "bytes */" + size } });
    }
    const chunk = data.subarray(start, end + 1);
    return new Response(new Uint8Array(chunk), { status: 206, headers: {
      ...base, "Content-Range": "bytes " + start + "-" + end + "/" + size, "Content-Length": String(chunk.length),
    } });
  }
  return new Response(new Uint8Array(data), { status: 200, headers: { ...base, "Content-Length": String(size) } });
}
