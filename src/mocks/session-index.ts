import type { SessionIndexEntry } from "@/lib/connectors/types";

// Seed content mirroring AGENT_SESSION_INDEX.md — the single global,
// append-only session registry. New entries are appended via
// vaultEngine.createSessionRegistryEntry, never inserted or overwritten.

export const seedSessionIndex: SessionIndexEntry[] = [
  {
    sessionNumber: "SESSION-0003",
    date: "2026-07-07",
    agent: "Hermes",
    system: "Hermes CLI",
    topic: "Maritime sector verification",
    sessionId: "hm-8823",
    title: "Verification pass on Maritime & Logistics companies",
    summary:
      "Cross-checked 42 company records against registry filings; 39 verified, 3 flagged for manual review.",
    relatedFiles: ["Governance/source-proofs/2026-07-07-hermes-verification.md"],
    obsidianLinks: ["Governance/source-proofs/2026-07-07-hermes-verification.md"],
    status: "closed",
    nextAction: "Manual review of 3 flagged companies by operator",
    handover: null,
  },
  {
    sessionNumber: "SESSION-0002",
    date: "2026-07-07",
    agent: "Claude/FCC",
    system: "Claude CLI bridge",
    topic: "Connector registry refactor",
    sessionId: "fcc-2291",
    title: "Refactor connector registry pattern",
    summary:
      "Completed refactor of the connector registry pattern. Left three follow-up items for OpenClaw on retry logic.",
    relatedFiles: ["Reports/claude-fcc/session-summary-2026-07-07.md"],
    obsidianLinks: ["Reports/claude-fcc/session-summary-2026-07-07.md"],
    status: "handover-pending",
    nextAction: "OpenClaw to implement retry backoff on webhook adapter",
    handover: "Handovers/handover-fcc-to-openclaw-01.md",
  },
  {
    sessionNumber: "SESSION-0001",
    date: "2026-07-05",
    agent: "AGY",
    system: "AGY orchestrator",
    topic: "Initial fleet bring-up",
    sessionId: "agy-0001",
    title: "Bring up orchestrator and register initial agent fleet",
    summary:
      "Registered Claude/FCC, Hermes, OpenClaw, Paperclip, n8n as managed systems under AGY routing.",
    relatedFiles: [],
    obsidianLinks: [],
    status: "closed",
    nextAction: "Monitor routing latency for first week",
    handover: null,
  },
];
