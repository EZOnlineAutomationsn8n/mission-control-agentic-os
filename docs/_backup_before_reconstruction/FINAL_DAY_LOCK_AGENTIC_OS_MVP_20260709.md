# FINAL DAY LOCK — Agentic OS MVP + Deblock Matrix

Policy: [AGENTIC_OS_BUILD_POLICY.md](../AGENTIC_OS_BUILD_POLICY.md) — `STATUS_ONLY_CONNECTOR_PROFILE_V1`

**Timestamp:** 2026-07-09T00:00:00Z
**Supersedes (status baseline):** [CORE8_STATUS_LOCK_V1.md](CORE8_STATUS_LOCK_V1.md)
**Supersedes (governance baseline):** this session's Evidence/Work Queue governance pass

---

## 1. MVP status

- **Agentic OS v1 connected systems are functional for demo/MVP baseline: YES**
- **Build/runtime status:** `npx tsc --noEmit` clean, `npm run build` clean (all routes compile, no type errors).
- **Verified pages (runtime, HTTP 200 this session):** `/`, `/evidence`, `/queue`, `/approvals`, `/registry`, `/systems/claude-fcc`, `/systems/agy`. All API status routes (`/api/connectors/*/status`) and `/api/audit` (GET/POST) verified via curl round-trip.

## 2. Connected systems current state

| Connector | Mode | Live status | Command execution |
|---|---|---|---|
| FCC / OwlAlpha | LIVE STATUS + controlled action | connected | controlledPrompt only (status-only otherwise) |
| Hermes | LIVE STATUS | degraded (gateway alive, integration SCAFFOLD_ONLY) | disabled |
| OpenClaw | LIVE STATUS | connected | disabled |
| Obsidian Graphlink | LIVE STATUS + graph metadata | connected | disabled (metadata-only) |
| Paperclip | LIVE STATUS | connected | disabled |
| n8n | LIVE STATUS + controlled action | connected (status) / action blocked (401) | trigger attempted, fails auth |
| AGY Orchestrator | LIVE STATUS + controlled action | connected | projectContext refresh only |
| Browser Agents | LIVE STATUS | disconnected (no CDP endpoint running) | disabled |

## 3. Working capabilities

- **FCC controlledPrompt** — explicit-submit, no tools/shell/file access, phase-tracked, audited.
- **Obsidian graph metadata** — note/link/orphan counts, top-linked notes; no note bodies exposed.
- **Paperclip health/state/open link** — live health probe + external link, no content dump.
- **AGY projectContext refresh** — read-only controlled action, audited.
- **Evidence persisted audit** — in-memory session log + append-only `data/audit-log.jsonl`, survives reload.
- **Work Queue derived from real pending/action logs** — no seeded fake rows; lanes are a read-through projection of live approvals/audit events.
- **Registry health/capability/last-action separation** — connector health, capability mode, and last action are three distinct, non-conflated columns.

## 4. Blocker → Deblock Matrix

### FCC / OwlAlpha
- **Blocker:** `upstream_provider_failed` can occur from the OpenRouter/OwlAlpha free lane.
- **Why blocked:** no guaranteed-stable free-tier model/key; free lane rate-limits or 5xxs unpredictably.
- **Needed:** stable OpenRouter model + key + fallback route; a completion smoke test; a retry/fallback policy.
- **Next step:** define a 2–3 model fallback chain in the FCC action route, add a scripted smoke test hit before demo.
- **Risk:** low (read-only completion action, already sandboxed).
- **Order:** 2

### Hermes
- **Blocker:** scaffold-only — no platform bridge, no command route wired.
- **Why blocked:** integration contract was declared `SCAFFOLD_ONLY` in Core-4; never implemented.
- **Needed:** choose a platform bridge, provide a credential bridge safely, wire a command route behind an approval/audit gate, run a smoke test.
- **Next step:** pick target bridge (Telegram vs. gateway API), design the approval-gated command route contract before touching Hermes itself.
- **Risk:** medium (first real command-execution surface in the fleet).
- **Order:** 4

### OpenClaw
- **Blocker:** no safe `controlledPrompt` endpoint exposed; old main-session/heartbeat carries reactivation risk.
- **Why blocked:** only status detection exists; no isolated action path was built.
- **Needed:** a clean safe endpoint or an isolated fresh-session API, no old session wake-up, heartbeat stays disabled, approval/audit wrapper.
- **Next step:** confirm OpenClaw's API can spawn an isolated session (not the old `main`), then add one read-only controlled action following the FCC/AGY pattern.
- **Risk:** medium-high (heartbeat/old-session reactivation is an explicit hazard).
- **Order:** 5

