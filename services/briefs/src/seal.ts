import { randomUUID } from "node:crypto";

import { stageSnapshotManifest } from "../../snapshot/src/manifest-staging.ts";
import {
  sealSnapshotWithPool,
  type SnapshotClientPool,
} from "../../snapshot/src/snapshot-sealer.ts";
import type { PublicSubjectRef } from "../../shared/src/subject-ref.ts";

export class BriefsSealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefsSealError";
  }
}

export type SealDailyCallInput = {
  commodity_refs: ReadonlyArray<PublicSubjectRef & { kind: "commodity" }>;
  as_of: string;
};

// Seals a provenance snapshot for a published daily call. The snapshot anchors
// the call to its commodity subjects and as-of time; the brief row carries the
// editable content, so the manifest deliberately holds no source/claim refs and
// no blocks (which the structural verifier accepts trivially).
export async function sealDailyCallSnapshot(
  pool: SnapshotClientPool,
  input: SealDailyCallInput,
): Promise<string> {
  const snapshotId = randomUUID();
  const manifest = stageSnapshotManifest({
    subject_refs: input.commodity_refs.map((ref) => ({ kind: "commodity" as const, id: ref.id })),
    as_of: input.as_of,
    basis: "unadjusted",
    normalization: "raw",
    allowed_transforms: {},
    model_version: "daily-call-briefs",
    tool_calls: [],
  });

  const result = await sealSnapshotWithPool(pool, {
    snapshot_id: snapshotId,
    manifest,
    blocks: [],
  });

  if (!result.ok) {
    throw new BriefsSealError(
      `failed to seal daily call snapshot: ${JSON.stringify(result.verification.failures)}`,
    );
  }
  return result.snapshot.snapshot_id;
}
