import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { ensureCefrLevelEnum } from "./lib/migrate-levels";
import {
  ensureRunAnnotationsColumn,
  ensureCommercialSchema,
  ensureTicketSchema,
  ensureUserFavoriteType,
  ensureCustomizationSchema,
  ensureSlideToolAuthoring,
  ensureElevenLabsProvider,
  ensureWalkthroughTemplate,
} from "./lib/migrate-annotations";

/**
 * The tRPC/Hono API app, WITHOUT any host bootstrap. Import this from a host
 * entry: `boot.ts` runs it as a long-lived Node server (self-hosted), and
 * `server.ts` wraps it as a Vercel serverless function. Keeping the app free of
 * `serve()`/static-file side effects means importing it never starts a server.
 */

// Best-effort schema catch-up so an existing database accepts newer enum
// values/columns. Fire-and-forget, idempotent, never blocks a request.
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

export default app;
