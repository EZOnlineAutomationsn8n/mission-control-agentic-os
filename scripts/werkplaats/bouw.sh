#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
[[ $# -ge 1 ]] || { echo "FOUT: geef de naam"; exit 2; }
NAME="$1"
[[ "$NAME" =~ ^[a-z][a-z0-9-]{0,39}$ ]] || { echo "FOUT: naam onjuist"; exit 2; }
STAGE="$ROOT/.stage-$NAME"
[[ -d "$STAGE" && -f "$STAGE/.git" && -f "$STAGE/next.config.ts" ]] || { echo "FOUT: geen erkende werkplaats-Git-worktree"; exit 3; }
[[ "$(git -C "$STAGE" branch --show-current)" == "werkplaats/$NAME" ]] || { echo "FOUT: niet de juiste werkplaats-tak"; exit 3; }
[[ "$STAGE" != "$ROOT" ]] || { echo "FOUT: no-build-in-LIVE"; exit 4; }
[[ -f "$STAGE/.preview-acf-home/participant_routes.json" ]] || { echo "FOUT: geïsoleerde routes ontbreken"; exit 4; }
cd "$STAGE"
echo "BOUW: uitsluitend in werkplaats $STAGE."
unset MC_ALLOW_LIVE_BUILD
npm run build
./node_modules/.bin/tsc --noEmit
npm run lint
[[ -s .next/BUILD_ID ]] || { echo "FOUT: geen build-ID"; exit 5; }
echo "KLAAR: werkplaats $NAME, build $(cat .next/BUILD_ID). LIVE niet gewijzigd."
