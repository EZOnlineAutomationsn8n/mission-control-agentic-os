# Codex VPS remote connection

Date: 2026-07-15
Status: READY_FOR_APP_SELECTION

## Connection

- Windows SSH alias: `agentic-vps`
- Remote host: VPS `72.61.91.176`
- Remote user: `agentlab` (uid/gid 26001)
- Authentication: existing Windows Ed25519 public key
- Workspace: `/opt/shared/agentic-sandbox/workspace/projects/mission-control`
- Codex CLI: `0.144.3`
- Codex authentication: ChatGPT subscription login
- Codex app-server: smoke test PASS on VPS loopback

The `agentlab` account owns the engineering sandbox and is not a member of privileged groups. Production deployment remains a separate operator-controlled action.

## Verified commands

```bash
ssh agentic-vps
codex --version
codex login status
cd /opt/shared/agentic-sandbox/workspace/projects/mission-control
```

Batch-mode SSH, workspace write access, a clean Git worktree, and `codex app-server` startup were verified from Windows.

## One remaining desktop action

In the Codex desktop app:

1. Open **Settings > Connections**.
2. Add or enable SSH host **agentic-vps**.
3. Select project folder `/opt/shared/agentic-sandbox/workspace/projects/mission-control`.

The desktop app will then start the remote Codex app-server through SSH. Do not expose app-server ports publicly.
