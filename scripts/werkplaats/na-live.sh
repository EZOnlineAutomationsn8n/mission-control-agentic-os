#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
[[ $# -ge 1 ]] || { echo "FOUT: geef de naam"; exit 2; }
NAME="$1"
[[ "$NAME" =~ ^[a-z][a-z0-9-]{0,39}$ ]] || { echo "FOUT: naam onjuist"; exit 2; }
STAGE="$ROOT/.stage-$NAME"
[[ -s "$STAGE/.next/BUILD_ID" ]] || { echo "FOUT: werkplaats zonder build"; exit 3; }
[[ "$(printenv DENNIS_RELEASE_GO_CONFIRMED || true)" == 1 ]] || { echo "FOUT: dit mag pas NA Dennis' expliciete productie-GO in CSA"; exit 4; }
EXPECTED="$(cat "$STAGE/.next/BUILD_ID")"
ACTUAL="$(cat "$ROOT/.next/BUILD_ID")"
[[ "$EXPECTED" == "$ACTUAL" ]] || { echo "FOUT: LIVE is niet exact de geteste build ($ACTUAL versus $EXPECTED)"; exit 5; }
[[ "$(git -C "$ROOT" branch --show-current)" == main ]] || { echo "FOUT: bronbranch is niet main"; exit 6; }
[[ "$(git -C "$STAGE" branch --show-current)" == "werkplaats/$NAME" ]] || { echo "FOUT: verkeerde worktree"; exit 6; }
git -C "$ROOT" diff --quiet HEAD -- src package.json next.config.ts || { echo "FOUT: bron is buiten werkplaats gewijzigd"; exit 7; }
git -C "$ROOT" merge --no-ff "werkplaats/$NAME" -m "main: Dennis-certified live $EXPECTED from werkplaats/$NAME"
git -C "$ROOT" tag -a "live-$EXPECTED" -m "Dennis release verified: $NAME $EXPECTED"
echo "KLAAR: LIVE $ACTUAL terugvastgelegd in TEKENING. Geen release uitgevoerd."
