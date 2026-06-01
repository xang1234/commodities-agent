-- Persist the "why this severity" justification computed by the severity scorer
-- (score + weighted components + explanation + the raw scoring inputs). Nullable:
-- findings written before this migration never captured the inputs, so they stay
-- null and the UI omits the breakdown for them.
-- (Migration 0031 is reserved by the daily-call-briefs branch.)
alter table findings add column severity_breakdown jsonb;
