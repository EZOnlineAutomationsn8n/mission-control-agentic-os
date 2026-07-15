import { randomUUID } from "node:crypto";
import { databaseEnabled, databaseQuery, withDatabaseTransaction } from "@/lib/persistence/database";

export type ProjectStatus = "active" | "paused" | "archived";
export type WorkStage = "capture" | "human-gate" | "execute" | "shipped";

export interface OperatorProject {
  id: string;
  name: string;
  summary: string;
  workspacePath: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorWorkItem {
  id: string;
  projectId: string | null;
  title: string;
  description: string;
  stage: WorkStage;
  assignedAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  summary: string;
  workspace_path: string | null;
  status: ProjectStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkItemRow {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  stage: WorkStage;
  assigned_agent_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function requireDatabase() {
  if (!databaseEnabled()) throw new Error("Operator work persistence requires DATABASE_URL");
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function projectFromRow(row: ProjectRow): OperatorProject {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    workspacePath: row.workspace_path,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function workItemFromRow(row: WorkItemRow): OperatorWorkItem {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    stage: row.stage,
    assignedAgentId: row.assigned_agent_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listOperatorProjects(): Promise<OperatorProject[]> {
  requireDatabase();
  const result = await databaseQuery<ProjectRow>(
    "SELECT * FROM operator_projects ORDER BY updated_at DESC, name ASC"
  );
  return result.rows.map(projectFromRow);
}

export async function createOperatorProject(input: {
  name: string;
  summary?: string;
  workspacePath?: string | null;
}): Promise<OperatorProject> {
  requireDatabase();
  const id = `project-${randomUUID()}`;
  const result = await databaseQuery<ProjectRow>(
    `INSERT INTO operator_projects (id, name, summary, workspace_path)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, input.name, input.summary ?? "", input.workspacePath || null]
  );
  return projectFromRow(result.rows[0]);
}

export async function listOperatorWorkItems(): Promise<OperatorWorkItem[]> {
  requireDatabase();
  const result = await databaseQuery<WorkItemRow>(
    "SELECT * FROM operator_work_items ORDER BY updated_at DESC"
  );
  return result.rows.map(workItemFromRow);
}

export async function createOperatorWorkItem(input: {
  projectId?: string | null;
  title: string;
  description?: string;
  assignedAgentId?: string | null;
}): Promise<OperatorWorkItem> {
  requireDatabase();
  const id = `work-${randomUUID()}`;
  return withDatabaseTransaction(async (client) => {
    const result = await client.query<WorkItemRow>(
      `INSERT INTO operator_work_items
         (id, project_id, title, description, assigned_agent_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, input.projectId || null, input.title, input.description ?? "", input.assignedAgentId || null]
    );
    await client.query(
      `INSERT INTO operator_work_events (work_item_id, event_type, detail)
       VALUES ($1, 'created', 'Captured by operator')`,
      [id]
    );
    return workItemFromRow(result.rows[0]);
  });
}

const STAGE_ORDER: WorkStage[] = ["capture", "human-gate", "execute", "shipped"];

export async function transitionOperatorWorkItem(id: string, stage: WorkStage): Promise<OperatorWorkItem> {
  requireDatabase();
  return withDatabaseTransaction(async (client) => {
    const currentResult = await client.query<WorkItemRow>(
      "SELECT * FROM operator_work_items WHERE id = $1 FOR UPDATE",
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) throw new Error("Work item not found");
    const distance = Math.abs(STAGE_ORDER.indexOf(stage) - STAGE_ORDER.indexOf(current.stage));
    if (distance !== 1) throw new Error("Work items may move only one lifecycle stage at a time");

    const result = await client.query<WorkItemRow>(
      `UPDATE operator_work_items SET stage = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, stage]
    );
    const detail = stage === "execute"
      ? "Operator released item through the human gate"
      : `Operator moved item from ${current.stage} to ${stage}`;
    await client.query(
      `INSERT INTO operator_work_events (work_item_id, event_type, detail)
       VALUES ($1, 'stage-transition', $2)`,
      [id, detail]
    );
    return workItemFromRow(result.rows[0]);
  });
}
