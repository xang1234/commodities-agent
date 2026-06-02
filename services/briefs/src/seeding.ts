import type { PublicSubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "./repo.ts";

export type SeedDraftInput = {
  user_id: string;
  commodity_refs: ReadonlyArray<PublicSubjectRef & { kind: "commodity" }>;
};

export type SeededDraft = {
  narrative: string;
  driver_ids: ReadonlyArray<string>;
  seed_finding_ids: ReadonlyArray<string>;
};

const SEED_FINDING_LIMIT = 50;

type SeedFindingRow = {
  finding_id: string;
  claim_cluster_ids: unknown;
  headline: string;
};

// Compose a starter daily call from today's high/critical findings for the
// chosen commodities, drawn from the user's enabled agents. The findings'
// headlines become the narrative and their claim clusters become the drivers;
// an empty result yields a blank draft the analyst fills in by hand.
export async function seedDraftFromFindings(
  db: QueryExecutor,
  input: SeedDraftInput,
): Promise<SeededDraft> {
  if (input.commodity_refs.length === 0) {
    return { narrative: blankNarrative(), driver_ids: [], seed_finding_ids: [] };
  }

  const result = await db.query<SeedFindingRow>(
    `select f.finding_id::text as finding_id,
            f.claim_cluster_ids,
            f.headline
       from findings f
       join agents a on a.agent_id = f.agent_id
      where a.user_id = $1::uuid
        and a.enabled = true
        and f.severity = any($2::finding_severity[])
        and f.created_at >= date_trunc('day', now() at time zone 'UTC')
        and exists (
          select 1
            from jsonb_array_elements($3::jsonb) as want(ref)
           where f.subject_refs @> jsonb_build_array(want.ref)
        )
      order by f.created_at desc, f.finding_id asc
      limit $4`,
    [input.user_id, ["high", "critical"], JSON.stringify(input.commodity_refs), SEED_FINDING_LIMIT],
  );

  if (result.rows.length === 0) {
    return { narrative: blankNarrative(), driver_ids: [], seed_finding_ids: [] };
  }

  const seedFindingIds: string[] = [];
  const headlines: string[] = [];
  const driverIds = new Set<string>();
  for (const row of result.rows) {
    seedFindingIds.push(row.finding_id);
    headlines.push(row.headline.trim());
    for (const clusterId of parseClusterIds(row.claim_cluster_ids)) driverIds.add(clusterId);
  }

  return {
    narrative: headlines.map((headline) => `- ${headline}`).join("\n"),
    driver_ids: Object.freeze([...driverIds]),
    seed_finding_ids: Object.freeze(seedFindingIds),
  };
}

function blankNarrative(): string {
  return "No high or critical findings for these commodities today. Write the daily call.";
}

function parseClusterIds(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
