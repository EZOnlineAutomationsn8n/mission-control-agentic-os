# Shared Brain Source Consolidation Report

Scan time: 2026-07-15 UTC  
Scope: read-only continuity-name scan under `/opt/vireon/workfloor/obsidian`, `/opt/vrn/mission-control`, and `/opt/portmontage/workfloor/obsidian`

## Proven inventory

- 19 continuity-related files were fingerprinted by path, SHA-256, size, and modification time.
- 5 files are byte-identical duplicates of an earlier archive copy.
- 3 active/candidate LifeFeed files exist across separate scopes: ViREON vault root, ViREON active vault, and PortMontage.
- 1 Mission Control current-state report was found: `/opt/vrn/mission-control/reports/CURRENT_WORKING_STATE_20260707T230937Z.md`.
- 1 earlier Mission Control LifeFeed reconnect scan was found and classified as evidence, not active continuity.
- No discovered Mission Control source was silently declared canonical.

The machine-readable register is `reports/shared-brain-source-inventory.json` and is imported into PostgreSQL by `npm run db:import-brain-sources`.

## Meaning of classifications

- `canonical`: explicitly accepted authority for one scope and artifact kind.
- `candidate`: current-looking source that still requires operator acceptance.
- `legacy`: historical design or evidence that must not drive current state.
- `archive`: preserved historical state.
- `duplicate`: byte-identical content whose `duplicateOf` field identifies the retained equivalent.

Classification does not delete, move, rename, or rewrite source files.
