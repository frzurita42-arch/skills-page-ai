import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router.js";
import { createContext } from "./context.js";
import { ensureCefrLevelEnum } from "./lib/migrate-levels.js";
import {
  ensureRunAnnotationsColumn,
  ensureCommercialSchema,
  ensureTicketSchema,
  ensureUserFavoriteType,
  ensureCustomizationSchema,
  ensureSlideToolAuthoring,
  ensureElevenLabsProvider,
  ensureWalkthroughTemplate,
} from "./lib/migrate-annotations.js";

/**
 * Vercel serverless entry. Vercel's Node runtime invokes the default export
 * with Node's (IncomingMessage, ServerResponse). We load the Hono app and the
 * @hono/node-server request listener LAZILY inside the handler and wrap it in
 * try/catch so that ANY failure — a bad import, a missing env var, a handler
 * crash — is returned as readable JSON instead of Vercel's opaque
 * FUNCTION_INVOCATION_FAILED page. Open /api/trpc/health to see the real error.
 *
 * vercel.json rewrites every /api/* request here; the function receives the
 * original URL, so /api/trpc/* still reaches the tRPC handler. Vercel serves the
 * built SPA (dist/public) directly, so this function only handles the API.
 */

type NodeListener = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
let listenerPromise: Promise<NodeListener> | null = null;

const runMigrations = () => {
  const warn = (label: string) => (err: unknown) =>
    console.warn(`[migrate] ${label} skipped:`, err instanceof Error ? err.message : err);
  void ensureCefrLevelEnum().catch(warn("CEFR level enum"));
  void ensureRunAnnotationsColumn().catch(warn("run annotations column"));
  void ensureCommercialSchema().catch(warn("commercial schema"));
  void ensureTicketSchema().catch(warn("ticket schema"));
  void ensureWalkthroughTemplate().catch(warn("walkthrough/news template enum"));
  void ensureElevenLabsProvider().catch(warn("elevenlabs provider enum"));
  void ensureUserFavoriteType().catch(warn("user-favorite enum"));
  void ensureCustomizationSchema().catch(warn("customization schema"));
  void ensureSlideToolAuthoring().catch(warn("slide-tool authoring"));
};

runMigrations();

const app = new Hono<{ Bindings: HttpBindings }>();
app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

async function buildListener(): Promise<NodeListener> {
  const { getRequestListener } = await import("@hono/node-server");
  return getRequestListener(app.fetch);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!listenerPromise) listenerPromise = buildListener();
    const listener = await listenerPromise;
    return await listener(req, res);
  } catch (err) {
    // a failure here would otherwise be an opaque 500 — surface it instead
    listenerPromise = null; // let the next request retry a fresh import
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
    }
    res.end(JSON.stringify({ error: "api_handler_failed", detail: detail.slice(0, 4000) }));
  }
}
