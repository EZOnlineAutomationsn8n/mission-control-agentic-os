import assert from "node:assert/strict";
import test from "node:test";
import { databaseQuery } from "../src/lib/persistence/database";
import {
  createOperatorProject,
  createOperatorWorkItem,
  listOperatorProjects,
  listOperatorWorkItems,
  transitionOperatorWorkItem,
} from "../src/lib/operator-work";

test("operator projects and work items persist through the governed lifecycle", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for this integration test");
  let projectId: string | null = null;
  let itemId: string | null = null;
  try {
    const project = await createOperatorProject({
      name: `Operator lifecycle proof ${Date.now()}`,
      summary: "Temporary integration proof",
      workspacePath: "/workspace/projects/mission-control",
    });
    projectId = project.id;
    assert.ok((await listOperatorProjects()).some((candidate) => candidate.id === project.id));

    const item = await createOperatorWorkItem({ projectId, title: "Lifecycle proof item" });
    itemId = item.id;
    assert.equal(item.stage, "capture");
    assert.equal((await transitionOperatorWorkItem(item.id, "human-gate")).stage, "human-gate");
    assert.equal((await transitionOperatorWorkItem(item.id, "execute")).stage, "execute");
    await assert.rejects(() => transitionOperatorWorkItem(item.id, "capture"), /one lifecycle stage/);
    assert.equal((await transitionOperatorWorkItem(item.id, "shipped")).stage, "shipped");
    assert.ok((await listOperatorWorkItems()).some((candidate) => candidate.id === item.id && candidate.stage === "shipped"));
  } finally {
    if (itemId) await databaseQuery("DELETE FROM operator_work_items WHERE id = $1", [itemId]);
    if (projectId) await databaseQuery("DELETE FROM operator_projects WHERE id = $1", [projectId]);
  }
});
