import { sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { authRouter } from "./routers/auth";
import { generateRouter, coachChatProcedure } from "./routers/generate";
import { reposRouter } from "./routers/repos";
import { slideToolsRouter } from "./routers/slideTools";
import { runsRouter } from "./routers/runs";
import { lessonsRouter, unitsRouter } from "./routers/lessons";
import { keysRouter } from "./routers/keys";
import { tokensRouter } from "./routers/tokens";
import { paymentsRouter } from "./routers/payments";
import { usersRouter } from "./routers/users";
import { adminRouter } from "./routers/admin";
import { templatesRouter } from "./routers/templates";
import { ordersRouter } from "./routers/orders";
import { ticketsRouter } from "./routers/tickets";
import { ttsRouter } from "./routers/tts";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  // Deployment diagnostics — open /api/trpc/health in a browser. Tells you
  // whether the running function can see DATABASE_URL and reach the database,
  // without leaking any secret (the connection string itself is never returned).
  health: publicQuery.query(async () => {
    const hasDatabaseUrl = !!env.databaseUrl;
    let db: "ok" | "error" = "error";
    if (hasDatabaseUrl) {
      try {
        await getDb().execute(sql`select 1`);
        db = "ok";
      } catch {
        db = "error";
      }
    }
    return { ok: true, hasDatabaseUrl, db, node: process.version };
  }),

  auth: authRouter,
  generate: generateRouter,
  coach: createRouter({ chat: coachChatProcedure }),
  repos: reposRouter,
  slideTools: slideToolsRouter,
  runs: runsRouter,
  units: unitsRouter,
  lessons: lessonsRouter,
  keys: keysRouter,
  tokens: tokensRouter,
  payments: paymentsRouter,
  users: usersRouter,
  admin: adminRouter,
  templates: templatesRouter,
  orders: ordersRouter,
  tickets: ticketsRouter,
  tts: ttsRouter,
});

export type AppRouter = typeof appRouter;
