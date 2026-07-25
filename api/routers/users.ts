import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminProcedure, authedProcedure, moderatorProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import { favorites, repos, runs, users } from "@db/schema";
import { applyTokenDelta } from "../tokens";
import { favoriteSlugs, repoSummaries } from "./repos";
import type { AdminUserRow, DirectoryUser, UserProfile } from "@contracts/types";

async function toRow(db: ReturnType<typeof getDb>, u: typeof users.$inferSelect): Promise<AdminUserRow> {
  const userRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.userId, u.id));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tokenBalance: u.tokenBalance,
    ticketBalance: u.ticketBalance,
    runCount: userRuns.length,
    createdAt: u.createdAt,
  };
}

export const usersRouter = createRouter({
  /**
   * Public creator directory — anyone (including guests) can browse the people
   * who have published repos, favorite them, and open their profile. Only
   * creators with at least one public repo are listed.
   */
  directory: publicQuery
    .input(z.object({ q: z.string().max(200).optional() }).optional())
    .query(async ({ ctx, input }): Promise<DirectoryUser[]> => {
      const db = getDb();
      const publicRepos = await db
        .select({ ownerId: repos.ownerId })
        .from(repos)
        .where(eq(repos.isPublic, true));
      const counts = new Map<number, number>();
      for (const r of publicRepos) {
        if (r.ownerId != null) counts.set(r.ownerId, (counts.get(r.ownerId) ?? 0) + 1);
      }
      if (counts.size === 0) return [];
      const rows = await db.select().from(users);
      const favs = await favoriteSlugs(ctx.user?.id, "user");
      const q = input?.q?.trim().toLowerCase();
      return rows
        .filter((u) => counts.has(u.id))
        .filter((u) => !q || u.name.toLowerCase().includes(q))
        .map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          repoCount: counts.get(u.id) ?? 0,
          favorite: favs.has(String(u.id)),
        }))
        .sort(
          (a, b) =>
            Number(b.favorite) - Number(a.favorite) ||
            b.repoCount - a.repoCount ||
            a.name.localeCompare(b.name),
        );
    }),

  /** A creator's public profile: the public repos they own + public contact. */
  profile: publicQuery
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ ctx, input }): Promise<UserProfile> => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      const ownedPublic = await db
        .select()
        .from(repos)
        .where(and(eq(repos.ownerId, user.id), eq(repos.isPublic, true)))
        .orderBy(desc(repos.createdAt));
      const summaries = await repoSummaries(ownedPublic, ctx.user?.id);
      const favs = await favoriteSlugs(ctx.user?.id, "user");
      return {
        id: user.id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        whatsapp: user.whatsapp ?? null,
        socials: Array.isArray(user.socials) ? (user.socials as string[]) : [],
        contactNote: user.contactNote ?? null,
        favorite: favs.has(String(user.id)),
        repos: summaries,
      };
    }),

  /** Favorite / unfavorite a creator (targetType "user"). */
  toggleFavorite: authedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ ctx, input }): Promise<{ favorite: boolean }> => {
      const db = getDb();
      const slug = String(input.userId);
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, ctx.user.id),
          eq(favorites.targetType, "user"),
          eq(favorites.targetSlug, slug),
        ),
      });
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { favorite: false };
      }
      await db.insert(favorites).values({ userId: ctx.user.id, targetType: "user", targetSlug: slug });
      return { favorite: true };
    }),

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
