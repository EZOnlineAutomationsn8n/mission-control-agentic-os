#!/usr/bin/env python3
"""Prepare the existing ACF engine for one isolated Mission Control Werkplaats.

This does not fork an engine and never copies ACF state, proofs, credentials or
conversation stores. It copies only the shared ACF executable/source/config into
the current .stage-* worktree, then applies the narrow FIRST_TURN_READY adapter
needed for Mission Control PREPARED sessions.

LIVE continues to use /workspace/projects/agentic-collaboration-fabric directly.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import sys

SHARED = pathlib.Path("/workspace/projects/agentic-collaboration-fabric").resolve()
CONTRACT = "MC_PREPARED_FIRST_TURN_V1"


def replace_once(path: pathlib.Path, old: str, new: str) -> None:
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"ANCHOR_MISMATCH:{path}:{text.count(old)}")
    path.write_text(text.replace(old, new, 1))


def stage_root(raw: str) -> pathlib.Path:
    stage = pathlib.Path(raw).resolve()
    if not stage.name.startswith(".stage-") or stage == SHARED or stage.is_symlink():
        raise RuntimeError("NOT_ISOLATED_WERKPLAATS")
    if not (stage / ".git").is_file():
        raise RuntimeError("NOT_GIT_WORKTREE")
    return stage


def copy_engine(stage: pathlib.Path) -> pathlib.Path:
    target = stage / ".preview-acf-runtime"
    temporary = stage / ".preview-acf-runtime.tmp"
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(mode=0o700)
    shutil.copy2(SHARED / "acf", temporary / "acf")
    for name in ("src", "runtime", "config"):
        shutil.copytree(SHARED / name, temporary / name, symlinks=False)
    os.chmod(temporary / "acf", 0o755)
    if target.exists():
        shutil.rmtree(target)
    temporary.replace(target)
    return target


def patch_engine(root: pathlib.Path) -> None:
    transport = root / "runtime/acf_runtime/dialogue/transport.py"
    replace_once(
        transport,
        '''    def session_state(self, session_ref: str) -> dict:
        """{'state': READY | BUSY | DOWN | ABSENT | UNCLEAR | UNREACHABLE, 'reason'}. Asks; changes nothing."""
        try:
            status, payload = self._client.session(session_ref)
        except RouteError as err:
            return {"state": "UNREACHABLE", "reason": _said(err)}
        except Exception as err:                             # whatever the route sent, it was not an answer
            return {"state": "UNREACHABLE", "reason": "ROUTE_ANSWER_UNUSABLE: " + type(err).__name__}
        if status == 200 and not isinstance(payload, dict):
            return {"state": "UNREACHABLE", "reason": "SESSION_ANSWER_UNREADABLE"}
        condition, reason, _ = session_condition(status, payload)
        if condition == "READY":
            session = payload["session"]
            named = session.get("sessionKey")
            if named is not None and named != session_ref:
                return {"state": "UNCLEAR", "reason": "ANSWER_NAMES_ANOTHER_SESSION"}
            if session.get("active") is not True or session.get("status") != "idle":
                return {"state": "UNCLEAR", "reason": "SESSION_STATUS_" + _said(session.get("status")).upper()[:40]}
        return {"state": condition, "reason": reason}
''',
        f'''    def session_state(self, session_ref: str) -> dict:
        """Read one route-owned session without starting it.

        READY means the native session is already idle. FIRST_TURN_READY is a
        separate explicit Mission Control contract: the route is allowed to
        create/open native state only when the operator's first real turn arrives.
        """
        try:
            status, payload = self._client.session(session_ref)
        except RouteError as err:
            return {{"state": "UNREACHABLE", "reason": _said(err)}}
        except Exception as err:
            return {{"state": "UNREACHABLE", "reason": "ROUTE_ANSWER_UNUSABLE: " + type(err).__name__}}
        if status == 200 and not isinstance(payload, dict):
            return {{"state": "UNREACHABLE", "reason": "SESSION_ANSWER_UNREADABLE"}}
        condition, reason, _ = session_condition(status, payload)
        if condition == "READY":
            session = payload["session"]
            named = session.get("sessionKey")
            if named is not None and named != session_ref:
                return {{"state": "UNCLEAR", "reason": "ANSWER_NAMES_ANOTHER_SESSION"}}
            if session.get("active") is not True:
                return {{"state": "UNCLEAR", "reason": "SESSION_NOT_ACTIVE"}}
            session_status = session.get("status")
            if session_status == "idle":
                return {{"state": "READY", "reason": reason}}
            first = payload.get("firstTurnReadiness")
            if session_status == "prepared" and isinstance(first, dict) \
                    and first.get("contract") == "{CONTRACT}" and first.get("ready") is True:
                return {{"state": "FIRST_TURN_READY", "reason": _said(first.get("code") or "{CONTRACT}")}}
            return {{"state": "UNCLEAR", "reason": "SESSION_STATUS_" + _said(session_status).upper()[:40]}}
        return {{"state": condition, "reason": reason}}
'''
    )

    team_room = root / "runtime/acf_runtime/team_room.py"
    replace_once(
        team_room,
        'TERMINAL_LOOP = ("STOPPED_ACCEPTED", "STOPPED_UNRESOLVED", "BLOCKED")\n',
        'TERMINAL_LOOP = ("STOPPED_ACCEPTED", "STOPPED_UNRESOLVED", "BLOCKED")\n'
        'READY_SESSION_STATES = ("READY", "FIRST_TURN_READY")\n'
        f'FIRST_TURN_CONTRACT = "{CONTRACT}"\n'
    )
    replace_once(
        team_room,
        '''def require_ready(routes, role, agent_id, session_ref):
    seen = session_ready(routes, agent_id, session_ref)
    if seen.get("state") != "READY":
        raise AcfError("TEAM_SESSION_NOT_READY", f"{role}: {agent_id}/{session_ref} is {seen.get('state')}"
                                                 f" ({seen.get('reason')}); nothing was sent")
    return seen
''',
        '''def require_ready(routes, role, agent_id, session_ref):
    seen = session_ready(routes, agent_id, session_ref)
    if seen.get("state") not in READY_SESSION_STATES:
        raise AcfError("TEAM_SESSION_NOT_READY", f"{role}: {agent_id}/{session_ref} is {seen.get('state')}"
                                                 f" ({seen.get('reason')}); nothing was sent")
    return seen
'''
    )
    replace_once(
        team_room,
        '''    status = candidate.get("status")
    if status == "error":
        return "EXCLUDED_ERROR", str(candidate.get("lastError") or "")[:120]
    if status == "stopped" or candidate.get("active") is not True:
        return "EXCLUDED_STOPPED", f"status {status}, active {candidate.get('active')}"
    if status in ("running", "starting"):
        return "EXCLUDED_BUSY", str(status)
    if status != "idle":
        return "EXCLUDED_UNCLEAR", f"status {str(status)[:40]}"
    if (agent, key) in held:
        return "EXCLUDED_IN_USE_BY_OPEN_RUN", held[(agent, key)]
    if pinned or key.startswith(ACF_SESSION_PREFIX):
        return "ELIGIBLE", "pinned by the operator" if pinned else "an ACF session, idle"
    return "ELIGIBLE_PIN_REQUIRED", "an individual Mission Control pane: ACF uses it only when the operator pins it"
''',
        '''    status = candidate.get("status")
    first = candidate.get("firstTurnReadiness")
    first_turn = status == "prepared" and isinstance(first, dict) \
        and first.get("contract") == FIRST_TURN_CONTRACT and first.get("ready") is True
    if status == "error":
        return "EXCLUDED_ERROR", str(candidate.get("lastError") or "")[:120]
    if status == "stopped" or candidate.get("active") is not True:
        return "EXCLUDED_STOPPED", f"status {status}, active {candidate.get('active')}"
    if status in ("running", "starting"):
        return "EXCLUDED_BUSY", str(status)
    if status != "idle" and not first_turn:
        reason = first.get("code") if status == "prepared" and isinstance(first, dict) else None
        return "EXCLUDED_UNCLEAR", str(reason or f"status {str(status)[:40]}")[:120]
    if (agent, key) in held:
        return "EXCLUDED_IN_USE_BY_OPEN_RUN", held[(agent, key)]
    if first_turn:
        if pinned or key.startswith(ACF_SESSION_PREFIX):
            return "ELIGIBLE_FIRST_TURN", str(first.get("code") or FIRST_TURN_CONTRACT)[:120]
        return "ELIGIBLE_PIN_REQUIRED", "first-turn-ready individual pane; operator pin required"
    if pinned or key.startswith(ACF_SESSION_PREFIX):
        return "ELIGIBLE", "pinned by the operator" if pinned else "an ACF session, idle"
    return "ELIGIBLE_PIN_REQUIRED", "an individual Mission Control pane: ACF uses it only when the operator pins it"
'''
    )
    text = team_room.read_text()
    text = text.replace(
        'r for r in rows if r["verdict"] == "ELIGIBLE"',
        'r for r in rows if r["verdict"] in ("ELIGIBLE", "ELIGIBLE_FIRST_TURN")'
    )
    text = text.replace(
        'if live.get("state") == "READY":',
        'if live.get("state") in READY_SESSION_STATES:'
    )
    old_roster_live = """        for r in eligible:
            live = session_ready(routes, agent, r["session_ref"])
            r["live"] = live
            if live.get("state") in READY_SESSION_STATES:
                suggested = r["session_ref"]
                break
