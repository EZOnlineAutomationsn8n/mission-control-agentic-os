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
[[ -d "$STAGE" && -f "$STAGE/.git" && -f "$STAGE/next.config.ts" ]] || { echo "FOUT: geen erkende werkplaats-Git-worktree"; exit 3; }
[[ "$(git -C "$STAGE" branch --show-current)" == "werkplaats/$NAME" ]] || { echo "FOUT: niet de juiste werkplaats-tak"; exit 3; }
[[ "$STAGE" != "$ROOT" ]] || { echo "FOUT: no-build-in-LIVE"; exit 4; }
[[ -f "$STAGE/.preview-acf-home/participant_routes.json" ]] || { echo "FOUT: geïsoleerde routes ontbreken"; exit 4; }
# The build must be attributable to one committed source tree. Otherwise a
# later Dennis-governed promotion cannot prove what has been tested.
git -C "$STAGE" diff --quiet HEAD -- src scripts package.json next.config.ts ||
  { echo "FOUT: commit de stagecode eerst; build-provenance is anders ambigu"; exit 6; }
git -C "$STAGE" diff --cached --quiet -- src scripts package.json next.config.ts ||
  { echo "FOUT: staged maar niet vastgelegde bronwijzigingen"; exit 6; }
cd "$STAGE"
echo "BOUW: uitsluitend in werkplaats $STAGE."
unset MC_ALLOW_LIVE_BUILD
python3 scripts/werkplaats/prepare-acf-runtime.py "$STAGE"
npm run build
./node_modules/.bin/tsc --noEmit
npm run lint
[[ -s .next/BUILD_ID ]] || { echo "FOUT: geen build-ID"; exit 5; }
# Next 16 instrumentation file traces are not covered by route-scoped excludes.
# Sanitise only generated .nft JSON references, never runtime private files.
python3 scripts/werkplaats/sanitize-private-traces.py "$STAGE"

mkdir -m 700 -p .werkplaats-release-source
cat .next/BUILD_ID > .werkplaats-release-source/BUILD_ID
git rev-parse HEAD > .werkplaats-release-source/SOURCE_COMMIT
chmod 600 .werkplaats-release-source/BUILD_ID .werkplaats-release-source/SOURCE_COMMIT
echo "BRONBEWIJS: $(cat .werkplaats-release-source/SOURCE_COMMIT) -> $(cat .werkplaats-release-source/BUILD_ID)"
echo "KLAAR: werkplaats $NAME, build $(cat .next/BUILD_ID). LIVE niet gewijzigd."
