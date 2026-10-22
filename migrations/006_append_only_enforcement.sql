-- REMEDIATION (Mission Control remediation pass, Block B): enforce append-only
-- behavior on tables whose intended design is append-only evidence/audit
-- history (blueprint MC_STATE.P4/P5 and P2). This adds ONLY a trigger-level
-- guard; it does NOT change any role, grant, or ownership. A privileged
-- (e.g. superuser) connection can still bypass this by disabling the
-- trigger, but that is a deliberate, separate, auditable DDL action rather
-- than an accidental UPDATE/DELETE through normal application code paths.
-- Corrections must be new rows, never edits to a historical row.

CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is not permitted; record a new event instead (row id/sequence involved: %)',
    TG_OP, TG_TABLE_NAME, COALESCE(OLD.sequence::text, OLD.id::text, 'unknown');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_append_only_audit_events ON audit_events;
CREATE TRIGGER trg_append_only_audit_events
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_append_only_shared_brain_events ON shared_brain_events;
CREATE TRIGGER trg_append_only_shared_brain_events
  BEFORE UPDATE OR DELETE ON shared_brain_events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_append_only_approval_decisions ON approval_decisions;
CREATE TRIGGER trg_append_only_approval_decisions
  BEFORE UPDATE OR DELETE ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_append_only_conversation_entries ON conversation_entries;
CREATE TRIGGER trg_append_only_conversation_entries
  BEFORE UPDATE OR DELETE ON conversation_entries
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
