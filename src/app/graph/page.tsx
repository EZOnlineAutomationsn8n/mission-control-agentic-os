import { KnowledgeGraph } from "@/components/brain/KnowledgeGraph";

export const metadata = { title: "Kennisgraaf — Mission Control" };

export default function GraphPage() {
  return (
    <div className="mc-graph-page">
      <KnowledgeGraph />
    </div>
  );
}
