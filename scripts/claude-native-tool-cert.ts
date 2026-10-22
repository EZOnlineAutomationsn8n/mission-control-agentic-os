import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const CERTIFICATION_SCHEMA_VERSION = "MC_CLAUDE_NATIVE_TOOL_CERT_V1";

type JsonRecord = Record<string, unknown>;

export interface ClaudeNativeToolCertification {
  schemaVersion: typeof CERTIFICATION_SCHEMA_VERSION;
  marker: string;
  markerUserEventFound: boolean;
  freshToolUseEvent: boolean;
  freshToolResultEvent: boolean;
  toolTargetMatchesRequest: boolean;
  realAgentResponse: boolean;
  mutationNone: boolean;
  toolUseId: string | null;
  toolName: string | null;
  toolTarget: string | null;
  finalText: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => isRecord(item) && typeof item.text === "string" ? item.text : "")
    .filter(Boolean)
    .join("\n");
}

function userText(event: JsonRecord): string {
  const message = isRecord(event.message) ? event.message : null;
  return message ? contentText(message.content) : "";
}

export function verifyClaudeNativeToolCertification(options: {
  jsonl: string;
  marker: string;
  expectedToolName: string;
  expectedTarget: string;
}): ClaudeNativeToolCertification {
  const events = options.jsonl
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });

  let markerIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type === "user" && userText(events[index]).includes(options.marker)) {
      markerIndex = index;
    }
  }

  let toolUseId: string | null = null;
  let toolName: string | null = null;
  let toolTarget: string | null = null;
  let freshToolResultEvent = false;
  let finalText: string | null = null;

  if (markerIndex >= 0) {
    for (let index = markerIndex + 1; index < events.length; index += 1) {
      const event = events[index];
      if (event.type === "assistant") {
        const message = isRecord(event.message) ? event.message : null;
        const content = message && Array.isArray(message.content) ? message.content : [];
        for (const item of content) {
          if (!isRecord(item)) continue;
          if (
            item.type === "tool_use" &&
            item.name === options.expectedToolName &&
            isRecord(item.input) &&
            typeof item.input.file_path === "string"
          ) {
            toolUseId = typeof item.id === "string" ? item.id : null;
            toolName = item.name;
            toolTarget = item.input.file_path;
          }
          if (item.type === "text" && typeof item.text === "string" && item.text.includes(options.marker)) {
            finalText = item.text;
          }
        }
      }

      if (event.type === "user" && toolUseId) {
        const message = isRecord(event.message) ? event.message : null;
        const content = message && Array.isArray(message.content) ? message.content : [];
        for (const item of content) {
          if (
            isRecord(item) &&
            item.type === "tool_result" &&
            item.tool_use_id === toolUseId
          ) {
            freshToolResultEvent = true;
          }
        }
      }
    }
  }

  return {
    schemaVersion: CERTIFICATION_SCHEMA_VERSION,
    marker: options.marker,
    markerUserEventFound: markerIndex >= 0,
    freshToolUseEvent: toolUseId !== null,
    freshToolResultEvent,
    toolTargetMatchesRequest: toolTarget === options.expectedTarget,
    realAgentResponse: finalText !== null,
    mutationNone: finalText?.includes("MUTATION=NONE") ?? false,
    toolUseId,
    toolName,
    toolTarget,
    finalText,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const file = value("--file");
  const marker = value("--marker");
  const expectedToolName = value("--tool") ?? "Read";
  const expectedTarget = value("--target");

  if (!file || !marker || !expectedTarget) {
    console.error("usage: tsx scripts/claude-native-tool-cert.ts --file <jsonl> --marker <marker> --target <absolute-path> [--tool Read]");
    process.exitCode = 2;
    return;
  }

  const result = verifyClaudeNativeToolCertification({
    jsonl: await readFile(file, "utf8"),
    marker,
    expectedToolName,
    expectedTarget,
  });
  console.log(JSON.stringify(result, null, 2));

  if (
    !result.markerUserEventFound ||
    !result.freshToolUseEvent ||
    !result.freshToolResultEvent ||
    !result.toolTargetMatchesRequest ||
    !result.realAgentResponse ||
    !result.mutationNone
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
