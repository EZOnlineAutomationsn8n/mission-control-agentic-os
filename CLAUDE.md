# Claude / Fable Working Rules — Agentic OS

Follow `AGENTIC_OS_BUILD_POLICY.md`.

Do not steer this project back into disabled monitoring cards.

The current mission:
reconstruct the existing Agentic OS app into a user-operable end product.

Rules:
- functionality before labels;
- browser UI proof before ready claims;
- no fake Send buttons;
- no fake terminal panels;
- no broad new modules;
- no report-only progress;
- no secrets;
- no tmux attach;
- no service restarts unless explicitly requested.

First implementation target:
FCC / OwlAlpha on Home as a real work pane:
one input → Send → output/history.

---

# Claude Code Operating Protocol

These rules define how Claude Code should work in this repo.

They do not define other agents, orchestrators, providers, provider fallback, or external tools.

## 1. Use subagents more often for substantial work

Claude Code should use subagents more frequently for serious project work.

Assume non-trivial work can benefit from subagents unless there is a clear reason not to.

Use subagents for:
- parallel inspection;
- multiple perspectives;
- broad search;
- code review from different angles;
- verification planning;
- independent workstreams;
- large refactors;
- architecture review;
- documentation review;
- risk analysis;
- UI/UX review;
- test planning.

Do not use subagents when the task is clearly small, atomic, low-risk, and faster to do directly.

When using subagents:
- keep their tasks isolated;
- avoid overlapping file mutations unless explicitly approved;
- prefer subagents for inspection, planning, review, verification, and independent lanes before code mutation.

## 2. Create an implementation spec before non-trivial building

Before meaningful code or infrastructure changes, create an implementation spec.

The spec must include:
- what is being built;
- why it is being built;
- what is in scope;
- what is out of scope;
- which files may be touched;
- which files must not be touched;
- key decisions;
- default choices;
- risks;
- verification method;
- rollback or recovery path.

Do not start meaningful mutation before the spec is accepted, unless the task is clearly small and low-risk.

## 3. Interview when requirements are unclear

If requirements are unclear, interview the user before building.

Ask focused questions.
Do not overload the user with too many questions at once.
Ask only what is needed to remove ambiguity.

The interview should identify:
- the core problem;
- who or what the work is for;
- who or what it is not for;
- what success looks like;
- what failure looks like;
- key decisions that affect implementation.

After the interview, summarize the answers as an implementation spec.

## 4. Verify before and after building

Before doing work, state how the result will be verified.

After finishing, run the verification and report exact proof.

Verification may include:
- npm build;
- tests;
- typecheck;
- git diff;
- git status;
- curl endpoint checks;
- connector status checks;
- browser UI check;
- log review;
- grep/source checks;
- runtime proof.

Do not claim completion without proof.

## 5. Build skills from proven workflows

When a workflow is repeated and has worked, suggest turning it into a Claude Code skill or reusable protocol.

Do not invent skills abstractly.

Only suggest a skill after a real workflow has been performed and proven useful.

Every reusable skill or protocol should include:
- when to use it;
- when not to use it;
- inputs needed;
- exact workflow;
- verification steps;
- gotchas;
- expected output.

## 6. Treat automation carefully

Before proposing automation, run:
- a taste-test: does this require human judgment or taste?
- an 80/20 check: would 80 percent quality be acceptable?

If the task needs human judgment, exact quality, approval, or high trust, propose augmentation instead of full automation.

Automation comes after a proven workflow, not before.
