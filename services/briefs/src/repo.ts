import { DECISION_HORIZONS, type PublicSubjectRef } from "../../shared/src/subject-ref.ts";
import type { DailyCallBrief, DailyCallStatus } from "./daily-call.ts";

export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export class BriefsRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefsRepoError";
  }
}

type BriefRow = {
  brief_id: string;
  snapshot_id: string | null;
  status: string;
  commodity_refs: unknown;
  narrative: string;
  driver_ids: unknown;
  watch_items: unknown;
  seed_finding_ids: unknown;
  requires_analyst_signoff: boolean;
  reviewer_user_id: string | null;
  as_of: Date | string;
  approved_at: Date | string | null;
  published_at: Date | string | null;
};

const SELECT_COLUMNS = `
  brief_id::text as brief_id,
  snapshot_id::text as snapshot_id,
  status,
  commodity_refs,
  narrative,
  driver_ids,
  watch_items,
  seed_finding_ids,
  requires_analyst_signoff,
  reviewer_user_id::text as reviewer_user_id,
  as_of,
  approved_at,
  published_at
`;

export async function insertDraft(
  db: QueryExecutor,
  userId: string,
  draft: DailyCallBrief,
): Promise<DailyCallBrief> {
  const result = await db.query<BriefRow>(
    `insert into daily_call_briefs
       (brief_id, user_id, status, commodity_refs, narrative, driver_ids, watch_items,
        seed_finding_ids, requires_analyst_signoff, as_of)
     values ($1::uuid, $2::uuid, 'draft', $3::jsonb, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::timestamptz)
     returning ${SELECT_COLUMNS}`,
    [
      draft.brief_id,
      userId,
      JSON.stringify(draft.commodity_refs),
      draft.narrative,
      JSON.stringify(draft.driver_ids),
      JSON.stringify(draft.watch_items),
      JSON.stringify(draft.seed_finding_ids),
      draft.requires_analyst_signoff,
      draft.as_of,
    ],
  );
  return briefFromRow(requireRow(result.rows, "insert returned no row"));
}

export async function getBrief(
  db: QueryExecutor,
  userId: string,
  briefId: string,
): Promise<DailyCallBrief | null> {
  const result = await db.query<BriefRow>(
    `select ${SELECT_COLUMNS} from daily_call_briefs where brief_id = $1::uuid and user_id = $2::uuid`,
    [briefId, userId],
  );
  const row = result.rows[0];
  return row === undefined ? null : briefFromRow(row);
}

export async function listBriefs(
  db: QueryExecutor,
  userId: string,
): Promise<ReadonlyArray<DailyCallBrief>> {
  const result = await db.query<BriefRow>(
    `select ${SELECT_COLUMNS} from daily_call_briefs where user_id = $1::uuid order by updated_at desc`,
    [userId],
  );
  return Object.freeze(result.rows.map(briefFromRow));
}

// Replaces the editable draft content. Only mutates rows still in draft status,
// so a concurrent approval cannot be silently overwritten.
export async function updateDraftContent(
  db: QueryExecutor,
  userId: string,
  briefId: string,
  content: { narrative: string; driver_ids: ReadonlyArray<string>; watch_items: ReadonlyArray<string> },
): Promise<DailyCallBrief | null> {
  const result = await db.query<BriefRow>(
    `update daily_call_briefs
        set narrative = $3, driver_ids = $4::jsonb, watch_items = $5::jsonb, updated_at = now()
      where brief_id = $1::uuid and user_id = $2::uuid and status = 'draft'
      returning ${SELECT_COLUMNS}`,
    [briefId, userId, content.narrative, JSON.stringify(content.driver_ids), JSON.stringify(content.watch_items)],
  );
  const row = result.rows[0];
  return row === undefined ? null : briefFromRow(row);
}

// Persists a status transition (approve/publish) from the in-memory contract
// result. Content columns are untouched here — they only change via editDraft.
export async function persistBriefState(
  db: QueryExecutor,
  userId: string,
  brief: DailyCallBrief,
): Promise<DailyCallBrief> {
  const result = await db.query<BriefRow>(
    `update daily_call_briefs
        set status = $3,
            reviewer_user_id = $4::uuid,
            approved_at = $5::timestamptz,
            snapshot_id = $6::uuid,
            published_at = $7::timestamptz,
            updated_at = now()
      where brief_id = $1::uuid and user_id = $2::uuid
      returning ${SELECT_COLUMNS}`,
    [
      brief.brief_id,
      userId,
      brief.status,
      brief.reviewer_user_id ?? null,
      brief.approved_at ?? null,
      brief.snapshot_id ?? null,
      brief.published_at ?? null,
    ],
  );
  return briefFromRow(requireRow(result.rows, "update returned no row"));
}

function briefFromRow(row: BriefRow): DailyCallBrief {
  const brief: Mutable<DailyCallBrief> = {
    brief_id: row.brief_id,
    status: assertStatus(row.status),
    as_of: toIso(row.as_of),
    commodity_refs: parseCommodityRefs(row.commodity_refs),
    narrative: row.narrative,
    driver_ids: parseStringArray(row.driver_ids, "driver_ids"),
    watch_items: parseStringArray(row.watch_items, "watch_items"),
    seed_finding_ids: parseStringArray(row.seed_finding_ids, "seed_finding_ids"),
    horizons: Object.freeze([...DECISION_HORIZONS]),
    requires_analyst_signoff: row.requires_analyst_signoff,
  };
  if (row.reviewer_user_id !== null) brief.reviewer_user_id = row.reviewer_user_id;
  if (row.approved_at !== null) brief.approved_at = toIso(row.approved_at);
  if (row.snapshot_id !== null) brief.snapshot_id = row.snapshot_id;
  if (row.published_at !== null) brief.published_at = toIso(row.published_at);
  return Object.freeze(brief);
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function assertStatus(value: string): DailyCallStatus {
  if (value !== "draft" && value !== "approved" && value !== "published") {
    throw new BriefsRepoError(`unexpected daily call status: ${value}`);
  }
  return value;
}

function parseCommodityRefs(value: unknown): ReadonlyArray<PublicSubjectRef & { kind: "commodity" }> {
  if (!Array.isArray(value)) throw new BriefsRepoError("commodity_refs must be an array");
  return Object.freeze(value.map((item) => {
    if (typeof item !== "object" || item === null) throw new BriefsRepoError("commodity_refs item must be an object");
    const ref = item as { kind?: unknown; id?: unknown };
    if (ref.kind !== "commodity" || typeof ref.id !== "string") {
      throw new BriefsRepoError("commodity_refs item must be a commodity ref");
    }
    return Object.freeze({ kind: "commodity" as const, id: ref.id });
  }));
}

function parseStringArray(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new BriefsRepoError(`${label} must be an array`);
  return Object.freeze(value.map((item) => {
    if (typeof item !== "string") throw new BriefsRepoError(`${label} item must be a string`);
    return item;
  }));
}

function toIso(value: Date | string): string {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) throw new BriefsRepoError("timestamp is not a valid date");
  return iso;
}

function requireRow(rows: ReadonlyArray<BriefRow>, message: string): BriefRow {
  const row = rows[0];
  if (row === undefined) throw new BriefsRepoError(message);
  return row;
}
