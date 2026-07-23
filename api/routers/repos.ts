import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, like, or, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { authedProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import {
  favorites,
  lessons,
  repos,
  runs,
  slideTools,
  units,
  users,
  type Repo,
  type User,
} from "@db/schema";
import { repoRef, slugify, templateSchema } from "../ai/prompts";
import { courseMemory } from "../memory";
import type { RepoDetail, RepoLesson, RepoSummary, RepoUnit, LessonRunRow, Level } from "@contracts/types";

async function favoriteSlugs(userId: number | undefined, targetType: "repo" | "slideTool") {
  if (!userId) return new Set<string>();
  const rows = await getDb()
    .select({ slug: favorites.targetSlug })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.targetType, targetType)));
  return new Set(rows.map((r) => r.slug));
}

async function repoSummaries(repoRows: Repo[], userId: number | undefined): Promise<RepoSummary[]> {
  const db = getDb();
  const favs = await favoriteSlugs(userId, "repo");
  const out: RepoSummary[] = [];
  for (const repo of repoRows) {
    const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
    let lessonCount = 0;
    for (const u of repoUnits) {
      const ls = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.unitId, u.id));
      lessonCount += ls.length;
    }
    const repoRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.repoId, repo.id));
    let ownerName: string | null = null;
    if (repo.ownerId) {
      const owner = await db.query.users.findFirst({ where: eq(users.id, repo.ownerId) });
      ownerName = owner?.name ?? null;
    }
    out.push({
      slug: repo.slug,
      ref: repo.ref,
      title: repo.title,
      description: repo.description,
      template: repo.template,
      unitCount: repoUnits.length,
      lessonCount,
      runCount: repoRuns.length,
      isPublic: repo.isPublic,
      favorite: favs.has(repo.slug),
      ownerName,
      createdAt: repo.createdAt,
    });
  }
  return out;
}

function canEdit(repo: Repo, user: User) {
  return repo.ownerId === user.id || user.role === "admin";
}

export const reposRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          template: templateSchema.optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<RepoSummary[]> => {
      const db = getDb();
      const conds = [];
      if (!ctx.user || ctx.user.role === "user") conds.push(eq(repos.isPublic, true));
      if (input?.template) conds.push(eq(repos.template, input.template));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(repos.title, q), like(repos.description, q), like(repos.slug, q))!);
      }
      const rows = await db
        .select()
        .from(repos)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(repos.createdAt))
        .limit(input?.limit ?? 50);
      const summaries = await repoSummaries(rows, ctx.user?.id);
      // favorites first for signed-in users
      return summaries.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }),

  getBySlug: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RepoDetail> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!repo.isPublic && (!ctx.user || !canEdit(repo, ctx.user))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }
      const [summary] = await repoSummaries([repo], ctx.user?.id);
      const repoUnits = await db
        .select()
        .from(units)
        .where(eq(units.repoId, repo.id))
        .orderBy(units.orderIndex);
      const repoRuns = await db.select().from(runs).where(eq(runs.repoId, repo.id));
      const unitList: RepoUnit[] = [];
      for (const u of repoUnits) {
        const ls = await db
          .select()
          .from(lessons)
          .where(eq(lessons.unitId, u.id))
          .orderBy(lessons.orderIndex);
        const lessonList: RepoLesson[] = ls.map((l) => ({
          id: l.id,
          title: l.title,
          objective: l.objective,
          orderIndex: l.orderIndex,
          globalSeq: l.globalSeq,
          parentLessonId: l.parentLessonId,
          runCount: repoRuns.filter((r) => r.lessonId === l.id).length,
        }));
        unitList.push({ id: u.id, title: u.title, orderIndex: u.orderIndex, lessons: lessonList });
      }
      let toolName: string | null = null;
      if (repo.studyToolSlug) {
        const tool = await db.query.slideTools.findFirst({
          where: eq(slideTools.slug, repo.studyToolSlug),
        });
        toolName = tool?.name ?? null;
      }
      return {
        ...summary,
        ownerId: repo.ownerId,
        studyToolSlug: repo.studyToolSlug,
        toolName,
        units: unitList,
      };
    }),

  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(3).max(255),
        description: z.string().max(4000).default(""),
        template: templateSchema.default("course"),
        studyToolSlug: z.string().max(191).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const base = slugify(input.title);
      let slug = base;
      for (let i = 2; await db.query.repos.findFirst({ where: eq(repos.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      await db.insert(repos).values({
        slug,
        ref: repoRef(slug),
        title: input.title,
        description: input.description,
        template: input.template,
        ownerId: ctx.user.id,
        studyToolSlug: input.studyToolSlug ?? null,
        isPublic: true,
      });
      return { slug, ref: repoRef(slug) };
    }),

  update: authedProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(3).max(255).optional(),
        description: z.string().max(4000).optional(),
        isPublic: z.boolean().optional(),
        studyToolSlug: z.string().max(191).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can edit" });
      }
      // NOTE: slug and ref are stable — never changed here.
      const set: Partial<Pick<Repo, "title" | "description" | "isPublic" | "studyToolSlug">> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.description !== undefined) set.description = input.description;
      if (input.isPublic !== undefined) set.isPublic = input.isPublic;
      if (input.studyToolSlug !== undefined) set.studyToolSlug = input.studyToolSlug;
      if (Object.keys(set).length > 0) {
        await db.update(repos).set(set).where(eq(repos.id, repo.id));
      }
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      if (!canEdit(repo, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can delete" });
      }
      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      for (const u of repoUnits) {
        await db.delete(lessons).where(eq(lessons.unitId, u.id));
      }
      await db.delete(units).where(eq(units.repoId, repo.id));
      await db.delete(repos).where(eq(repos.id, repo.id));
      return { ok: true as const };
    }),

  toggleFavorite: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, ctx.user.id),
          eq(favorites.targetType, "repo"),
          eq(favorites.targetSlug, input.slug),
        ),
      });
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { favorite: false };
      }
      await db.insert(favorites).values({
        userId: ctx.user.id,
        targetType: "repo",
        targetSlug: input.slug,
      });
      return { favorite: true };
    }),

  lessonRuns: publicQuery
    .input(z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(200).default(100) }))
    .query(async ({ input }): Promise<LessonRunRow[]> => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      const repoRuns = await db
        .select()
        .from(runs)
        .where(eq(runs.repoId, repo.id))
        .orderBy(desc(runs.completedAt))
        .limit(input.limit);
      const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
      const lessonById = new Map<number, { title: string; globalSeq: number }>();
      for (const u of repoUnits) {
        const ls = await db.select().from(lessons).where(eq(lessons.unitId, u.id));
        for (const l of ls) lessonById.set(l.id, { title: l.title, globalSeq: l.globalSeq });
      }
      return repoRuns.map((r) => ({
        id: r.id,
        lessonId: r.lessonId,
        lessonTitle: r.lessonId ? (lessonById.get(r.lessonId)?.title ?? null) : null,
        lessonSeq: r.lessonId ? (lessonById.get(r.lessonId)?.globalSeq ?? null) : null,
        playerName: r.playerName,
        level: r.level as Level,
        scoreCorrect: r.scoreCorrect,
        scoreTotal: r.scoreTotal,
        elapsedSec: r.elapsedSec,
        completedAt: r.completedAt,
      }));
    }),

  courseMemory: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = getDb();
      const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.slug) });
      if (!repo) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      return courseMemory(repo.id);
    }),
});
