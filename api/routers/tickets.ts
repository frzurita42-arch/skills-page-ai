import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { createRouter } from "../middleware";
import { authedProcedure, moderatorProcedure, adminProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import { repos, tickets, users } from "@db/schema";
import { ticketPrice } from "../cost";
import { countAvailable, grantToUser, sellToModerator } from "../tickets";
import type { MyTicketGroup } from "@contracts/types";

export const ticketsRouter = createRouter({
  /** Live credit price of one customization ticket. */
  price: authedProcedure.query(async () => ({ price: await ticketPrice() })),

  /** How many unused tickets the signed-in user holds for one repo. */
  availableFor: authedProcedure
    .input(z.object({ repoSlug: z.string() }))
    .query(async ({ ctx, input }): Promise<{ count: number }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) return { count: 0 };
      return { count: await countAvailable(ctx.user.id, repo.id) };
    }),

  /** The signed-in user's unused tickets, grouped by repo. */
  mine: authedProcedure.query(async ({ ctx }): Promise<MyTicketGroup[]> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.holderId, ctx.user.id), eq(tickets.consumed, false)))
      .orderBy(desc(tickets.createdAt));
    const byRepo = new Map<number, number>();
    for (const t of rows) byRepo.set(t.repoId, (byRepo.get(t.repoId) ?? 0) + 1);
    const out: MyTicketGroup[] = [];
    for (const [repoId, count] of byRepo) {
      const repo = await db.query.repos.findFirst({ where: eq(repos.id, repoId) });
      if (repo) out.push({ repoSlug: repo.slug, repoTitle: repo.title, count });
    }
    return out;
  }),

  /**
   * A moderator (repo owner) gifts customization tickets to a user for a repo
   * they own. The user is identified by email (what they'd hand the moderator).
   */
  grantToUser: moderatorProcedure
    .input(
      z.object({
        repoSlug: z.string(),
        userEmail: z.string().email(),
        count: z.number().int().min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ ok: true; remaining: number; userName: string }> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.repoSlug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (repo.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the repo's owner can hand out its tickets",
        });
      }
      const holder = await db.query.users.findFirst({
        where: eq(users.email, input.userEmail.trim().toLowerCase()),
      });
      if (!holder) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No user with the email ${input.userEmail} — they need an account first`,
        });
      }
      const { remaining } = await grantToUser(ctx.user.id, repo.id, holder.id, input.count);
      return { ok: true as const, remaining, userName: holder.name };
    }),

  /**
   * The admin sells tickets to a moderator (debits the moderator's credits at
   * the live ticket price and grows their ticket pool).
   */
  sellToModerator: adminProcedure
    .input(z.object({ userId: z.number().int(), count: z.number().int().min(1).max(500) }))
    .mutation(async ({ input }) => {
      return sellToModerator(input.userId, input.count);
    }),
});
