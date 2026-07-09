# END PRODUCT RECONSTRUCTION PLAN — Agentic OS / Mission Control

## Current target

Reconstruct the existing app into a user-operable Agentic OS cockpit.

The target is not a minimal demo and not a monitoring page. The target is an end-product path: a cockpit the user can actually operate.

## What went wrong

Prior guidance over-constrained the build around read/health detection and disabled commands. That produced monitoring cards instead of an operator workbench.

The old reports have been moved to `reports/obsolete/` and must not steer implementation.

## First functional line: FCC / OwlAlpha

FCC is the first connector with a real usable product path.

Known route:
Browser UI
→ `/api/connectors/fcc/actions/ask`
→ `src/lib/connectors/live/fcc-actions.ts`
→ `http://127.0.0.1:8082/v1/messages`
→ local FCC service
→ OpenRouter model route
→ response returned to UI.

Required cockpit state:
- FCC pane visible on Home;
- one input only;
- one Send button;
- output/history in the same FCC pane;
- Evidence event on submit;
- prompt test: `Say kiwi and nothing else`;
- expected visible result: `kiwi`.

## Cockpit structure

Home must be the cockpit, not a menu.

Each main agent pane must be either:

1. Usable:
   - input;
   - Send/Run;
   - output/history;
   - last action;
   - audit/evidence link if applicable.

2. Not yet usable:
   - exact missing integration;
   - no fake Send;
   - no fake terminal.

## Connector maturity map

FCC / OwlAlpha:
- first user-operable work pane.

Hermes:
- needs platform bridge + command route.

OpenClaw:
- needs safe endpoint or real console handoff;
- old session must remain untouched.

Obsidian:
- needs safe cockpit read/search action.

Paperclip:
- open/use available surface first.

n8n:
- needs credential bridge or known safe webhook.

AGY:
- project context read is useful;
- job dispatch needs explicit endpoint.

Browser Agents:
- needs CDP/runtime.

## Sellable product checklist

- user can operate FCC from Home;
- no duplicate FCC input boxes;
- no fake Send buttons;
- blocked agents show exact missing integration;
- Evidence/Logs persist real actions;
- Work Queue shows real pending/actions;
- Registry separates health from usability;
- navigation is responsive;
- browser UI proof is required before marking anything ready.

## Next implementation sequence

1. FCC Home work pane.
2. Remove duplicate/fake command surfaces.
3. Obsidian read/search action.
4. Open real console links where available.
5. Add safe integrations one by one.
6. Only after user-operable workflows are proven, polish for sellable presentation.

