import { randomUUID } from "node:crypto";

import type { PublicSubjectRef } from "../../shared/src/subject-ref.ts";
import {
  approveDailyCall,
  buildDailyCallDraft,
  publishDailyCall,
  type DailyCallBrief,
  type DailyCallStatus,
} from "./daily-call.ts";
import {
  getBrief,
  insertDraft,
  persistBriefState,
  updateDraftContent,
  type QueryExecutor,
} from "./repo.ts";
import { seedDraftFromFindings } from "./seeding.ts";
import type { SealDailyCallInput } from "./seal.ts";

export class BriefValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefValidationError";
  }
}

export class BriefNotFoundError extends Error {
  constructor(message = "daily call brief not found") {
    super(message);
    this.name = "BriefNotFoundError";
  }
}

export class BriefStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefStateError";
  }
}

export type BriefsDeps = {
  // Seals the provenance snapshot at publish time and returns its snapshot_id.
  sealDailyCall: (input: SealDailyCallInput) => Promise<string>;
  // Fired after a successful publish — the seam for notification fan-out.
  onPublished?: (brief: DailyCallBrief) => void | Promise<void>;
};

export type CreateDailyCallInput = {
  user_id: string;
  commodity_refs: ReadonlyArray<PublicSubjectRef & { kind: "commodity" }>;
};

export type EditDailyCallInput = {
  user_id: string;
  brief_id: string;
  narrative?: string;
  driver_ids?: ReadonlyArray<string>;
  watch_items?: ReadonlyArray<string>;
};

export async function createDailyCall(
  db: QueryExecutor,
  input: CreateDailyCallInput,
): Promise<DailyCallBrief> {
  const as_of = new Date().toISOString();
  const seed = await seedDraftFromFindings(db, {
    user_id: input.user_id,
    commodity_refs: input.commodity_refs,
  });
  const draft = asValidation(() =>
    buildDailyCallDraft({
      brief_id: randomUUID(),
      as_of,
      commodity_refs: input.commodity_refs,
      narrative: seed.narrative,
      driver_ids: seed.driver_ids,
      watch_items: [],
      seed_finding_ids: seed.seed_finding_ids,
    }),
  );
  return insertDraft(db, input.user_id, draft);
}

export async function getDailyCall(
  db: QueryExecutor,
  userId: string,
  briefId: string,
): Promise<DailyCallBrief> {
  const brief = await getBrief(db, userId, briefId);
  if (brief === null) throw new BriefNotFoundError();
  return brief;
}

export async function editDailyCall(
  db: QueryExecutor,
  input: EditDailyCallInput,
): Promise<DailyCallBrief> {
  return transitionBrief(db, input.user_id, input.brief_id, "draft", async (current) => {
    const next = asValidation(() =>
      buildDailyCallDraft({
        brief_id: current.brief_id,
        as_of: current.as_of,
        commodity_refs: current.commodity_refs,
        narrative: input.narrative ?? current.narrative,
        driver_ids: input.driver_ids ?? current.driver_ids,
        watch_items: input.watch_items ?? current.watch_items,
        seed_finding_ids: current.seed_finding_ids,
      }),
    );
    return updateDraftContent(db, input.user_id, input.brief_id, {
      narrative: next.narrative,
      driver_ids: next.driver_ids,
      watch_items: next.watch_items,
    });
  });
}

export async function approveDailyCallBrief(
  db: QueryExecutor,
  input: { user_id: string; brief_id: string },
): Promise<DailyCallBrief> {
  return transitionBrief(db, input.user_id, input.brief_id, "draft", (current) =>
    persistBriefState(
      db,
      input.user_id,
      "draft",
      approveDailyCall(current, { reviewer_user_id: input.user_id, approved_at: new Date().toISOString() }),
    ),
  );
}

export async function publishDailyCallBrief(
  db: QueryExecutor,
  deps: BriefsDeps,
  input: { user_id: string; brief_id: string },
): Promise<DailyCallBrief> {
  return transitionBrief(db, input.user_id, input.brief_id, "approved", async (current) => {
    // The seal runs in its own transaction and the brief update is a second
    // statement, so a failure between them only orphans a harmless snapshot
    // (snapshot_id is `on delete set null`). We accept that over enrolling the
    // seal in the brief-update transaction; a retried publish just seals again.
    const snapshotId = await deps.sealDailyCall({
      commodity_refs: current.commodity_refs,
      as_of: current.as_of,
    });
    const published = publishDailyCall(current, {
      snapshot_id: snapshotId,
      published_at: new Date().toISOString(),
    });
    const saved = await persistBriefState(db, input.user_id, "approved", published);
    // A concurrent publish already advanced the row: skip the fan-out and let
    // transitionBrief surface the state conflict. (The snapshot we sealed above
    // is orphaned — harmless; snapshot_id is `on delete set null`.)
    if (saved === null) return null;
    await deps.onPublished?.(saved);
    return saved;
  });
}

// Loads an owned brief, asserts it is in the expected status, and applies the
// transition. Every status-changing operation shares this load->guard->apply
// shape, so it lives in exactly one place. `apply` returns null when its
// status-guarded write matched no row (a concurrent request already advanced
// the brief) — the load-time check is a fast path; this null is the
// authoritative race guard, mapped to a state conflict.
async function transitionBrief(
  db: QueryExecutor,
  userId: string,
  briefId: string,
  expected: DailyCallStatus,
  apply: (current: DailyCallBrief) => Promise<DailyCallBrief | null>,
): Promise<DailyCallBrief> {
  const current = await getDailyCall(db, userId, briefId);
  if (current.status !== expected) {
    throw new BriefStateError(`daily call must be ${expected} for this action (status is ${current.status})`);
  }
  const result = await apply(current);
  if (result === null) {
    throw new BriefStateError(`daily call changed concurrently; expected status ${expected}`);
  }
  return result;
}

function asValidation<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new BriefValidationError(error instanceof Error ? error.message : String(error));
  }
}
