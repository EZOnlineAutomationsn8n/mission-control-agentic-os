import { askCliAgent } from "@/lib/cli-agents/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return askCliAgent(request, "hermes");
}
