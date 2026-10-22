import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

const focus = source("src/components/shell/PanelFocus.tsx");
const layout = source("src/app/layout.tsx");
const sidebar = source("src/components/shell/Sidebar.tsx");
const topbar = source("src/components/shell/TopBar.tsx");
const home = source("src/components/control-room/TerminalWorkspace.tsx");
const team = source("src/components/team-room/TeamRoomView.tsx");
const controlRoom = source("src/components/control-room/ControlRoom.tsx");
const mastermind = source("src/app/mastermind/page.tsx");
const brain = source("src/components/brain/BrainView.tsx");
const evidence = source("src/components/evidence/EvidenceView.tsx");
const queue = source("src/components/queue/QueueBoard.tsx");
const pipeline = source("src/app/pipeline/page.tsx");
const approvals = source("src/components/approvals/ApprovalsCenter.tsx");
const registry = source("src/components/registry/RegistryTable.tsx");
const projects = source("src/components/projects/ProjectLayer.tsx");
const paperclip = source("src/app/paperclip/page.tsx");
const css = source("src/app/globals.css");

test("one shared focus provider owns application pane focus", () => {
  assert.match(layout, /<PanelFocusProvider>/);
  assert.match(focus, /const PanelFocusContext = createContext/);
  assert.match(focus, /focusedPanelId/);
  assert.doesNotMatch(focus, /createPortal|cloneElement/);
  assert.doesNotMatch(focus, /fetch\(|XMLHttpRequest|sessionEndpoint|actionEndpoint/);
});

test("focus preserves mounted component identity instead of recreating work panes", () => {
  assert.match(focus, /mc-focusable-panel/);
  assert.match(focus, /mc-focus-panel-body/);
  assert.doesNotMatch(focus, /focused \? children : null|focusedPanelId.*key=/);
  assert.match(home, /target\.id.*sessionId/);
  assert.doesNotMatch(home, /key=\{[^}]*focused/);
});

test("keyboard restore and panel keyboard maximize are accessible", () => {
  assert.match(focus, /event\.key !== "Escape"/);
  assert.match(focus, /event\.altKey && event\.key === "Enter"/);
  assert.match(focus, /aria-pressed=\{focused\}/);
  assert.match(topbar, /onClick=\{restoreLayout\}/);
});

test("sidebar collapses to shared icon rail and restores with focus state", () => {
  assert.match(sidebar, /usePanelFocus/);
  assert.match(sidebar, /mc-sidebar-focus-rail/);
  assert.match(css, /\.mc-sidebar\.mc-sidebar-focus-rail/);
  assert.match(css, /width: 3\.75rem !important/);
});

test("home supports four persistent panes, tablet 2-up and phone focus-first", () => {
  assert.match(home, /home-pane-/);
  assert.match(home, /mc-terminal-grid grid grid-cols-1 md:grid-cols-2/);
  assert.match(home, /mc-mobile-pane-switcher/);
  assert.match(home, /role="tab"/);
  assert.match(home, /aria-selected=\{activeSlot === slotIndex\}/);
  assert.match(css, /mc-terminal-pane-slot:not\(\.mc-terminal-pane-slot-active\)/);
  assert.match(css, /min-width: 641px/);
  assert.match(css, /max-width: 1279px/);
});

test("all applicable current Mission Control work surfaces use the same focus wrapper", () => {
  const coverage: Array<[string, string, RegExp]> = [
    ["home", home, /home-pane-/],
    ["team-room illustrated", team, /acf-illustrated-/],
    ["team-room real participants", team, /acf-participant-/],
    ["system work", controlRoom, /-work/],
    ["system output", controlRoom, /-output/],
    ["mastermind", mastermind, /mastermind-dispatch/],
    ["brain sources", brain, /brain-sources/],
    ["brain continuity", brain, /brain-continuity/],
    ["evidence live audit", evidence, /evidence-live-audit/],
    ["evidence persisted audit", evidence, /evidence-persisted-audit/],
    ["evidence logs", evidence, /evidence-structured-logs/],
    ["evidence reports", evidence, /evidence-reports/],
    ["queue board", queue, /queue-board/],
    ["queue evidence", queue, /queue-evidence/],
    ["pipeline", pipeline, /pipeline-board/],
    ["approvals", approvals, /approvals-queue/],
    ["registry", registry, /registry-systems/],
    ["project compose", projects, /projects-compose/],
    ["project list", projects, /projects-list/],
    ["paperclip runtime", paperclip, /paperclip-runtime/],
  ];
  for (const [label, text, pattern] of coverage) {
    assert.match(text, pattern, label);
    assert.match(text, /FocusablePanel/, label + " must use shared FocusablePanel");
  }
});

test("focus styling uses one fixed work-area model across breakpoints", () => {
  assert.match(css, /\.mc-panel-focused \{/);
  assert.match(css, /position: fixed !important/);
  assert.match(css, /@media \(max-width: 1279px\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test("reduced motion disables focus transitions and orchestrator pulse", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /mcOrchestratorGoldPulse/);
  assert.match(css, /animation: none !important/);
});

test("AntiGravity is the illustrated golden orchestrator and three peers are agents", () => {
  assert.match(team, /"hermes", "claude-code", "openclaw", "antigravity"/);
  assert.match(team, /SHELL_ORCHESTRATOR_COUNT/);
  assert.match(team, /SHELL_WORKER_COUNT/);
  assert.match(team, /AntiGravity/);
  assert.match(team, /ORCHESTRATOR · NO ACF ACTIVITY CLAIM/);
  assert.match(team, /AGENT · NOT YET ACF PARTICIPANT/);
  assert.match(team, /"gold" : "default"/);
  assert.match(css, /ACF AntiGravity golden orchestrator identity/);
});

test("golden animation is presentation-only and ACF readiness stays source-derived", () => {
  assert.match(team, /Visual emphasis never implies an orchestration decision/);
  assert.doesNotMatch(focus, /acf|orchestrator|runtime.*status/i);
  assert.match(team, /deriveParticipantReadiness/);
});

test("shared focus layer adds no runtime, session or ACF mutation path", () => {
  const focusRelated = [focus, layout, sidebar, topbar];
  for (const text of focusRelated) {
    assert.doesNotMatch(text, /method:\s*"POST"|action:\s*"start"|bind-participant|post-message|acf-writer/);
  }
});
