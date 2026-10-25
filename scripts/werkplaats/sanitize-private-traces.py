#!/usr/bin/env python3
"""Strip only *references* to environment-private files from Next .nft trace
manifests, after Next build and before a stage artifact is certified.

Next 16 does not apply route-scoped outputFileTracingExcludes to its special
instrumentation.js.nft.json. No private source file is opened or copied.
"""
import json
import os
import pathlib
import sys

PRIVATE_DIRS = (
    "data", ".preview-acf-home", ".preview-acf-runtime", ".preview-native-home", ".preview-ops",
    ".preview-omi", ".werkplaats-release-source", "theme",
)

def stage_dir(raw: str) -> pathlib.Path:
    stage = pathlib.Path(raw).resolve()
    if not stage.name.startswith(".stage-") or stage.parent == stage:
        raise ValueError("NOT_ISOLATED_WORKTREE")
    if stage.is_symlink() or not (stage / ".git").is_file():
        raise ValueError("NOT_ISOLATED_GIT_WORKTREE")
    if not (stage / ".next" / "BUILD_ID").is_file():
        raise ValueError("INCOMPLETE_STAGE_BUILD")
    return stage

def is_private_reference(manifest: pathlib.Path, entry: str, stage: pathlib.Path) -> bool:
    target = (manifest.parent / entry).resolve(strict=False)
    return any(target == stage / d or (stage / d) in target.parents for d in PRIVATE_DIRS)

def sanitize(stage: pathlib.Path) -> tuple[int,int,int]:
    manifests = sorted((stage / ".next").rglob("*.nft.json"))
    if not manifests:
        raise ValueError("MISSING_NFT_TRACE_MANIFESTS")
    scanned = removed = 0
    for p in manifests:
        if p.is_symlink() or not p.is_file():
            raise ValueError("UNSAFE_TRACE_MANIFEST")
        parsed = json.loads(p.read_text())
        original = parsed.get("files")
        if not isinstance(original, list) or any(not isinstance(x, str) for x in original):
            raise ValueError("INVALID_NFT_TRACE_MANIFEST")
        scanned += len(original)
        kept = [item for item in original if not is_private_reference(p,item,stage)]
        count = len(original)-len(kept)
        if count:
            parsed["files"] = kept
            tmp = p.with_name(p.name + ".gaos010tmp")
            with tmp.open("x") as handle:
                json.dump(parsed,handle,separators=(",",":"))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            tmp.chmod(p.stat().st_mode & 0o777)
            tmp.replace(p)
            removed += count
    # Independent final scan: no trace, regardless of API route, may include
    # stage sessions/secrets/configuration. On failure, no source/session change.
    for p in manifests:
        entries=json.loads(p.read_text())["files"]
        if any(is_private_reference(p,e,stage) for e in entries):
            raise ValueError("UNSAFE_STAGE_TRACE_STILL_PRESENT")
    return (len(manifests),scanned,removed)

def main() -> None:
    if len(sys.argv)!=2:
        raise SystemExit("usage: sanitize-private-traces.py /absolute/path/to/.stage-name")
    stage=stage_dir(sys.argv[1])
    count,scanned,removed=sanitize(stage)
    print(f"PRIVATE_TRACE_AUDIT=PASS MANIFESTS={count} SCANNED={scanned} REFERENCES_REMOVED={removed}")
    print("SENSITIVE_PROFILE_CONTENT_OPENED=NO")
    print("SOURCE_OR_SESSION_OR_PRODUCTION_FILES_CHANGED=NO")

if __name__=="__main__":
    main()
