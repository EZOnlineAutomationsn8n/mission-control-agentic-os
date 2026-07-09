import { ControlRoom } from "@/components/control-room/ControlRoom";

export default async function SystemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ControlRoom systemId={id} />;
}
