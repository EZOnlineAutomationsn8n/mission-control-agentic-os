#!/usr/bin/env bash
set -euo pipefail

PROJECT="/workspace/projects/mission-control"
VIREON_WF="/opt/vireon/workfloor"
CLAUDE_BIN="/root/.local/bin/claude"
FCC_ADAPTER="$VIREON_WF/governance/worker_bootstrap_v1/adapters/FCC_EXTERNAL.md"
FCC_EMPTY_MCP="$VIREON_WF/governance/worker_bootstrap_v1/fcc/empty_mcp.json"
FCC_DEFAULT_MODEL="claude-3-freecc-no-thinking/open_router/nvidia/nemotron-3-ultra-550b-a55b:free"
TOOLS="Read,Write,Edit,Glob,Grep,Bash"

[[ -d "$PROJECT" ]] || { echo "ERROR: missing project: $PROJECT" >&2; exit 64; }
[[ -x "$CLAUDE_BIN" ]] || { echo "ERROR: Claude CLI missing: $CLAUDE_BIN" >&2; exit 64; }
[[ -r "$FCC_ADAPTER" ]] || { echo "ERROR: FCC adapter missing: $FCC_ADAPTER" >&2; exit 64; }
[[ -r "$FCC_EMPTY_MCP" ]] || { echo "ERROR: FCC MCP config missing: $FCC_EMPTY_MCP" >&2; exit 64; }

cd "$PROJECT"

export VIREON_WORKER_BOOTSTRAP="$VIREON_WF/governance/worker_bootstrap_v1/WORKER_BOOTSTRAP_V1.md"
export VIREON_WORKER_ADAPTER="$FCC_ADAPTER"
export ANTHROPIC_BASE_URL="${FCC_BASE_URL:-http://127.0.0.1:8082}"
export ANTHROPIC_API_KEY="fcc-local-proxy"
export ANTHROPIC_MODEL="${CLAUDE_MODEL:-$FCC_DEFAULT_MODEL}"
unset ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX

IDENTITY_CONTEXT="You are the Claude Code agent running for Mission Control. FCC is only the model gateway. Use /workspace/projects/mission-control/CLAUDE.md as the runtime working protocol. Do not import OpenClaw or other runtime-specific AGENTS.md rules unless Dennis explicitly names them. Continue safe bounded work A-to-Z, park non-blocking Dennis-only items, and return only at success or a genuine operator boundary."

exec "$CLAUDE_BIN" \
  --setting-sources user,project,local \
  --append-system-prompt-file "$FCC_ADAPTER" \
  --append-system-prompt "$IDENTITY_CONTEXT" \
  --tools "$TOOLS" \
  --allowedTools "$TOOLS" \
  --disable-slash-commands \
  --mcp-config "$FCC_EMPTY_MCP" \
  --strict-mcp-config \
  --permission-mode auto \
  "$@"