"""
    new_roster_live = """        for r in eligible:
            # candidateRows() computed FIRST_TURN readiness immediately before
            # this ACF roster call. Reuse that same explicit contract snapshot
            # instead of synchronously probing the same route a second time.
            # Real team-open/team-step execution still uses ACF's normal live
            # session gate; this shortcut is roster-read-only only.
            live = ({"state": "FIRST_TURN_READY", "reason": r.get("reason")}
                    if r.get("verdict") == "ELIGIBLE_FIRST_TURN"
                    else session_ready(routes, agent, r["session_ref"]))
            r["live"] = live
            if live.get("state") in READY_SESSION_STATES:
                suggested = r["session_ref"]
                break
"""
    if text.count(old_roster_live) != 1:
        raise RuntimeError(f"TEAM_ROSTER_LIVE_ANCHOR_MISMATCH:{text.count(old_roster_live)}")
    text = text.replace(old_roster_live, new_roster_live, 1)
    team_room.write_text(text)

    team_control = root / "runtime/acf_runtime/team_control.py"
    text = team_control.read_text()
    count = text.count('seen.get("state") != "READY"')
    if count != 2:
        raise RuntimeError(f"TEAM_CONTROL_READY_ANCHOR_MISMATCH:{count}")
    text = text.replace('seen.get("state") != "READY"', 'seen.get("state") not in ("READY", "FIRST_TURN_READY")')
    old = 'all(v["session"].get("state") == "READY" for v in sessions.values())'
    if text.count(old) != 1:
        raise RuntimeError("TEAM_CONTROL_ALL_READY_ANCHOR_MISMATCH")
    text = text.replace(old, 'all(v["session"].get("state") in ("READY", "FIRST_TURN_READY") for v in sessions.values())', 1)
    team_control.write_text(text)

    driver = root / "runtime/acf_runtime/dialogue/driver.py"
    replace_once(
        driver,
        '        if session["state"] != "READY":\n',
        '        if session["state"] not in ("READY", "FIRST_TURN_READY"):\n'
    )


def verify(root: pathlib.Path) -> None:
    required = {
        root / "runtime/acf_runtime/dialogue/transport.py": ["FIRST_TURN_READY", CONTRACT],
        root / "runtime/acf_runtime/team_room.py": ["ELIGIBLE_FIRST_TURN", "READY_SESSION_STATES", CONTRACT],
        root / "runtime/acf_runtime/team_control.py": ["FIRST_TURN_READY"],
        root / "runtime/acf_runtime/dialogue/driver.py": ["FIRST_TURN_READY"],
    }
    for path, terms in required.items():
        text = path.read_text()
        for term in terms:
            if term not in text:
                raise RuntimeError(f"VERIFY_MISSING:{path}:{term}")
    if (root / "state").exists() or (root / "proofs").exists():
        raise RuntimeError("PRIVATE_OR_HISTORICAL_ACF_STATE_COPIED")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: prepare-acf-runtime.py /absolute/.stage-name")
    stage = stage_root(sys.argv[1])
    target = copy_engine(stage)
    patch_engine(target)
    verify(target)
    print(f"ACF_STAGE_RUNTIME=PASS ROOT={target}")
    print("LIVE_ACF_SOURCE_MUTATED=NO")
    print("ACF_STATE_OR_PROOFS_COPIED=NO")
    print(f"FIRST_TURN_CONTRACT={CONTRACT}")


if __name__ == "__main__":
    main()
