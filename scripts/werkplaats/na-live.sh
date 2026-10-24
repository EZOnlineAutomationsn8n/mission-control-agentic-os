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
# The governed mc-release moves the exact stage .next directory into LIVE.
# Stage .next therefore can legitimately be absent AFTER release. Preserve
# build/source proof independently before release, and require its match.
[[ -s "$STAGE/.werkplaats-release-source/BUILD_ID" &&
   -s "$STAGE/.werkplaats-release-source/SOURCE_COMMIT" ]] ||
  { echo "FOUT: geen gecertificeerd stage-build/source paar"; exit 3; }
[[ "$(printenv DENNIS_RELEASE_GO_CONFIRMED || true)" == 1 ]] || { echo "FOUT: dit mag pas NA Dennis' expliciete productie-GO in CSA"; exit 4; }
EXPECTED="$(cat "$STAGE/.werkplaats-release-source/BUILD_ID")"
EXPECTED_SOURCE="$(cat "$STAGE/.werkplaats-release-source/SOURCE_COMMIT")"
ACTUAL="$(cat "$ROOT/.next/BUILD_ID")"
[[ "$(git -C "$STAGE" rev-parse HEAD)" == "$EXPECTED_SOURCE" ]] ||
  { echo "FOUT: staged broncommit is na certificering gewijzigd"; exit 5; }
[[ ! -f "$STAGE/.next/BUILD_ID" || "$(cat "$STAGE/.next/BUILD_ID")" == "$EXPECTED" ]] ||
  { echo "FOUT: lokale stage-build mismatch met releasebewijs"; exit 5; }
[[ "$EXPECTED" == "$ACTUAL" ]] || { echo "FOUT: LIVE is niet exact de geteste build ($ACTUAL versus $EXPECTED)"; exit 5; }
[[ "$(git -C "$ROOT" branch --show-current)" == main ]] || { echo "FOUT: bronbranch is niet main"; exit 6; }
[[ "$(git -C "$STAGE" branch --show-current)" == "werkplaats/$NAME" ]] || { echo "FOUT: verkeerde worktree"; exit 6; }
git -C "$ROOT" diff --quiet HEAD -- src package.json next.config.ts || { echo "FOUT: bron is buiten werkplaats gewijzigd"; exit 7; }
git -C "$ROOT" merge --no-ff "werkplaats/$NAME" -m "main: Dennis-certified live $EXPECTED from werkplaats/$NAME"
git -C "$ROOT" tag -a "live-$EXPECTED" -m "Dennis release verified: $NAME $EXPECTED"
echo "KLAAR: LIVE $ACTUAL terugvastgelegd in TEKENING. Geen release uitgevoerd."
