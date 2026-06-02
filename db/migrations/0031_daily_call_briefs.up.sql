-- Daily-call briefs: the analyst-published morning call that closes the
-- draft -> approved -> published loop. The sealed snapshot is created at publish
-- time, so snapshot_id is null until then; reviewer_user_id is set at approval.
create table daily_call_briefs (
  brief_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  snapshot_id uuid references snapshots(snapshot_id) on delete set null,
  status text not null default 'draft',
  commodity_refs jsonb not null,
  narrative text not null,
  driver_ids jsonb not null,
  watch_items jsonb not null default '[]'::jsonb,
  seed_finding_ids jsonb not null default '[]'::jsonb,
  requires_analyst_signoff boolean not null default true,
  reviewer_user_id uuid references users(user_id),
  as_of timestamptz not null,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_call_briefs_status_check
    check (status in ('draft', 'approved', 'published')),
  constraint daily_call_briefs_published_requires_seal
    check (status <> 'published' or (snapshot_id is not null and published_at is not null)),
  constraint daily_call_briefs_signoff_requires_reviewer
    check (status = 'draft' or reviewer_user_id is not null)
);
create index daily_call_briefs_user_updated_idx on daily_call_briefs(user_id, updated_at desc);
