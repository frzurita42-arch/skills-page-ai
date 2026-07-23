import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or } from "drizzle-orm";
import { createRouter } from "../middleware";
import { adminProcedure, moderatorProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import { runs, users } from "@db/schema";
import { applyTokenDelta } from "../tokens";
import type { AdminUserRow } from "@contracts/types";

async function toRow(db: ReturnType<typeof getDb>, u: typeof users.$inferSelect): Promise<AdminUserRow> {
  const userRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.userId, u.id));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tokenBalance: u.tokenBalance,
    runCount: userRuns.length,
    createdAt: u.createdAt,
  };
}

export const usersRouter = createRouter({
  list: moderatorProcedure
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          role: z.enum(["user", "moderator", "admin"]).optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.role) conds.push(eq(users.role, input.role));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(users.email, q), like(users.name, q))!);
      }
      const rows = await db
        .select()
        .from(users)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(users.createdAt))
        .limit(input?.limit ?? 100);
      return Promise.all(rows.map((u) => toRow(db, u)));
    }),

  detail: moderatorProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      return toRow(db, user);
    }),

  /** Admin only — role assignment. */
  setRole: adminProcedure
    .input(z.object({ userId: z.number().int(), role: z.enum(["user", "moderator", "admin"]) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id && input.role !== "admin") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You can't demote yourself" });
      }
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { ok: true as const };
    }),

  /** Moderator+ manual token credit with ledger entry. */
  creditTokens: moderatorProcedure
    .input(
      z.object({
        userId: z.number().int(),
        amount: z.number().int().min(1).max(100000),
        reason: z.string().max(255).default("manual credit"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const balance = await applyTokenDelta(
        input.userId,
        input.amount,
        `${input.reason} (by ${ctx.user.email})`,
      );
      return { ok: true as const, balance };
    }),
});
