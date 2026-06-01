import assert from "node:assert/strict";
import test from "node:test";

import {
  DAILY_CALL_STATUSES,
  approveDailyCall,
  buildDailyCallDraft,
  publishDailyCall,
} from "../src/daily-call.ts";

const SNAPSHOT_ID = "11111111-1111-4111-9111-111111111111";
const BRIEF_ID = "55555555-5555-4555-9555-555555555555";
const COPPER_ID = "22222222-2222-4222-9222-222222222222";
const IRON_ORE_ID = "33333333-3333-4333-9333-333333333333";
const REVIEWER_ID = "44444444-4444-4444-9444-444444444444";

function draft() {
  return buildDailyCallDraft({
    brief_id: BRIEF_ID,
    as_of: "2026-05-31T00:00:00.000Z",
    commodity_refs: [
      { kind: "commodity", id: COPPER_ID },
      { kind: "commodity", id: IRON_ORE_ID },
    ],
    narrative: "Copper and iron ore calls are mixed into the Asia open.",
    driver_ids: ["driver-1", "driver-2"],
    watch_items: ["China PMI", "LME inventory draw"],
    seed_finding_ids: ["finding-1"],
  });
}

test("DAILY_CALL_STATUSES is draft -> approved -> published", () => {
  assert.deepEqual(DAILY_CALL_STATUSES, ["draft", "approved", "published"]);
});

test("buildDailyCallDraft creates an analyst-signoff draft with no snapshot yet", () => {
  const brief = draft();

  assert.equal(brief.status, "draft");
  assert.equal(brief.requires_analyst_signoff, true);
  assert.equal(brief.snapshot_id, undefined);
  assert.equal(brief.reviewer_user_id, undefined);
  assert.deepEqual(brief.horizons, ["1d", "1w", "1m", "3m"]);
  assert.deepEqual(brief.seed_finding_ids, ["finding-1"]);
  assert.equal(Object.isFrozen(brief.driver_ids), true);
});

test("buildDailyCallDraft defaults seed_finding_ids to an empty frozen array", () => {
  const brief = buildDailyCallDraft({
    brief_id: BRIEF_ID,
    as_of: "2026-05-31T00:00:00.000Z",
    commodity_refs: [{ kind: "commodity", id: COPPER_ID }],
    narrative: "Copper tone is constructive.",
    driver_ids: ["driver-1"],
    watch_items: [],
  });

  assert.deepEqual(brief.seed_finding_ids, []);
  assert.equal(Object.isFrozen(brief.seed_finding_ids), true);
});

test("approveDailyCall stamps reviewer + approved_at without mutating the draft", () => {
  const original = draft();

  const approved = approveDailyCall(original, {
    reviewer_user_id: REVIEWER_ID,
    approved_at: "2026-05-31T00:30:00.000Z",
  });

  assert.equal(original.status, "draft");
  assert.equal(approved.status, "approved");
  assert.equal(approved.reviewer_user_id, REVIEWER_ID);
  assert.equal(approved.approved_at, "2026-05-31T00:30:00.000Z");
  assert.equal(approved.snapshot_id, undefined);
});

test("approveDailyCall rejects a non-draft brief", () => {
  const approved = approveDailyCall(draft(), {
    reviewer_user_id: REVIEWER_ID,
    approved_at: "2026-05-31T00:30:00.000Z",
  });

  assert.throws(
    () => approveDailyCall(approved, { reviewer_user_id: REVIEWER_ID, approved_at: "2026-05-31T00:31:00.000Z" }),
    /daily_call must be in draft status before approval/,
  );
});

test("approveDailyCall rejects a non-UUID reviewer", () => {
  assert.throws(
    () => approveDailyCall(draft(), { reviewer_user_id: "reviewer-1", approved_at: "2026-05-31T00:30:00.000Z" }),
    /daily_call\.reviewer_user_id must be a UUID v4/,
  );
});

test("publishDailyCall seals the snapshot and stamps published_at from an approved brief", () => {
  const approved = approveDailyCall(draft(), {
    reviewer_user_id: REVIEWER_ID,
    approved_at: "2026-05-31T00:30:00.000Z",
  });

  const published = publishDailyCall(approved, {
    snapshot_id: SNAPSHOT_ID,
    published_at: "2026-05-31T01:00:00.000Z",
  });

  assert.equal(approved.status, "approved");
  assert.equal(published.status, "published");
  assert.equal(published.snapshot_id, SNAPSHOT_ID);
  assert.equal(published.reviewer_user_id, REVIEWER_ID);
  assert.equal(published.published_at, "2026-05-31T01:00:00.000Z");
});

test("publishDailyCall rejects a brief that has not been approved", () => {
  assert.throws(
    () => publishDailyCall(draft(), { snapshot_id: SNAPSHOT_ID, published_at: "2026-05-31T01:00:00.000Z" }),
    /daily_call must be approved before publishing/,
  );
});

test("publishDailyCall rejects a non-UUID snapshot id", () => {
  const approved = approveDailyCall(draft(), {
    reviewer_user_id: REVIEWER_ID,
    approved_at: "2026-05-31T00:30:00.000Z",
  });

  assert.throws(
    () => publishDailyCall(approved, { snapshot_id: "snap-1", published_at: "2026-05-31T01:00:00.000Z" }),
    /daily_call\.snapshot_id must be a UUID v4/,
  );
});

test("buildDailyCallDraft rejects a non-UUID brief id", () => {
  assert.throws(
    () => buildDailyCallDraft({
      brief_id: "brief-1",
      as_of: "2026-05-31T00:00:00.000Z",
      commodity_refs: [{ kind: "commodity", id: COPPER_ID }],
      narrative: "Copper tone is constructive.",
      driver_ids: ["driver-1"],
      watch_items: [],
    }),
    /daily_call\.brief_id must be a UUID v4/,
  );
});
