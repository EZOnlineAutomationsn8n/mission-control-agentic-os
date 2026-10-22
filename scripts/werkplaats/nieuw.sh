#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
[[ $# -ge 1 ]] || { echo "FOUT: geef de naam van de werkplaats"; exit 2; }
NAME="$1"
if [[ ! "$NAME" =~ ^[a-z][a-z0-9-]{0,39}$ ]]; then echo "FOUT: gebruik naam met kleine letters, cijfers en streepjes"; exit 2; fi
STAGE="$ROOT/.stage-$NAME"
BRANCH="werkplaats/$NAME"
TEMPLATE="$ROOT/.stage-mc-acf-free-room-ui-20261021-001"
if [[ -e "$STAGE" ]] || git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "FOUT: werkplaats of Git-tak bestaat al. Geen overschrijving: $NAME"; exit 3
fi
[[ -f "$TEMPLATE/.preview-acf-home/participant_routes.json" ]] || { echo "FOUT: geïsoleerde routetemplate ontbreekt"; exit 4; }
[[ -d "$TEMPLATE/node_modules" ]] || { echo "FOUT: node_modules template ontbreekt"; exit 4; }
[[ "$(git -C "$ROOT" branch --show-current)" == main ]] || { echo "FOUT: bron staat niet op main"; exit 5; }
git -C "$ROOT" diff --quiet HEAD -- src package.json next.config.ts || { echo "FOUT: TEKENING is niet schoon in broncode"; exit 5; }
git -C "$ROOT" worktree add -b "$BRANCH" "$STAGE" main
mkdir -m 700 -p "$STAGE/data" "$STAGE/.preview-acf-home" "$STAGE/.preview-ops" "$STAGE/.preview-omi"
cp "$TEMPLATE/.preview-acf-home/participant_routes.json" "$STAGE/.preview-acf-home/participant_routes.json"
python3 - "$STAGE/.preview-acf-home/participant_routes.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
def verify(x):
    if isinstance(x,dict):
        for k,v in x.items():
            if k == 'base_url':
                assert v.startswith('http://127.0.0.1:9/'), "FOUT: preview-agentroute is niet geïsoleerd"
            else: verify(v)
    elif isinstance(x,list):
        for v in x:verify(v)
verify(d)
PY
chmod 600 "$STAGE/.preview-acf-home/participant_routes.json"
# Toegestane hardlink-kopie: afhankelijkheden blijven geïsoleerd van de LIVE-node_modules.
cp -al "$TEMPLATE/node_modules" "$STAGE/node_modules"
echo "KLAAR: TEKENING main -> $STAGE (Git-tak $BRANCH)."
echo "Geïsoleerde datamappen aangemaakt. Geen echte agentverbinding of live-release."
