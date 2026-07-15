# Mission Control staging acceptance — 2026-07-15

## Gate trace

- Source: `sandbox/functional-agentic-os`
- Local accepted code SHA: `13ac58e`
- VPS sandbox accepted code SHA: `2bb4ddd`
- Authority: operator-approved sandbox implementation; no live deployment authority
- Intent: a functional Agentic OS cockpit with real, interchangeable agent sessions and durable operator state
- Execution: isolated VPS sandbox, PostgreSQL persistence, on-demand CLI bridges, read-only service bridges
- Proof: browser-observed agent replies, fresh API reads, database rows, audit events, build/tests, and unchanged live health

## Runtime boundary

| Object | Location | Address | State |
| --- | --- | --- | --- |
| Engineering source | Windows sandbox checkout | `.sandbox-engineering/mission-control` | clean branch |
| Staging source | VPS sandbox container | `/workspace/projects/mission-control` | clean branch |
| Staging cockpit | VPS sandbox | internal `3330`, Windows tunnel `127.0.0.1:3330` | HTTP 200 |
| Staging database | VPS sandbox PostgreSQL | private Docker network | healthy |
| Existing live cockpit | VPS | `127.0.0.1:3320` | HTTP 200, untouched |

The staging container runs as uid `26001`, with a read-only root filesystem, no Linux capabilities, no Docker socket, and a dedicated project workspace. Production vault data is represented by a read-only snapshot.

## Operator workflow proof

The visible Home cockpit contains four tall, interchangeable terminals in a 2×2 grid. Each terminal supports explicit start/stop, prompt/send, persisted output, file attachment, camera input, clear confirmation, and exact session identity.

| Agent | Session proof | Browser/API result |
| --- | --- | --- |
| Claude Code | `6232a7c9-8cc3-47ba-89df-d5ef4bbbd6a6` | `CLAUDE_CODE_UI_BROWSER_PASS` |
| Hermes | `20260715_052847_d068e8` | `HERMES_UI_BROWSER_PASS` |
| Antigravity | `8ce299f7-10d2-4d42-8fc8-4307d975438a` | `ANTIGRAVITY_UI_BROWSER_PASS` |
| OpenClaw | `ad3118aa-b1f6-4bb8-867e-90b872ebdfde` | `OPENCLAW_UI_BROWSER_PASS` |
| Codex | `019f6444-7e2c-7da0-9a8f-03efe3ab9cf0` | `CODEX_UI_BROWSER_PASS` |
| Gemini | no active session | exact Google authentication blocker shown |

All five working agents reported workspace `/workspace/projects/mission-control`. Page refresh and multiple staging-container recreations preserved sessions and conversation replies.

## Persistent state proof

PostgreSQL counts at acceptance:

- projects: 1
- work items: 1
- Shared Brain sources: 19
- Shared Brain events: 1
- approval decisions: 1
- audit events: 38
- agent sessions: 17
- conversation entries: 10
- attachment records: 2

The real operator work item `Canonicalize Shared Brain continuity sources` passed through capture, human gate, execute, and shipped. Invalid lifecycle jumps are rejected.

The approval acceptance request was rejected with reason `STAGING TEST — rejection persistence proof`. It remained rejected after a fresh API read, was idempotent on replay, existed once in PostgreSQL, appeared under Approvals `All`, reduced no pending count incorrectly, and produced a visible Evidence/Audit event.

## Shared Brain consolidation proof

- 19 continuity-related files were inventoried read-only with absolute path, SHA-256, size, modification time, scope, and classification.
- 5 exact duplicate artifacts were identified by byte hash.
- 5 canonical candidates were identified.
- 0 sources were promoted to canonical without operator authority.
- ViREON, Mission Control, PortMontage, and archive scopes remain separated.
- Obsidian snapshot status: connected; 260 notes, 675 wikilinks, 148 orphans.

## Service and UI truthfulness

- FCC: connected; nine-route coding-first fallback registry, with Laguna M.1 first. OwlAlpha is absent from active routing.
- OpenClaw: connected; agent session ready.
- Antigravity: connected; agent session ready and sandbox-bound.
- Hermes: on-demand agent session ready; absence of a permanent service process is not presented as agent failure.
- Codex: ChatGPT-account authenticated CLI session ready; no OpenAI API key added.
- Paperclip: health/read boundary connected; no API credential or production configuration changed.
- n8n: health connected; execution remains blocked until a safe allowlisted webhook or scoped credential is approved.
- Browser Agents: disconnected and not commandable; no fake browser control is shown.
- Future connector concepts and unwired SELF rooms are hidden from the operator UI.
- Registry contains 8 registered adapters, 0 pending placeholders, and no editable credential fields.

## Verification

Passed:

- `npm run test:agent-conversations` — 3/3
- `npm run test:attachments` — 2/2
- `npm run test:claude-code-session` — 1/1
- `npm run test:operator-work` — 1/1 against PostgreSQL
- `npm run test:approval-postgres` — 1/1 against running staging
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- browser acceptance for Home, Projects, Pipeline, Queue, Brain, Mastermind, Approvals, Evidence, and Registry
- existing live port 3320 health check after every staging recreation

Known non-blocking build diagnostic: Next.js reports an NFT trace warning for the dynamic attachment filesystem store. The build exits successfully; attachment scoping, persistence, and executable rejection tests pass. `turbopack.root` is pinned to the sandbox checkout so the protected parent checkout is no longer selected as the build root.

## Open boundaries

1. Gemini needs one successful Google device-auth completion on the VPS sandbox before its terminal can start.
2. Paperclip project/task mutation requires a separately approved scoped integration; health and external cockpit access already work.
3. n8n command execution requires a separately approved safe webhook/API contract; n8n itself was not mutated.
4. Shared Brain canonical promotion and automatic closeout writing require operator selection of the canonical source contract.
5. Browser Agents require an approved CDP/profile connection.
6. No branch was pushed, merged, or deployed to live. Promotion remains an explicit joint operator action.

## State snapshot

- Phase: isolated functional staging acceptance
- Stable: five real agent terminals, PostgreSQL state, projects/pipeline/queue, approvals/audit, Shared Brain register, Mastermind dispatch
- Issue: Gemini authentication plus three intentionally unapproved external write bridges
- Next: operator reviews staging at `http://127.0.0.1:3330`; only then choose authentication/integration work or promotion
- Constraints: no live deploy, no production credential mutation, no canonical Brain promotion without explicit operator approval
