import { databaseQuery } from "./database";

interface SessionRow<T> {
  payload: T;
}

export async function readPersistedSession<T>(
  sessionKind: string,
  agentId: string,
  sessionKey: string
): Promise<T | null> {
  const result = await databaseQuery<SessionRow<T>>(
    `SELECT payload
       FROM agent_sessions
      WHERE session_kind = $1 AND agent_id = $2 AND session_key = $3`,
    [sessionKind, agentId, sessionKey]
  );
  return result.rows[0]?.payload ?? null;
}

export async function upsertPersistedSession<T extends object>(
  sessionKind: string,
  agentId: string,
  sessionKey: string,
  payload: T
): Promise<T> {
  const result = await databaseQuery<SessionRow<T>>(
    `INSERT INTO agent_sessions (session_kind, agent_id, session_key, payload, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (session_kind, agent_id, session_key)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
     RETURNING payload`,
    [sessionKind, agentId, sessionKey, JSON.stringify(payload)]
  );
  return result.rows[0].payload;
}

/** Create an exact certification fixture once; never upsert over another session. */
export async function insertPersistedFixtureSession<T extends object>(sessionKey: string, payload: T): Promise<T> {
  const result = await databaseQuery<SessionRow<T>>(
    `INSERT INTO agent_sessions (session_kind, agent_id, session_key, payload, updated_at)
     VALUES ('claude-code', 'claude-code', $1, $2::jsonb, NOW())
     ON CONFLICT (session_kind, agent_id, session_key) DO NOTHING
     RETURNING payload`, [sessionKey, JSON.stringify(payload)]);
  if (!result.rows[0]) throw new Error('disposable fixture session key already exists');
  return result.rows[0].payload;
}

export async function patchPersistedSession<T extends object>(
  sessionKind: string,
  agentId: string,
  sessionKey: string,
  update: object
): Promise<T> {
  const patch = { ...update, updatedAt: new Date().toISOString() };
  const result = await databaseQuery<SessionRow<T>>(
    `UPDATE agent_sessions
        SET payload = payload || $4::jsonb,
            updated_at = NOW()
      WHERE session_kind = $1 AND agent_id = $2 AND session_key = $3
      RETURNING payload`,
    [sessionKind, agentId, sessionKey, JSON.stringify(patch)]
  );
  if (!result.rows[0]) throw new Error(`${agentId} session does not exist`);
  return result.rows[0].payload;
}

export async function listPersistedSessions<T>(
  sessionKind: string,
  agentId?: string
): Promise<T[]> {
  const result = await databaseQuery<SessionRow<T>>(
    `SELECT payload
       FROM agent_sessions
      WHERE session_kind = $1
        AND ($2::text IS NULL OR agent_id = $2)
      ORDER BY updated_at DESC`,
    [sessionKind, agentId ?? null]
  );
  return result.rows.map((row) => row.payload);
}
