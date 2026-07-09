import { AgentPageView } from "@/components/agents/AgentPageView";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentPageView agentId={id} />;
}
