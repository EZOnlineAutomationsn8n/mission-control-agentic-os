#!/usr/bin/env python3
"""Build isolated ACF stage routes from the existing safe stage fixture.
Never read LIVE ACF routing, credentials, conversation stores or sessions.
This is data-profile selection, not a second router or model registry.
"""
import json
import pathlib
import sys

SOURCE_TREE = pathlib.Path(__file__).resolve().parents[2]
PROJECT_ROOT = SOURCE_TREE.parent if SOURCE_TREE.name.startswith(".stage-") else SOURCE_TREE
TEMPLATE = PROJECT_ROOT / ".stage-mc-acf-free-room-ui-20261021-001" / ".preview-acf-home" / "participant_routes.json"
STAGE_BASE = "http://127.0.0.1:3331"
SESSION_PATTERN = "^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$"

def create(stage_file: pathlib.Path):
    if not stage_file.is_absolute():
        raise ValueError("stage target path must be absolute")
    if stage_file.name != "participant_routes.json" or stage_file.parent.name != ".preview-acf-home":
        raise ValueError("only own stage ACF participant routes may be generated")
    worktree = stage_file.parent.parent
    if worktree.resolve() == PROJECT_ROOT or not worktree.name.startswith(".stage-") or worktree.is_symlink():
        raise ValueError("refuse production route mutation")
    if stage_file.exists():
        raise FileExistsError("refuse replacing existing session/route state")
    fixture = json.loads(TEMPLATE.read_text())
    routes = fixture.get("routes")
    expected = {"claude-code", "codex", "hermes", "openclaw", "agy", "gemini"}
    if not isinstance(routes, dict) or set(routes) != expected:
        raise ValueError("unexpected canonical six-ACF-seat fixture")
    result = dict(fixture)
    result["session_ref_pattern"] = SESSION_PATTERN
    result["note"] = "WERKPLAATS: isolated native agent/session pool (not LIVE)"
    result["base_url_assumption"] = "Stage-native ACF endpoints and index bound to own :3331 runtime"
    result["session_ref_pattern_evidence"] = "Stage session registry only, no LIVE fallback"
    result["session_index"] = {
        "base_url": STAGE_BASE, "path": "/api/cockpit/sessions",
        "timeout_seconds": 15, "stage_source": "STAGE_OWN_SESSION_REGISTRY",
    }
    for name, route in routes.items():
        if not isinstance(route, dict) or route.get("enabled") is not True:
            raise ValueError("missing participant route " + name)
        route["base_url"] = STAGE_BASE
        route["stage_source"] = "STAGE_NATIVE_SESSION_ONLY_PREVIEW_3331"
    # Strict allowlist of route URLs. Fail closed if fixture is unexpectedly altered.
    for name, route in routes.items():
        for key in ("ask_path","session_path"):
            if not route.get(key) == f"/api/connectors/{name}/" + ("actions/ask" if key=="ask_path" else "session"):
                raise ValueError(f"unexpected {name} {key}")
    stage_file.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with stage_file.open("x") as output:
        json.dump(result,output,indent=2)
        output.write("\n")
    stage_file.chmod(0o600)
    print("STAGE_NATIVE_ROUTES_GENERATED",stage_file,"SIX_SEATS_NO_LIVE_COPY")

if __name__ == "__main__":
    if len(sys.argv)!=2:
        raise SystemExit("usage: werkplaats-routes.py /absolute/.stage-name/.preview-acf-home/participant_routes.json")
    create(pathlib.Path(sys.argv[1]))
