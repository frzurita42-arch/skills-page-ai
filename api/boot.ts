import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
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

// Best-effort schema catch-up on boot so an existing database accepts CEFR
// levels (otherwise new runs/decks silently fail to save). Never blocks boot.
void ensureCefrLevelEnum().catch((err) =>
  console.warn(
    "[migrate] CEFR level enum auto-migration skipped:",
    err instanceof Error ? err.message : err,
    "— run `npx tsx scripts/migrate-cefr-levels.ts` manually if new runs fail to save.",
  ),
);

// Best-effort: add the runs.annotationsJson column on older databases.
void ensureRunAnnotationsColumn().catch((err) =>
  console.warn(
    "[migrate] run annotations column auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

// Best-effort: add commercial contact columns + the orders table.
void ensureCommercialSchema().catch((err) =>
  console.warn(
    "[migrate] commercial schema auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

// Best-effort: add the moderator ticket-pool column + the tickets table.
void ensureTicketSchema().catch((err) =>
  console.warn(
    "[migrate] ticket schema auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

// Best-effort: allow the walkthrough template (template enum gains "walkthrough").
void ensureWalkthroughTemplate().catch((err) =>
  console.warn(
    "[migrate] walkthrough template enum auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

// Best-effort: allow storing an ElevenLabs TTS key (provider enum gains "elevenlabs").
void ensureElevenLabsProvider().catch((err) =>
  console.warn(
    "[migrate] elevenlabs provider enum auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

// Best-effort: allow favoriting users (targetType enum gains "user").
void ensureUserFavoriteType().catch((err) =>
  console.warn(
    "[migrate] user-favorite enum auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

// Best-effort: add the per-user customizations table.
void ensureCustomizationSchema().catch((err) =>
  console.warn(
    "[migrate] customization schema auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

// Best-effort: add slide-tool authoring columns (defaultTone, source, deckJson).
void ensureSlideToolAuthoring().catch((err) =>
  console.warn(
    "[migrate] slide-tool authoring auto-migration skipped:",
    err instanceof Error ? err.message : err,
  ),
);

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

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
