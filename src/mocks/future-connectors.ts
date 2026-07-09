import type { FutureConnectorDescriptor } from "@/lib/connectors/types";

// ─────────────────────────────────────────────────────────────────────────
// FUTURE / PENDING CONNECTOR CATALOG
// These are registry-visible setup placeholders, NOT AgentSystemAdapter
// implementations. No mock transport, no control room, no start/stop/
// approve behavior — the System Registry and Sidebar list them so the
// Agentic OS visibly proves it scales to a large connector catalog without
// any UI redesign. To promote one to active: write an adapter file
// implementing AgentSystemAdapter (see any file in mock/ as a template),
// register it in registry.ts, optionally add seed mock data, then delete
// its entry here.
// ─────────────────────────────────────────────────────────────────────────

export const futureConnectors: FutureConnectorDescriptor[] = [
  // AI Agents
  {
    id: "future-gpt4-bridge",
    name: "GPT-4 Bridge",
    category: "AI Agents",
    type: "agent",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["general reasoning agent", "tool use"],
    notes: "OpenAI API bridge for cross-model comparison tasks.",
  },
  {
    id: "future-local-llm",
    name: "Local LLM (Ollama)",
    category: "AI Agents",
    type: "agent",
    status: "pending-setup",
    plannedConnectionModes: ["cli", "api"],
    capabilities: ["offline inference", "air-gapped tasks"],
    notes: "Local model runner for offline/air-gapped operator tasks.",
  },

  // Orchestrators
  {
    id: "future-temporal",
    name: "Temporal",
    category: "Orchestrators",
    type: "orchestrator",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["durable workflow execution", "retry orchestration"],
    notes: "Durable execution engine for long-running multi-agent workflows.",
  },
  {
    id: "future-airflow",
    name: "Apache Airflow",
    category: "Orchestrators",
    type: "orchestrator",
    status: "pending-setup",
    plannedConnectionModes: ["api", "cli"],
    capabilities: ["DAG scheduling", "batch pipeline orchestration"],
    notes: "Scheduled DAG runner for batch data pipelines feeding the Brain.",
  },

  // Automation
  {
    id: "future-zapier",
    name: "Zapier",
    category: "Automation",
    type: "automation",
    status: "pending-setup",
    plannedConnectionModes: ["webhook", "api"],
    capabilities: ["no-code automation", "third-party app glue"],
    notes: "No-code automation bridge for lightweight integrations.",
  },
  {
    id: "future-make",
    name: "Make (Integromat)",
    category: "Automation",
    type: "automation",
    status: "pending-setup",
    plannedConnectionModes: ["webhook", "api"],
    capabilities: ["visual automation scenarios"],
    notes: "Alternative no-code automation runner.",
  },

  // Browser Agents
  {
    id: "future-playwright-fleet",
    name: "Playwright Fleet",
    category: "Browser Agents",
    type: "browser-agent",
    status: "pending-setup",
    plannedConnectionModes: ["browser"],
    capabilities: ["headless browser automation", "parallel scraping"],
    notes: "Scaled headless browser fleet for parallel scraping/verification tasks.",
  },
  {
    id: "future-selenium-grid",
    name: "Selenium Grid",
    category: "Browser Agents",
    type: "browser-agent",
    status: "pending-setup",
    plannedConnectionModes: ["browser"],
    capabilities: ["cross-browser automation"],
    notes: "Cross-browser testing/automation grid.",
  },

  // Knowledge / Memory
  {
    id: "future-notion-sync",
    name: "Notion Sync",
    category: "Knowledge / Memory",
    type: "memory",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["secondary knowledge base mirror"],
    notes: "Mirrors select Brain notes into Notion for stakeholders without vault access.",
  },
  {
    id: "future-confluence-sync",
    name: "Confluence Sync",
    category: "Knowledge / Memory",
    type: "memory",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["enterprise wiki mirror"],
    notes: "Enterprise documentation mirror for governance records.",
  },

  // Project Management
  {
    id: "future-linear",
    name: "Linear",
    category: "Project Management",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api", "webhook"],
    capabilities: ["issue tracking", "work item sync"],
    notes: "Syncs Work Queue items with Linear issues for engineering handoff.",
  },
  {
    id: "future-asana",
    name: "Asana",
    category: "Project Management",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["task tracking", "project timelines"],
    notes: "Operator-facing project tracking for PortMontage milestones.",
  },

  // Communication
  {
    id: "future-slack",
    name: "Slack",
    category: "Communication",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["webhook", "api"],
    capabilities: ["approval notifications", "operator alerts"],
    notes: "Pushes approval requests and blockers to an operator channel.",
  },
  {
    id: "future-ms-teams",
    name: "Microsoft Teams",
    category: "Communication",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["webhook", "api"],
    capabilities: ["operator alerts"],
    notes: "Alternative notification channel for enterprise deployments.",
  },

  // Code / Dev Tools
  {
    id: "future-github",
    name: "GitHub",
    category: "Code / Dev Tools",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api", "webhook"],
    capabilities: ["PR review", "issue sync", "CI status"],
    notes: "Repo integration for Claude/FCC handovers and code review flags.",
  },
  {
    id: "future-gitlab-ci",
    name: "GitLab CI",
    category: "Code / Dev Tools",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api", "webhook"],
    capabilities: ["pipeline status", "deployment triggers"],
    notes: "CI/CD pipeline visibility for OpenClaw infra changes.",
  },

  // Databases
  {
    id: "future-postgres",
    name: "Postgres Direct",
    category: "Databases",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["direct SQL access", "read replicas"],
    notes: "Direct database adapter, replacing Paperclip's proxied DB sync where needed.",
  },
  {
    id: "future-mongodb",
    name: "MongoDB",
    category: "Databases",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["document store access"],
    notes: "Document store for unstructured lead/contact records.",
  },

  // File Systems
  {
    id: "future-s3-sync",
    name: "S3 Bucket Sync",
    category: "File Systems",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["filesystem", "api"],
    capabilities: ["object storage sync", "report archival"],
    notes: "Archives Brain reports and evidence to cold object storage.",
  },
  {
    id: "future-nas-mount",
    name: "Local NAS Mount",
    category: "File Systems",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["filesystem"],
    capabilities: ["on-prem file access"],
    notes: "On-prem network storage mount for large source documents.",
  },

  // APIs / Webhooks
  {
    id: "future-rest-gateway",
    name: "Generic REST Gateway",
    category: "APIs / Webhooks",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api", "webhook"],
    capabilities: ["arbitrary REST integration", "inbound webhook intake"],
    notes: "Catch-all adapter shape for one-off REST integrations.",
  },
  {
    id: "future-stripe-webhooks",
    name: "Stripe Webhooks",
    category: "APIs / Webhooks",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["webhook"],
    capabilities: ["billing event intake"],
    notes: "Billing/subscription event intake, if PortMontage adds paid tiers.",
  },

  // Governance / Proof
  {
    id: "future-compliance-ledger",
    name: "Compliance Ledger",
    category: "Governance / Proof",
    type: "governance",
    status: "pending-setup",
    plannedConnectionModes: ["api", "filesystem"],
    capabilities: ["immutable decision log", "regulatory export"],
    notes: "Append-only external ledger mirroring the Brain's governance log for audits.",
  },
  {
    id: "future-audit-exporter",
    name: "Audit Trail Exporter",
    category: "Governance / Proof",
    type: "governance",
    status: "pending-setup",
    plannedConnectionModes: ["filesystem", "api"],
    capabilities: ["audit export", "compliance reporting"],
    notes: "Periodic export of approval audit trails for external compliance review.",
  },

  // Monitoring / Logs
  {
    id: "future-datadog",
    name: "Datadog",
    category: "Monitoring / Logs",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["infra metrics", "alerting"],
    notes: "Fleet health metrics beyond the mock TopBar aggregate.",
  },
  {
    id: "future-grafana-prometheus",
    name: "Grafana / Prometheus",
    category: "Monitoring / Logs",
    type: "integration",
    status: "pending-setup",
    plannedConnectionModes: ["api"],
    capabilities: ["metrics dashboards", "time-series alerting"],
    notes: "Self-hosted metrics stack alternative to Datadog.",
  },
];
