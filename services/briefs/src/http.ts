import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";
import { parsePublicCommodityRefs } from "./daily-call.ts";
import { listBriefs, type QueryExecutor } from "./repo.ts";
import {
  approveDailyCallBrief,
  BriefNotFoundError,
  BriefStateError,
  BriefValidationError,
  createDailyCall,
  editDailyCall,
  getDailyCall,
  publishDailyCallBrief,
  type BriefsDeps,
} from "./service.ts";
import { BriefsSealError } from "./seal.ts";

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

type Route =
  | { kind: "healthz" }
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "get"; brief_id: string }
  | { kind: "edit"; brief_id: string }
  | { kind: "approve"; brief_id: string }
  | { kind: "publish"; brief_id: string }
  | null;

export type BriefsServerOptions = { auth?: RequestAuthConfig };

export function createBriefsServer(
  db: QueryExecutor,
  deps: BriefsDeps,
  options: BriefsServerOptions = {},
): Server {
  const authConfig = options.auth ?? {};
  return createServer(async (req, res) => {
    try {
      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (route === null) {
        respond(res, 404, { error: "not found" });
        return;
      }
      if (route.kind === "healthz") {
        respond(res, 200, { status: "ok", service: "briefs" });
        return;
      }

      const userId = readAuthenticatedUserId(req, authConfig);
      if (userId === null) {
        respond(res, 401, { error: authenticatedUserRequiredMessage(authConfig) });
        return;
      }

      await handleRoute(db, deps, req, res, route, userId);
    } catch (error) {
      handleError(res, error);
    }
  });
}

async function handleRoute(
  db: QueryExecutor,
  deps: BriefsDeps,
  req: IncomingMessage,
  res: ServerResponse,
  route: Exclude<Route, null | { kind: "healthz" }>,
  userId: string,
): Promise<void> {
  switch (route.kind) {
    case "list": {
      respond(res, 200, { briefs: await listBriefs(db, userId) });
      return;
    }
    case "get": {
      respond(res, 200, { brief: await getDailyCall(db, userId, route.brief_id) });
      return;
    }
    case "create": {
      const body = await readJsonObject(req, res);
      if (body === null) return;
      const commodity_refs = parseCommodityRefs(body.commodity_refs);
      respond(res, 201, { brief: await createDailyCall(db, { user_id: userId, commodity_refs }) });
      return;
    }
    case "edit": {
      const body = await readJsonObject(req, res);
      if (body === null) return;
      respond(res, 200, {
        brief: await editDailyCall(db, {
          user_id: userId,
          brief_id: route.brief_id,
          ...parseEditFields(body),
        }),
      });
      return;
    }
    case "approve": {
      respond(res, 200, {
        brief: await approveDailyCallBrief(db, { user_id: userId, brief_id: route.brief_id }),
      });
      return;
    }
    case "publish": {
      respond(res, 200, {
        brief: await publishDailyCallBrief(db, deps, { user_id: userId, brief_id: route.brief_id }),
      });
      return;
    }
  }
}

function matchRoute(method: string, rawUrl: string): Route {
  const path = rawUrl.split("?")[0].replace(/\/+$/, "") || "/";
  if (method === "GET" && (path === "/healthz" || path === "/v1/briefs/healthz")) return { kind: "healthz" };
  if (path === "/v1/briefs") {
    if (method === "GET") return { kind: "list" };
    if (method === "POST") return { kind: "create" };
    return null;
  }
  const match = /^\/v1\/briefs\/([^/]+)(\/approve|\/publish)?$/.exec(path);
  if (match === null) return null;
  const briefId = match[1];
  if (!UUID_RE.test(briefId)) return null;
  const action = match[2];
  if (action === "/approve") return method === "POST" ? { kind: "approve", brief_id: briefId } : null;
  if (action === "/publish") return method === "POST" ? { kind: "publish", brief_id: briefId } : null;
  if (method === "GET") return { kind: "get", brief_id: briefId };
  if (method === "PATCH") return { kind: "edit", brief_id: briefId };
  return null;
}

// Narrow the raw request body to typed commodity refs using the contract's
// canonical validator, re-raising as a 400-mapped error.
function parseCommodityRefs(value: unknown) {
  try {
    return parsePublicCommodityRefs(value, "commodity_refs");
  } catch (error) {
    throw new BriefValidationError(error instanceof Error ? error.message : String(error));
  }
}

function parseEditFields(body: Record<string, unknown>): {
  narrative?: string;
  driver_ids?: ReadonlyArray<string>;
  watch_items?: ReadonlyArray<string>;
} {
  const fields: { narrative?: string; driver_ids?: ReadonlyArray<string>; watch_items?: ReadonlyArray<string> } = {};
  if (body.narrative !== undefined) {
    if (typeof body.narrative !== "string") throw new BriefValidationError("narrative must be a string");
    fields.narrative = body.narrative;
  }
  if (body.driver_ids !== undefined) fields.driver_ids = parseStringArray(body.driver_ids, "driver_ids");
  if (body.watch_items !== undefined) fields.watch_items = parseStringArray(body.watch_items, "watch_items");
  return fields;
}

function parseStringArray(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new BriefValidationError(`${label} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string") throw new BriefValidationError(`${label}[${index}] must be a string`);
    return item;
  });
}

function handleError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof BriefValidationError) {
    respond(res, 400, { error: error.message });
    return;
  }
  if (error instanceof BriefNotFoundError) {
    respond(res, 404, { error: error.message });
    return;
  }
  if (error instanceof BriefStateError) {
    respond(res, 409, { error: error.message });
    return;
  }
  if (error instanceof RequestBodyTooLargeError) {
    respond(res, 413, { error: error.message });
    return;
  }
  if (error instanceof BriefsSealError) {
    console.error("daily call seal failed", error);
    respond(res, 500, { error: "failed to seal daily call snapshot" });
    return;
  }
  console.error("briefs request failed", error);
  respond(res, 500, { error: "internal briefs error" });
}

async function readJsonObject(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const body = await readBody(req);
  if (body.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    respond(res, 400, { error: "request body must be valid JSON" });
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    respond(res, 400, { error: "request body must be a JSON object" });
    return null;
  }
  return parsed as Record<string, unknown>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk));
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
