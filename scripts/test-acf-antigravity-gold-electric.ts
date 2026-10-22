import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function src(path: string): string {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

const team = src("src/components/team-room/TeamRoomView.tsx");
const css = src("src/app/globals.css");

test("3.5-second Team Room autoplay preview is view-only and manually stoppable", () => {
  assert.match(team, /const \[previewPlaying, setPreviewPlaying\] = useState\(true\)/);
  assert.match(team, /window\.setInterval\(\(\) => \{/);
  assert.match(team, /\}, 3_500\)/);
  assert.match(team, /setPreviewPlaying\(false\)/);
  assert.match(team, /View-only focus movement every 3\.5 seconds/);
  assert.match(team, /no agent is invoked and nobody is claimed to be speaking/);
});

test("reduced-motion disables automatic preview and visual animation", () => {
  assert.match(team, /prefers-reduced-motion: reduce/);
  assert.match(team, /if \(!previewPlaying \|\| prefersReducedMotion\) return/);
  assert.match(team, /disabled=\{prefersReducedMotion\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /acfGoldElectricTravel/);
  assert.match(css, /animation: none !important/);
});

test("existing four-card room remains and focus is an enlarged overlay with Collapse", () => {
  assert.match(team, /<div className="acf-shell-grid">/);
  assert.match(team, /acf-shell-focus-overlay/);
  assert.match(team, /className="acf-shell-focus-card"/);
  assert.match(team, />\s*Collapse\s*<\/button>/);
  assert.match(css, /\.acf-shell-focus-overlay \{/);
  assert.match(css, /position: absolute/);
  assert.match(css, /\.acf-shell-focus-overlay \.acf-shell-focus-card/);
});

test("illustrated Team Room is exactly three agents plus one orchestrator", () => {
  assert.match(team, /"hermes", "claude-code", "openclaw", "antigravity"/);
  assert.match(team, /SHELL_ORCHESTRATOR_COUNT/);
  assert.match(team, /SHELL_WORKER_COUNT/);
  assert.match(team, /AGENTS \+ \{SHELL_ORCHESTRATOR_COUNT\} ORCHESTRATOR/);
});

test("AntiGravity 2.0 has persistent orchestrator identity and crown", () => {
  assert.match(team, /AntiGravity 2\.0/);
  assert.match(team, /acf-orchestrator-anchor/);
  assert.match(team, /acf-orchestrator-crown/);
  assert.match(team, /♛/);
  assert.match(team, /ORCHESTRATOR/);
  assert.match(css, /ACF AntiGravity 2\.0 \/ gold electric orchestrator refinement/);
  assert.match(css, /acf-orchestrator-anchor-name/);
  assert.match(css, /acfGoldElectricTravel/);
  assert.match(css, /acfGoldElectricEdge/);
});

test("Hermes Claude Code and OpenClaw remain in distinct cool cyan-blue Team Room styling", () => {
  assert.match(css, /\.acf-shell \[data-agent="hermes"\]/);
  assert.match(css, /\.acf-shell \[data-agent="claude-code"\]/);
  assert.match(css, /\.acf-shell \[data-agent="openclaw"\]/);
  assert.match(css, /#67e8f9/);
  assert.match(css, /#38bdf8/);
  assert.match(css, /#60a5fa/);
  assert.match(css, /#3b82f6/);
  assert.match(css, /#2563eb/);
  assert.match(css, /#22d3ee/);
});

test("visual refinement does not create ACF activity or backend mutation paths", () => {
  const shellStart = team.indexOf("function TeamRoomShell");
  const shellEnd = team.indexOf("export function TeamRoomView");
  assert.ok(shellStart >= 0 && shellEnd > shellStart);
  const shell = team.slice(shellStart, shellEnd);
  assert.doesNotMatch(shell, /fetch\(/);
  assert.doesNotMatch(shell, /method:\s*["']POST["']/);
  assert.doesNotMatch(shell, /bind-participant|post-message|dispatch|startRun|stopRun/);
  assert.match(shell, /no ACF orchestration claim/);
  assert.match(shell, /operational state remains evidence-backed/);
});
