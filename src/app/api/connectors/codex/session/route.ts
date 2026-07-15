import { changeCliAgentSession, getCliAgentSession } from "@/lib/cli-agents/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getCliAgentSession(request, "codex");
}

export async function POST(request: Request) {
  return changeCliAgentSession(request, "codex");
}
