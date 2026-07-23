import { createRouter, publicQuery } from "./middleware";
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

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

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
});

export type AppRouter = typeof appRouter;
