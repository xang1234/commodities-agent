import assert from "node:assert/strict";
import test from "node:test";

import { seedDraftFromFindings } from "../src/seeding.ts";
import type { QueryExecutor } from "../src/repo.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COPPER_ID = "22222222-2222-4222-8222-222222222222";
const CLUSTER_A = "33333333-3333-4333-8333-333333333333";
const CLUSTER_B = "44444444-4444-4444-8444-444444444444";

type QueryCall = { text: string; values?: unknown[] };

function fakeDb(rows: ReadonlyArray<Record<string, unknown>>) {
  const calls: QueryCall[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: rows as R[] };
    },
  };
  return { db, calls };
}

test("seedDraftFromFindings returns a blank draft without querying when no commodities are given", async () => {
  const { db, calls } = fakeDb([]);

  const seed = await seedDraftFromFindings(db, { user_id: USER_ID, commodity_refs: [] });

  assert.equal(calls.length, 0);
  assert.match(seed.narrative, /No high or critical findings/);
  assert.deepEqual(seed.driver_ids, []);
  assert.deepEqual(seed.seed_finding_ids, []);
});

test("seedDraftFromFindings scopes to the user's enabled agents, high/critical, today, and the commodity refs", async () => {
  const { db, calls } = fakeDb([]);

  await seedDraftFromFindings(db, {
    user_id: USER_ID,
    commodity_refs: [{ kind: "commodity", id: COPPER_ID }],
  });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.match(call.text, /join agents a on a\.agent_id = f\.agent_id/i);
  assert.match(call.text, /a\.user_id = \$1::uuid/i);
  assert.match(call.text, /a\.enabled = true/i);
  assert.match(call.text, /f\.severity = any\(\$2::finding_severity\[\]\)/i);
  assert.match(call.text, /date_trunc\('day', now\(\) at time zone 'UTC'\)/i);
  assert.match(call.text, /f\.subject_refs @> jsonb_build_array\(want\.ref\)/i);
  assert.deepEqual(call.values?.[1], ["high", "critical"]);
  assert.equal(call.values?.[2], JSON.stringify([{ kind: "commodity", id: COPPER_ID }]));
});

test("seedDraftFromFindings builds narrative, drivers, and provenance from matching findings", async () => {
  const { db } = fakeDb([
    { finding_id: "f1", headline: "Copper supply shock tightens nearby", claim_cluster_ids: [CLUSTER_A, CLUSTER_B] },
    { finding_id: "f2", headline: "China demand softens", claim_cluster_ids: [CLUSTER_A] },
  ]);

  const seed = await seedDraftFromFindings(db, {
    user_id: USER_ID,
    commodity_refs: [{ kind: "commodity", id: COPPER_ID }],
  });

  assert.equal(seed.narrative, "- Copper supply shock tightens nearby\n- China demand softens");
  assert.deepEqual(seed.driver_ids, [CLUSTER_A, CLUSTER_B]);
  assert.deepEqual(seed.seed_finding_ids, ["f1", "f2"]);
});

test("seedDraftFromFindings falls back to a blank draft when nothing matches", async () => {
  const { db } = fakeDb([]);

  const seed = await seedDraftFromFindings(db, {
    user_id: USER_ID,
    commodity_refs: [{ kind: "commodity", id: COPPER_ID }],
  });

  assert.match(seed.narrative, /No high or critical findings/);
  assert.deepEqual(seed.driver_ids, []);
  assert.deepEqual(seed.seed_finding_ids, []);
});
