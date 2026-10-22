# Claude Code Working Rules — Mission Control / Agentic OS

Follow `AGENTIC_OS_BUILD_POLICY.md` and the standing execution contract:
`/opt/shared/agentic-sandbox/workspace/execution/CONTINUOUS_EXECUTION_AND_DEFERRED_OPERATOR_BOUNDARY_CONTRACT.md`.

This file governs Claude Code in the Mission Control repository only. It does not define OpenClaw, Hermes, Codex, Antigravity, provider fallback, or another runtime.

## Mission
Reconstruct Mission Control / Agentic OS into a user-operable end product.

Core product rules:
- functionality before labels;
- browser UI proof before READY claims;
- no fake Send buttons or fake terminal panels;
- no broad new modules unless the current order requires them;
- no report-only progress when executable work remains;
- no secrets in output;
- no tmux attach;
- no service restart, deployment, publication, package install, or privileged mutation unless current Dennis authority explicitly permits it.

Claude Code Agent on Home is a real agent terminal:
Start Claude Code -> persistent Claude Code session -> input -> Send -> agent output/history.
FCC is only the model gateway. A raw FCC completion is diagnostic evidence, not Claude Code agent success.

## Authority and execution precedence
1. Current explicit Dennis work order / authority.
2. Mission Control project-local source and policy.
3. The continuous-execution contract named above.
4. This Claude Code protocol.

Do not import another runtime's bootstrap or adapter merely because it is present in this repository. In particular, the root `AGENTS.md` contains OpenClaw runtime material and is NOT Claude Code authority unless a current Dennis order explicitly names it.

## A-to-Z execution rule
For every non-trivial pass, execute the authorized objective end-to-end without repeatedly returning to Dennis.

A local blocker is not a mission stop.
- If an item needs Dennis but independent authorized work remains, record it as a `PARKED_ITEM` with exact evidence and re-entry point, then continue.
- Collect Dennis-only decisions, credentials, approvals, external actions, destructive actions, deployment/publication actions, or authority expansions into one `OPERATOR_BATCH` after the executable frontier is exhausted.
- Return only when one of these is true:
  - `GOAL_REACHED=YES`; or
  - `EXECUTABLE_FRONTIER_EMPTY=YES` with remaining items parked/dependency-blocked; or
  - `GLOBAL_BLOCKER=YES` with evidence that all safe continuation is invalid.
- Time elapsed, token count, a checkpoint, one failed branch, or one permission prompt is never by itself a valid stopping condition.

This rule changes continuation behavior only. It creates no new mutation authority.

## Source-first, bounded inspection
Inspect the smallest source set that can answer the current question.
Do not perform broad filesystem discovery by default.
Do not search unrelated projects.
Use project-local files first; use named external source paths only when the current order or policy requires them.

Subagents are optional, not mandatory. Use them only when they materially improve a bounded task. Do not create parallel overlapping mutation lanes merely because subagents are available.

## Planning and ambiguity
For non-trivial work, maintain a compact implementation plan/spec internally or as a project artifact when useful. The plan is an execution aid, not an automatic Dennis approval gate.

Do NOT stop to ask Dennis to accept a plan when the current order already provides sufficient intent, scope, and mutation authority.

If a requirement is ambiguous:
- first continue every safe action that does not depend on that ambiguity;
- park the ambiguous branch if needed;
- ask Dennis only when the ambiguity globally blocks safe continuation or when operator intent is genuinely required.

## Verification
Before meaningful mutation, know how the result will be verified.
After mutation, run the relevant proof.

Verification may include:
- targeted tests;
- `npm run build`;
- typecheck/lint;
- git diff/status;
- endpoint checks;
- connector/runtime checks;
- browser UI proof;
- logs;
- source/readback checks.

Do not claim completion without evidence.
A checkpoint is evidence and re-entry state, not an approval gate.

## Permission and shell behavior
Avoid routine permission dead-ends.

For Mission Control read/build/test diagnostics:
- prefer Claude Read/Glob/Grep tools for files instead of broad shell `find` commands;
- for one-command temporary environment variables, use `env KEY=VALUE ... command`;
- never use `export KEY=VALUE command`;
- for the FCC launcher use only these pre-approved bounded timeout forms: 30, 60, or 120 seconds;
- canonical launcher shape: `env CLAUDE_WORKDIR=/workspace/projects/mission-control CLAUDE_BARE=1 CLAUDE_QUIET=1 timeout <30|60|120> /runtime/bin/start-claude-fcc.sh ...`;
- do not invent a different launcher timeout when one of those values is sufficient;
- do not append `; echo ...`, `&& echo ...`, or other compound shell fragments to an otherwise pre-approved launcher probe; run any secondary status check separately;
- use the canonical FCC read boundary `/opt/vireon/workfloor/fcc/**` when FCC source inspection is required;
- do not bundle many unrelated diagnostics into one compound shell command when separate pre-approved reads/probes will avoid an approval prompt;
- if one routine command form is denied but an equivalent pre-approved form exists, reformulate and continue;
- do not bypass permissions and do not expand authority merely to avoid a prompt.

If a command would trigger an interactive Dennis approval but is not globally blocking, do not stop the whole pass at that prompt. Park that exact action and continue the remaining executable frontier.

## Runtime separation
Claude Code identity = Claude Code.
FCC identity = model gateway / transport layer.
Backing runtime model = report only when machine-readable evidence proves it.
OpenClaw bootstrap/adapter rules do not govern Claude Code.
Hermes/Codex/Antigravity rules do not govern Claude Code.

## Final return
On return, report exact files changed, verification performed, remaining parked items, re-entry points, and whether the goal is reached. Do not turn intermediate progress into a final return while authorized executable work remains.
