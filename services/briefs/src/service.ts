import { randomUUID } from "node:crypto";

import type { PublicSubjectRef } from "../../shared/src/subject-ref.ts";
import {
  approveDailyCall,
  buildDailyCallDraft,
  publishDailyCall,
  type DailyCallBrief,
} from "./daily-call.ts";
import {
  getBrief,
  insertDraft,
  listBriefs,
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
  now?: () => string;
  newId?: () => string;
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
  deps: BriefsDeps,
  input: CreateDailyCallInput,
): Promise<DailyCallBrief> {
  const as_of = nowOf(deps);
  const seed = await seedDraftFromFindings(db, {
    user_id: input.user_id,
    commodity_refs: input.commodity_refs,
  });
  const draft = asValidation(() =>
    buildDailyCallDraft({
      brief_id: idOf(deps),
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

export async function listDailyCalls(
  db: QueryExecutor,
  userId: string,
): Promise<ReadonlyArray<DailyCallBrief>> {
  return listBriefs(db, userId);
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
  const current = await getBrief(db, input.user_id, input.brief_id);
  if (current === null) throw new BriefNotFoundError();
  if (current.status !== "draft") {
    throw new BriefStateError(`only a draft daily call can be edited (status is ${current.status})`);
  }

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

  const persisted = await updateDraftContent(db, input.user_id, input.brief_id, {
    narrative: next.narrative,
    driver_ids: next.driver_ids,
    watch_items: next.watch_items,
  });
  if (persisted === null) {
    throw new BriefStateError("daily call is no longer a draft");
  }
  return persisted;
}

export async function approveDailyCallBrief(
  db: QueryExecutor,
  deps: BriefsDeps,
  input: { user_id: string; brief_id: string },
): Promise<DailyCallBrief> {
  const current = await getBrief(db, input.user_id, input.brief_id);
  if (current === null) throw new BriefNotFoundError();
  if (current.status !== "draft") {
    throw new BriefStateError(`only a draft daily call can be approved (status is ${current.status})`);
  }
  const approved = approveDailyCall(current, {
    reviewer_user_id: input.user_id,
    approved_at: nowOf(deps),
  });
  return persistBriefState(db, input.user_id, approved);
}

export async function publishDailyCallBrief(
  db: QueryExecutor,
  deps: BriefsDeps,
  input: { user_id: string; brief_id: string },
): Promise<DailyCallBrief> {
  const current = await getBrief(db, input.user_id, input.brief_id);
  if (current === null) throw new BriefNotFoundError();
  if (current.status !== "approved") {
    throw new BriefStateError(`only an approved daily call can be published (status is ${current.status})`);
  }
  const snapshotId = await deps.sealDailyCall({
    commodity_refs: current.commodity_refs,
    as_of: current.as_of,
  });
  const published = publishDailyCall(current, {
    snapshot_id: snapshotId,
    published_at: nowOf(deps),
  });
  const saved = await persistBriefState(db, input.user_id, published);
  await deps.onPublished?.(saved);
  return saved;
}

function nowOf(deps: BriefsDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

function idOf(deps: BriefsDeps): string {
  return deps.newId ? deps.newId() : randomUUID();
}

function asValidation<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new BriefValidationError(error instanceof Error ? error.message : String(error));
  }
}
