import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { type AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { Pool } from "pg";

import { createBriefsServer } from "../src/http.ts";
import { sealDailyCallSnapshot } from "../src/seal.ts";
import type { DailyCallBrief } from "../src/daily-call.ts";

const WORKSPACE_ROOT = join(import.meta.dirname, "..", "..", "..");
const DB_ROOT = join(WORKSPACE_ROOT, "db");

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER_USER_ID = "00000000-0000-4000-8000-0000000000a2";
const COPPER_ID = "22222222-2222-4222-8222-222222222222";
const IRON_ORE_ID = "33333333-3333-4333-8333-333333333333";

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
  });
}

function dockerAvailable(): boolean {
  return run("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 5000 }).status === 0;
}

function containerName(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}`;
}

function stopPostgres(name: string): void {
  run("docker", ["rm", "--force", name], { timeout: 5000 });
}

function startPostgres(name: string): string | null {
  const result = run("docker", [
    "run", "--detach", "--rm", "--name", name,
    "-e", "POSTGRES_PASSWORD=postgres",
    "-p", "127.0.0.1::5432",
    "postgres:15",
  ], { timeout: 5000 });
  if (result.status !== 0) return null;
  const port = run("docker", ["port", name, "5432/tcp"], { timeout: 5000 });
  assert.equal(port.status, 0, port.stderr || port.stdout);
  const match = port.stdout.trim().match(/:(\d+)$/);
  assert.ok(match, `expected docker port output to include a host port, got: ${port.stdout}`);
  return match[1];
}

async function waitForPostgres(name: string, databaseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = run("docker", ["exec", name, "pg_isready", "-U", "postgres"], { timeout: 5000 });
    if (ready.status === 0) {
      try {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        try {
          await pool.query("select 1");
          return;
        } finally {
          await pool.end().catch(() => {});
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.fail(`Timed out waiting for Postgres container ${name}`);
}

async function bootstrapDatabase(t: TestContext, prefix: string): Promise<{ containerName: string; databaseUrl: string }> {
  const name = containerName(prefix);
  const hostPort = startPostgres(name);
  if (hostPort === null) {
    t.skip("Docker is present but Postgres container did not start");
    return { containerName: name, databaseUrl: "" };
  }
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${hostPort}/postgres`;
  try {
    await waitForPostgres(name, databaseUrl);
    const apply = run("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
      cwd: DB_ROOT,
      env: { DATABASE_URL: databaseUrl },
      timeout: 60000,
    });
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    return { containerName: name, databaseUrl };
  } catch (error) {
    stopPostgres(name);
    throw error;
  }
}

type ServerHandle = { origin: string; close: () => Promise<void> };

async function startServer(pool: Pool, published: DailyCallBrief[]): Promise<ServerHandle> {
  const server = createBriefsServer(pool, {
    sealDailyCall: (input) => sealDailyCallSnapshot(pool, input),
    onPublished: (brief) => {
      published.push(brief);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function call(
  origin: string,
  method: string,
  path: string,
  options: { userId?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (options.userId !== undefined) headers["x-user-id"] = options.userId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, json: text === "" ? null : JSON.parse(text) };
}

test(
  "daily call flows create -> edit -> approve -> publish with a sealed snapshot",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { containerName: name, databaseUrl } = await bootstrapDatabase(t, "briefs-http");
    if (databaseUrl === "") return;
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const published: DailyCallBrief[] = [];
    const server = await startServer(pool, published);
    t.after(async () => {
      await server.close();
      await pool.end().catch(() => {});
      stopPostgres(name);
    });

    await pool.query("insert into users (user_id, email) values ($1::uuid, $2)", [USER_ID, "analyst@example.com"]);

    // Unauthenticated requests are rejected.
    const anon = await call(server.origin, "GET", "/v1/briefs");
    assert.equal(anon.status, 401);

    // Create auto-seeds a blank draft (no findings exist for this user yet).
    const created = await call(server.origin, "POST", "/v1/briefs", {
      userId: USER_ID,
      body: { commodity_refs: [{ kind: "commodity", id: COPPER_ID }, { kind: "commodity", id: IRON_ORE_ID }] },
    });
    assert.equal(created.status, 201);
    const briefId = created.json.brief.brief_id;
    assert.equal(created.json.brief.status, "draft");
    assert.equal(created.json.brief.snapshot_id, undefined);
    assert.deepEqual(created.json.brief.driver_ids, []);
    assert.match(created.json.brief.narrative, /No high or critical findings/);

    // Cannot publish before approval.
    const earlyPublish = await call(server.origin, "POST", `/v1/briefs/${briefId}/publish`, { userId: USER_ID });
    assert.equal(earlyPublish.status, 409);

    // Edit the draft content.
    const edited = await call(server.origin, "PATCH", `/v1/briefs/${briefId}`, {
      userId: USER_ID,
      body: {
        narrative: "Copper constructive on supply tightness; iron ore range-bound.",
        driver_ids: ["copper-supply-tightness"],
        watch_items: ["LME cash-3m spread"],
      },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.brief.narrative, "Copper constructive on supply tightness; iron ore range-bound.");
    assert.deepEqual(edited.json.brief.driver_ids, ["copper-supply-tightness"]);

    // Approve (analyst signoff stamps the reviewer).
    const approved = await call(server.origin, "POST", `/v1/briefs/${briefId}/approve`, { userId: USER_ID });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.brief.status, "approved");
    assert.equal(approved.json.brief.reviewer_user_id, USER_ID);

    // Editing an approved brief is rejected.
    const lateEdit = await call(server.origin, "PATCH", `/v1/briefs/${briefId}`, {
      userId: USER_ID,
      body: { narrative: "too late" },
    });
    assert.equal(lateEdit.status, 409);

    // Publish seals a snapshot and stamps the publication.
    const publishedResp = await call(server.origin, "POST", `/v1/briefs/${briefId}/publish`, { userId: USER_ID });
    assert.equal(publishedResp.status, 200);
    assert.equal(publishedResp.json.brief.status, "published");
    const snapshotId = publishedResp.json.brief.snapshot_id;
    assert.ok(snapshotId, "published brief carries a snapshot id");
    assert.ok(publishedResp.json.brief.published_at);

    // The sealed snapshot really exists and anchors the commodity subjects.
    const snapshotRow = await pool.query<{ subject_refs: unknown }>(
      "select subject_refs from snapshots where snapshot_id = $1::uuid",
      [snapshotId],
    );
    assert.equal(snapshotRow.rows.length, 1);

    // The publish hook fired exactly once.
    assert.equal(published.length, 1);
    assert.equal(published[0].brief_id, briefId);

    // The brief is listable and fetchable by its owner.
    const list = await call(server.origin, "GET", "/v1/briefs", { userId: USER_ID });
    assert.equal(list.status, 200);
    assert.equal(list.json.briefs.length, 1);

    // A different user cannot see it.
    const otherList = await call(server.origin, "GET", "/v1/briefs", { userId: OTHER_USER_ID });
    assert.equal(otherList.json.briefs.length, 0);
    const otherGet = await call(server.origin, "GET", `/v1/briefs/${briefId}`, { userId: OTHER_USER_ID });
    assert.equal(otherGet.status, 404);
  },
);
