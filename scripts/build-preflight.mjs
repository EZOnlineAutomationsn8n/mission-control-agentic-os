// Build preflight (MC-SBC-OMI-INTAKE-AND-I4-CANARY-PREP-001 repair, 2026-10-02).
// Fails fast, with an actionable message, on the two defects that broke the
// canonical production build:
//   1. generated .next content owned by another uid (root-run builds) -> EACCES mid-build;
//   2. next/font/google imports -> build-time network fetch (Zone A is network none).
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const uid = process.getuid?.();
const problems = [];

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (visit(p, st) === false) return false;
    if (st.isDirectory() && walk(p, visit) === false) return false;
  }
  return true;
}

const dist = join(root, ".next");
if (uid !== undefined && existsSync(dist)) {
  if (uid === 0) problems.push("BUILD_AS_ROOT_REFUSED: run the build as the project user (agentlab); a root build leaves root-owned .next artifacts.");
  const foreign = [];
  const check = (p, st) => { if (st.uid !== uid) { foreign.push(p); if (foreign.length >= 5) return false; } };
  check(dist, lstatSync(dist));
  walk(dist, check);
  if (foreign.length) problems.push(`NEXT_DIR_FOREIGN_OWNERSHIP: .next contains entries not owned by uid ${uid}, e.g.\n    ${foreign.join("\n    ")}\n  Move the tree aside (mv .next .next.preserved-<ts>) or fix ownership before building.`);
}

const offenders = [];
walk(join(root, "src"), (p, st) => {
  if (st.isFile() && /\.(tsx?|jsx?|mjs)$/.test(p) && /from\s+["']next\/font\/google["']/.test(readFileSync(p, "utf8"))) offenders.push(p);
});
if (offenders.length) problems.push(`NETWORK_FONT_IMPORT: next/font/google is not allowed (offline canonical build):\n    ${offenders.join("\n    ")}`);

for (const f of ["node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2", "node_modules/geist/LICENSE.txt"]) {
  if (!existsSync(join(root, f))) problems.push(`LOCAL_FONT_ASSET_MISSING: ${f} (run npm ci)`);
}

if (problems.length) {
  console.error("BUILD_PREFLIGHT=FAIL\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("BUILD_PREFLIGHT=PASS (offline fonts, .next ownership clean)");
