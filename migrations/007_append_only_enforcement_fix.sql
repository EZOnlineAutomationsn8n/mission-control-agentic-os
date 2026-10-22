-- REMEDIATION CORRECTION (not a replacement of history): migration 006
-- introduced reject_append_only_mutation() with a message that referenced
-- OLD.sequence / OLD.id. That reference fails at execution time on tables
-- whose primary key column is neither "sequence" nor "id" (audit_events has
-- no "id" column; approval_decisions has no "id" column), producing a
-- misleading "record has no field" error INSTEAD of the intended
-- append_only_violation message. The mutation was still blocked in every
-- case (the trigger fired and no row was ever changed), but the message
-- was wrong on 2 of 4 protected tables. This migration corrects only the
-- function body. Migration 006 itself is left in place and unmodified as a
-- historical record; this is a new, separate corrective event.

CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is not permitted; record a new event instead (row: %)',
    TG_OP, TG_TABLE_NAME, LEFT(row_to_json(OLD)::text, 200);
END;
$$ LANGUAGE plpgsql;
