#!/usr/bin/env bash
set -euo pipefail

MC_ROOT="/opt/shared/agentic-sandbox/workspace/projects/mission-control"
BRAIN_ROOT="/opt/shared/agentic-sandbox/workspace/projects/agentic-os-brain"
DROP_ROOT="/opt/shared/agentic-sandbox/workspace/runtime-data/central-memory-drop"
PROCESSED="$DROP_ROOT/processed"
STATE_DIR="/opt/shared/agentic-sandbox/workspace/runtime-data/omi-outbound-state"
KEY_FILE="/opt/shared/agentic-sandbox/workspace/runtime-data/secrets/omi-dev-key"
BRAIN="$BRAIN_ROOT/_system/bin/brain"
AUTHORITY="DENNIS_WO_SBC_05_20261003"

mkdir -p "$DROP_ROOT" "$PROCESSED" "$STATE_DIR"
umask 077

echo "OMI_MEMORY_CYCLE_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1) Bring bounded Central semantic drops into the canonical Shared Brain.
# Raw chat transcripts are deliberately not imported here.
shopt -s nullglob
for f in "$DROP_ROOT"/PENDING_*.txt; do
  base="$(basename "$f")"
  sid="${base#PENDING_}"; sid="${sid%.txt}"
  "$BRAIN" capture \
    --runtime central-overseer \
    --session-id "$sid" \
    --event OmiMemorySync \
    --project global \
    --summary-file "$f" \
    --content-key \
    --provenance "central-overseer bounded semantic memory sync" \
    --content-class SEMANTIC_CONTEXT
  mv -f "$f" "$PROCESSED/${base/PENDING_/PROCESSED_}"
  echo "CENTRAL_MEMORY_DROP_PROCESSED=$base"
done

# 2) Reuse the certified Shared Brain semantic filter/outbox. Exclude continuum-cert test state.
for project in global shared-brain agentic-os mission-control worker-fabric; do
  "$BRAIN" omi-outbox --project "$project"
done

# 3) Send only Dennis-authorized memory classes to Omi and require Developer-API readback.
cd "$MC_ROOT"
OMI_OUTBOUND_AUTHORITY="$AUTHORITY" \
OMI_DEV_KEY_FILE="$KEY_FILE" \
OMI_OUTBOX_DIR="$BRAIN_ROOT/_system/outbox/omi" \
OMI_OUTBOUND_STATE_DIR="$STATE_DIR" \
./node_modules/.bin/tsx scripts/run-omi-outbound.ts

echo "OMI_MEMORY_CYCLE_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