### Obsidian Graphlink
- **Blocker:** graph metadata only; no content read or write-back control yet.
- **Why blocked:** deliberate scope limit from Core-4/Core-8 (no note bodies exposed).
- **Needed:** explicit read policy, allowed note scopes, an append-only write-back target, backlink/graph traversal rules, audit on writes.
- **Next step:** define the allowed write-back folder(s) and an approval-gated append action, mirroring the `Governance/approvals-log.md` pattern already in use.
- **Risk:** medium (vault content exposure if scope isn't tight).
- **Order:** 6

### Paperclip
- **Blocker:** health/open-link only; no safe project/document API wired.
- **Why blocked:** no authenticated, scoped API surface has been selected yet.
- **Needed:** authenticated safe API surface or a read-only project-context endpoint, a permission boundary, no DB/content dump.
- **Next step:** identify one read-only Paperclip endpoint (e.g. lead-count summary) that returns no document content, wire it as a controlled action.
- **Risk:** medium (DB-backed system; content leakage risk if scope creeps).
- **Order:** 7 (not in top list — after Browser Agents/audit hardening; lower demo priority)

### n8n
- **Blocker:** REST API returns 401; no safe webhook discovered yet.
- **Why blocked:** no valid API credential wired, and no vetted demo workflow webhook identified.
- **Needed:** n8n API credential bridge or a known-safe demo workflow webhook, an allowlisted webhook path, a trigger schema, an audit log entry per trigger.
- **Next step:** either obtain a scoped n8n API key or pick one existing workflow with a webhook trigger, allowlist its path explicitly, and re-test the existing `/api/connectors/n8n/actions/trigger` route against it.
- **Risk:** medium (workflow triggers are real side effects, not read-only).
- **Order:** 3

### AGY Orchestrator
- **Blocker:** `projectContext` read-only works, but no job-dispatch/orchestration endpoint.
- **Why blocked:** only the read-only status/context action was built; dispatch was explicitly out of scope for status-only passes.
- **Needed:** a safe job-dispatch endpoint, a job schema, allowlisted actions, a queue/audit/approval gate.
- **Next step:** define the smallest allowlisted job type (e.g. "re-check one connector's health") and gate it through the existing ApprovalRequest flow before wiring dispatch.
- **Risk:** high (first real orchestration/dispatch surface — direct fleet-control blast radius).
- **Order:** 8 (deferred past this list — orchestration dispatch needs its own explicit-override pass)

### Browser Agents
- **Blocker:** no CDP endpoint running.
- **Why blocked:** no browser automation process has been started on this host; connector honestly reports `disconnected`.
- **Needed:** a controlled browser runtime, a localhost-only CDP endpoint, an isolated browser profile, a safe action policy, no exposed public port.
- **Next step:** start a headless Chromium with `--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1` under an isolated profile dir, re-verify `/api/connectors/browser-agents/status` picks it up.
- **Risk:** medium (browser automation is a broad real-world action surface once wired beyond status).
- **Order:** 7

### Governance / Audit
- **Blocker:** audit persistence exists, but production governance still needs a retention/rotation/export policy.
- **Why blocked:** `data/audit-log.jsonl` is unbounded, unrotated, and has no export/download path — fine for MVP demo, not for production.
- **Needed:** audit retention rules, export/download, a tamper-evidence strategy later.
- **Next step:** add a size/age-based rotation check and a "download audit log" action in Evidence, before any tamper-evidence work.
- **Risk:** low (no functional blocker for demo; compliance/scale concern only).
- **Order:** 8

## 5. Recommended next order

1. Sales/demo polish
2. Stable FCC model/fallback
3. n8n safe webhook/credential wiring
4. Hermes platform bridge
5. OpenClaw safe endpoint
6. Obsidian write-back hardening
7. Browser Agents runtime
8. Production audit hardening

## 6. Next-session start line

```
Continue Agentic OS MVP from FINAL_DAY_LOCK_AGENTIC_OS_MVP_20260709.md. Connected systems are MVP-functional; next task is to pick one blocker from the Deblock Matrix and implement it fully, not reopen old micro-steps.
```
