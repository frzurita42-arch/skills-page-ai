import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { authedProcedure, moderatorProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import { lessons, repos, runs, slideTools, units, lessonLogs } from "@db/schema";
import { imageStyleSchema, levelSchema } from "../ai/prompts";
import type { LessonLogSlide, RunDetail, RunReplay, RunRow, RunSlideDetail, SlideDeck } from "@contracts/types";

const perSlideSchema = z.object({
  title: z.string(),
  summary: z.string(),
  visuals: z.array(z.string()).default([]),
  question: z.string().nullable().default(null),
  chosenOption: z.string().nullable().default(null),
  correct: z.boolean().nullable().default(null),
});

const seedSchema = z.object({
  repoSlug: z.string(),
  repoRef: z.string(),
  unitTitle: z.string(),
  lessonTitle: z.string(),
  lessonIndex: z.number().int(),
  lessonCount: z.number().int(),
  lessonSeq: z.number().int(),
  lessonSeqTotal: z.number().int(),
});

async function toRunRow(db: ReturnType<typeof getDb>, r: typeof runs.$inferSelect): Promise<RunRow> {
  const tool = await db.query.slideTools.findFirst({ where: eq(slideTools.id, r.slideToolId) });
  let repoSlug: string | null = null;
  let repoRef: string | null = null;
  if (r.repoId) {
    const repo = await db.query.repos.findFirst({ where: eq(repos.id, r.repoId) });
    repoSlug = repo?.slug ?? null;
    repoRef = repo?.ref ?? null;
  }
  let lessonTitle: string | null = null;
  if (r.lessonId) {
    const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, r.lessonId) });
    lessonTitle = lesson?.title ?? null;
  }
  return {
    id: r.id,
    toolSlug: tool?.slug ?? "unknown",
    toolName: tool?.name ?? "Unknown tool",
    repoSlug,
    repoRef,
    lessonTitle,
    playerName: r.playerName,
    level: r.level,
    imageStyle: r.imageStyle,
    slideCount: r.slideCount,
    scoreCorrect: r.scoreCorrect,
    scoreTotal: r.scoreTotal,
    elapsedSec: r.elapsedSec,
    flagged: r.flagged,
    completedAt: r.completedAt,
  };
}

