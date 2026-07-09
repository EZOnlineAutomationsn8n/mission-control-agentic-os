// SELF rooms — planned personal-workspace pages. Each is a real route with
// an honest NOT WIRED state and the exact next wiring step, never a fake
// dashboard. Promoting a room = replacing its entry here with a real page.

const ROOMS: Record<string, { name: string; purpose: string; nextWiring: string }> = {
  goals: {
    name: "Goals",
    purpose: "Personal/operator goal tracking across agents and projects.",
    nextWiring: "A goals data source (local store or Obsidian folder read) plus a create/edit UI.",
  },
  seo: {
    name: "SEO",
    purpose: "SEO research and content-pipeline workspace.",
    nextWiring: "A research agent route (e.g. FCC prompt presets) and a keyword/report store.",
  },
  video: {
    name: "Video",
    purpose: "Video production pipeline (scripts, cuts, renders).",
    nextWiring: "Asset source wiring (filesystem/Paperclip) and a per-project board.",
  },
  music: {
    name: "Music",
    purpose: "Music/audio production workspace.",
    nextWiring: "Asset source wiring and generation-tool routes.",
  },
  "game-studio": {
    name: "Game Studio",
    purpose: "Game prototyping workspace.",
    nextWiring: "Project scaffolding source and build-status wiring.",
  },
  thumbnails: {
    name: "Thumbnails",
    purpose: "Thumbnail design/iteration workspace.",
    nextWiring: "Image-generation route plus an asset gallery source.",
  },
  notebook: {
    name: "Notebook",
    purpose: "Freeform notes tied to the shared brain.",
    nextWiring: "A scoped, audited Obsidian note read/append route (see Memory).",
  },
};

export default async function SelfRoomPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  const def = ROOMS[room];

  if (!def) {
    return <div className="p-6 text-sm text-danger">Unknown room: {room}</div>;
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold">{def.name}</h1>
        <p className="text-sm text-muted mt-1">{def.purpose}</p>
      </div>
      <div className="rounded-lg border border-warn/40 bg-warn/10 p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide font-semibold text-warn">Not wired</div>
        <div className="text-sm text-foreground/90">
          This room is a planned workspace — no data source or agent route is attached yet.
        </div>
        <div className="text-xs text-muted">Next wiring: {def.nextWiring}</div>
      </div>
    </div>
  );
}
