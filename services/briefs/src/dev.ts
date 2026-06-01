import { Pool } from "pg";

import { createBriefsServer } from "./http.ts";
import { sealDailyCallSnapshot } from "./seal.ts";

const host = process.env.BRIEFS_HOST ?? "127.0.0.1";
const port = Number(process.env.BRIEFS_PORT ?? "4336");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for briefs dev server");
}

const pool = new Pool({ connectionString: databaseUrl });

const server = createBriefsServer(pool, {
  sealDailyCall: (input) => sealDailyCallSnapshot(pool, input),
  // v1 fan-out seam: published calls are logged here. Real delivery (email /
  // web push / digest) lands once a daily_call_notifications queue exists.
  onPublished: (brief) => {
    console.log(`daily call published: ${brief.brief_id} (snapshot ${brief.snapshot_id})`);
  },
});

server.listen(port, host, () => {
  console.log(`briefs listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
