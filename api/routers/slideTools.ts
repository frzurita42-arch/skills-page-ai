import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, like, or, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { authedProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import { favorites, runs, slideTools, users, type SlideTool, type User } from "@db/schema";
import { imageStyleSchema, levelSchema, slugify } from "../ai/prompts";
import type { SlideToolSummary } from "@contracts/types";

async function toSummary(tool: SlideTool, userId: number | undefined): Promise<SlideToolSummary> {
  const db = getDb();
  const toolRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.slideToolId, tool.id));
  let favorite = false;
  if (userId) {
    const fav = await db.query.favorites.findFirst({
      where: and(
        eq(favorites.userId, userId),
        eq(favorites.targetType, "slideTool"),
        eq(favorites.targetSlug, tool.slug),
      ),
    });
    favorite = !!fav;
  }
  let ownerName: string | null = null;
  if (tool.ownerId) {
    const owner = await db.query.users.findFirst({ where: eq(users.id, tool.ownerId) });
    ownerName = owner?.name ?? null;
  }
  return {
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    topic: tool.topic,
    instructions: tool.instructions,
    defaultLevel: tool.defaultLevel,
    defaultSlideCount: tool.defaultSlideCount,
    defaultImageStyle: tool.defaultImageStyle,
    isPublic: tool.isPublic,
    favorite,
    runCount: toolRuns.length,
    ownerName,
    createdAt: tool.createdAt,
  };
}

function canEdit(tool: SlideTool, user: User) {
  return tool.ownerId === user.id || user.role === "admin";
}

export const slideToolsRouter = createRouter({
  list: publicQuery
    .input(z.object({ q: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }): Promise<SlideToolSummary[]> => {
      const db = getDb();
      const conds = [];
      if (!ctx.user || ctx.user.role === "user") conds.push(eq(slideTools.isPublic, true));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(or(like(slideTools.name, q), like(slideTools.description, q), like(slideTools.topic, q))!);
      }
      const rows = await db
        .select()
        .from(slideTools)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(slideTools.createdAt))
        .limit(input?.limit ?? 50);
      const summaries = await Promise.all(rows.map((t) => toSummary(t, ctx.user?.id)));
      return summaries.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    }),

  getBySlug: publicQuery
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!tool.isPublic && (!ctx.user || !canEdit(tool, ctx.user))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      }
      return toSummary(tool, ctx.user?.id);
    }),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(255),
        description: z.string().max(4000).default(""),
        topic: z.string().max(2000).default(""),
        instructions: z.string().max(4000).default(""),
        defaultLevel: levelSchema.default("A1"),
        defaultSlideCount: z.number().int().min(1).max(15).default(8),
        defaultImageStyle: imageStyleSchema.default("sketch"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const base = slugify(input.name);
      let slug = base;
      for (let i = 2; await db.query.slideTools.findFirst({ where: eq(slideTools.slug, slug) }); i++) {
        slug = `${base}-${i}`;
      }
      await db.insert(slideTools).values({ ...input, slug, ownerId: ctx.user.id, isPublic: true });
      return { slug };
    }),

  update: authedProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        name: z.string().min(3).max(255).optional(),
        description: z.string().max(4000).optional(),
        topic: z.string().max(2000).optional(),
        instructions: z.string().max(4000).optional(),
        defaultLevel: levelSchema.optional(),
        defaultSlideCount: z.number().int().min(1).max(15).optional(),
        defaultImageStyle: imageStyleSchema.optional(),
        isPublic: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can edit" });
      }
      const { slug: _slug, ...set } = input;
      const clean = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length > 0) {
        await db.update(slideTools).set(clean).where(eq(slideTools.id, tool.id));
      }
      return { ok: true as const };
    }),

  delete: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.slug, input.slug) });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });
      if (!canEdit(tool, ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can delete" });
      }
      await db.delete(slideTools).where(eq(slideTools.id, tool.id));
      return { ok: true as const };
    }),

  toggleFavorite: authedProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, ctx.user.id),
          eq(favorites.targetType, "slideTool"),
          eq(favorites.targetSlug, input.slug),
        ),
      });
      if (existing) {
        await db.delete(favorites).where(eq(favorites.id, existing.id));
        return { favorite: false };
      }
      await db.insert(favorites).values({
        userId: ctx.user.id,
        targetType: "slideTool",
        targetSlug: input.slug,
      });
      return { favorite: true };
    }),
});
