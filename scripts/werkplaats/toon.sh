#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
# This same helper can execute from the existing stage worktree before
# promotion, or from main after Dennis has promoted the source. No clone.
[[ "$(basename "$ROOT")" =~ ^\.stage- ]] && ROOT="$(dirname "$ROOT")"
[[ $# -ge 1 ]] || { echo "FOUT: geef de naam"; exit 2; }
NAME="$1"
[[ "$NAME" =~ ^[a-z][a-z0-9-]{0,39}$ ]] || { echo "FOUT: naam onjuist"; exit 2; }
STAGE="$ROOT/.stage-$NAME"
[[ -s "$STAGE/.next/BUILD_ID" ]] || { echo "FOUT: werkplaats heeft geen succesvolle build"; exit 3; }
[[ "$(git -C "$STAGE" branch --show-current)" == "werkplaats/$NAME" ]] || { echo "FOUT: niet de verwachte Git-werkplaats"; exit 4; }
REQ="/workspace/ops/requests"
RES="/workspace/ops/results"
send_request() {
 local id="werkplaats-$NAME-$(date -u +%Y%m%dT%H%M%S)-$$-$1"
 printf '%s\n' "$2" > "$REQ/$id.req"
 for i in $(seq 1 45); do [[ -f "$RES/$id.txt" ]] && break; sleep 1; done
 [[ -f "$RES/$id.txt" ]] || { echo "FOUT: claude-ops ontvangstbewijs ontbreekt voor $id (niet opnieuw proberen)"; exit 6; }
 cat "$RES/$id.txt"
 grep -q 'rc=0' "$RES/$id.txt" || { echo "FOUT: claude-ops weigerde opdracht $id"; exit 7; }
}
send_request status 'mc-preview-status'
STATUS_RECEIPT="$(find "$RES" -maxdepth 1 -name "werkplaats-$NAME-*$$-status.txt" -print | sort | tail -1)"
if [[ -n "$STATUS_RECEIPT" ]] && grep -Eq '^preview pids/cwd:' "$STATUS_RECEIPT"; then
 echo "FOUT: er draait al een preview. Niet stoppen zonder source-ownercontrole."
 exit 8
fi
send_request stop 'mc-preview-stop'
# Stage-native selection must not silently rewire to LIVE production connectors.
[[ -d "$STAGE/.preview-native-home/hermes" && -d "$STAGE/.preview-native-home/openclaw" ]] ||
  { echo "FOUT: stage-native homes ontbreken; geen productieproxy"; exit 9; }
[[ -x "$STAGE/.preview-acf-runtime/acf" ]] ||
  { echo "FOUT: stage-only ACF runtime ontbreekt; bouw de werkplaats opnieuw"; exit 10; }
send_request start "mc-preview-start .stage-$NAME native-stage"
echo "Kijk op https://werkplaats.mc.vireonhq.cloud"
echo "DNS/TLS moet bestaan voor de publieke link. Interne Apps Browser: http://shared-agentic-sandbox:3331/team-room"