export const runsRouter = createRouter({
  /**
   * Save a completed play. Call ONLY when the player reaches the finish
   * screen — a run row means a full completion (design.md §9).
   */
  complete: publicQuery
    .input(
      z.object({
        toolSlug: z.string().min(1),
        seed: seedSchema.optional(),
        level: levelSchema,
        imageStyle: imageStyleSchema,
        slideCount: z.number().int().min(1).max(30),
        elapsedSec: z.number().int().min(0).max(24 * 3600),
        playerName: z.string().max(255).optional(),
        deck: z.unknown().optional(), // full generated deck snapshot
        perSlide: z.array(perSlideSchema).max(30).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({
        where: eq(slideTools.slug, input.toolSlug),
      });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });

      const answered = input.perSlide.filter((s) => s.correct !== null);
      const scoreTotal = answered.length;
      const scoreCorrect = answered.filter((s) => s.correct === true).length;

      // Resolve repo/lesson from the seed
      let repoId: number | null = null;
      let lessonId: number | null = null;
      if (input.seed) {
        const repo = await db.query.repos.findFirst({
          where: eq(repos.slug, input.seed.repoSlug),
        });
        if (repo) {
          repoId = repo.id;
          const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
          for (const u of repoUnits) {
            const lesson = await db.query.lessons.findFirst({
              where: and(eq(lessons.unitId, u.id), eq(lessons.globalSeq, input.seed.lessonSeq)),
            });
            if (lesson) {
              lessonId = lesson.id;
              break;
            }
          }
        }
      }

      const [{ runId }] = await db.transaction(async (tx) => {
        const [{ id }] = await tx
          .insert(runs)
          .values({
            slideToolId: tool.id,
            repoId,
            lessonId,
            userId: ctx.user?.id ?? null,
            playerName: input.playerName ?? ctx.user?.name ?? "Guest",
            seedJson: input.seed ?? null,
            level: input.level,
            imageStyle: input.imageStyle,
            slideCount: input.slideCount,
            scoreCorrect,
            scoreTotal,
            elapsedSec: input.elapsedSec,
            deckJson: input.deck ?? null,
          })
          .returning({ id: runs.id });

        // Repo-launched play → write the lesson log (the memory loop)
        if (repoId && lessonId) {
          await tx.insert(lessonLogs).values({
            repoId,
            lessonId,
            runId: id,
            userId: ctx.user?.id ?? null,
            level: input.level,
            scoreCorrect,
            scoreTotal,
            elapsedSec: input.elapsedSec,
            perSlideJson: input.perSlide,
          });
        }
        return [{ runId: id }];
      });

      return { score: { correct: scoreCorrect, total: scoreTotal }, runId };
    }),

  /**
   * Full run detail for the Runs-page drawer: the run row plus a clean
   * per-slide recap. Slide titles/components come from the stored deck
   * snapshot (deckJson); recorded answers come from the lessonLogs row
   * (perSlideJson) written for repo-launched plays.
   */
  get: publicQuery
    .input(z.object({ runId: z.number().int() }))
    .query(async ({ input }): Promise<RunDetail> => {
      const db = getDb();
      const r = await db.query.runs.findFirst({ where: eq(runs.id, input.runId) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      const row = await toRunRow(db, r);

      const log = await db.query.lessonLogs.findFirst({ where: eq(lessonLogs.runId, r.id) });
      const answers: LessonLogSlide[] = Array.isArray(log?.perSlideJson)
        ? (log!.perSlideJson as LessonLogSlide[])
        : [];
      const deck = (r.deckJson ?? null) as SlideDeck | null;
      const deckSlides = deck && Array.isArray(deck.slides) ? deck.slides : [];

      const count = Math.max(deckSlides.length, answers.length);
      const slides: RunSlideDetail[] = [];
      for (let i = 0; i < count; i++) {
        const d = deckSlides[i];
        const a = answers[i];
        slides.push({
          title: a?.title ?? d?.title ?? `Slide ${i + 1}`,
          components: Array.isArray(d?.components) ? d.components.map((c) => c.type) : [],
          question: a?.question ?? d?.quiz?.question ?? null,
          chosenOption: a?.chosenOption ?? null,
          correct: a?.correct ?? null,
        });
      }
      return { ...row, slides };
    }),

  /**
   * Full replay of a past play: the exact stored deck (deckJson) plus the
   * student's recorded answers, so the played slideshow is navigable again
   * like a reviewable post. Access is scoped — only the player who made the
   * run, the repo owner, moderators and admins may replay it.
   */
  replay: publicQuery
    .input(z.object({ runId: z.number().int() }))
    .query(async ({ ctx, input }): Promise<RunReplay> => {
      const db = getDb();
      const r = await db.query.runs.findFirst({ where: eq(runs.id, input.runId) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });

      // access control: own run, or repo owner, or moderator/admin
      let repoOwnerId: number | null = null;
      if (r.repoId) {
        const repo = await db.query.repos.findFirst({ where: eq(repos.id, r.repoId) });
        repoOwnerId = repo?.ownerId ?? null;
      }
      const privileged =
        !!ctx.user &&
        (r.userId === ctx.user.id ||
          repoOwnerId === ctx.user.id ||
          ctx.user.role === "moderator" ||
          ctx.user.role === "admin");
      if (!privileged) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only replay your own presentation runs.",
        });
      }

      const row = await toRunRow(db, r);
      const deck = (r.deckJson ?? null) as SlideDeck | null;
      const log = await db.query.lessonLogs.findFirst({ where: eq(lessonLogs.runId, r.id) });
      const recorded: LessonLogSlide[] = Array.isArray(log?.perSlideJson)
        ? (log!.perSlideJson as LessonLogSlide[])
        : [];

      const slides = deck && Array.isArray(deck.slides) ? deck.slides : [];
      const answers = slides.map((s, i) => {
        const a = recorded[i];
        const correctOption =
          s.quiz && typeof s.quiz.correctIndex === "number"
            ? (s.quiz.options[s.quiz.correctIndex] ?? null)
            : null;
        return {
          chosenOption: a?.chosenOption ?? null,
          correctOption,
          correct: a?.correct ?? null,
        };
      });
      return { ...row, deck, answers };
    }),

  listGlobal: publicQuery
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(runs)
        .orderBy(desc(runs.completedAt))
        .limit(input?.limit ?? 25)
        .offset(input?.offset ?? 0);
      return Promise.all(rows.map((r) => toRunRow(db, r)));
    }),

  listMine: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(runs)
        .where(eq(runs.userId, ctx.user.id))
        .orderBy(desc(runs.completedAt))
        .limit(input?.limit ?? 50);
      return Promise.all(rows.map((r) => toRunRow(db, r)));
    }),

  setFlagged: moderatorProcedure
    .input(z.object({ runId: z.number().int(), flagged: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(runs).set({ flagged: input.flagged }).where(eq(runs.id, input.runId));
      return { ok: true as const };
    }),
});
