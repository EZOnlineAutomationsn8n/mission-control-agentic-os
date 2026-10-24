#!/usr/bin/env python3
"""Werkplaats with REAL agents (Dennis 2026-10-22): copy the live ACF participant routes, but ACF may only use
acf-werkplaats-* sessions, so live conversations and teams are never touched. claude-ops accepts these routes
only with `mc-preview-start .stage-x agents`."""
import json, sys
LIVE = "/workspace/projects/agentic-collaboration-fabric/state/team-room/participant_routes.json"
out = sys.argv[1]
d = json.load(open(LIVE))
d["session_ref_pattern"] = "^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$"
d["note"] = "WERKPLAATS: real agents via production connectors, only acf-werkplaats-* sessions (CSA 2026-10-22)"
json.dump(d, open(out, "w"), indent=2)
print("werkplaats routes written:", out)
