import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { authedProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import { lessons, repos, slideTools, units, users } from "@db/schema";
import { completeText, generateImage, resolveKey, userHasKey } from "../ai/provider";
import { mockCoachReply, mockDeck, mockLessonPath } from "../ai/mock";
import {
  buildLessonPathPrompt,
  buildSlidesSystemPrompt,
  COACH_SYSTEM_PROMPT,
  coachResponseSchema,
  extractJson,
  imageStyleSchema,
  lessonPathSchema,
  levelSchema,
  repoRef,
  slideDeckSchema,
  slugify,
  templateSchema,
} from "../ai/prompts";
import { estimateCost } from "../cost";
import { applyTokenDelta, refundTokens } from "../tokens";
import { buildPreviouslyTaught } from "../memory";
import type { CoachReply, SlideDeck } from "@contracts/types";

const GUEST_MAX_SLIDES = 6;
const MAX_SLIDES = 15;

/**
 * Offline demo content (mock decks/lesson paths) is opt-in. By default a
 * failed or unconfigured AI provider is a hard error: nothing is created,
 * tokens are refunded, and the client shows what went wrong — instead of
 * silently saving placeholder content that looks like a real plan.
 */
const mockAiAllowed = () => process.env.SKETCHLEARN_ALLOW_MOCK_AI === "1";

const AI_UNAVAILABLE_MSG =
  "AI_UNAVAILABLE: no AI provider produced content — nothing was saved and any tokens were refunded. Check the server .env AI keys (e.g. GEMINI_API_KEY) or add your own key in Settings → API Keys, then try again.";

/** Naive in-memory rate limiter (per key, per window) — for the public coach. */
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Slow down a little ✏️" });
  }
}

function clientKey(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon"
  );
}

/** Find a unique slug for repos/slideTools (append -2, -3, … on collision). */
async function uniqueSlug(table: "repos" | "slideTools", base: string): Promise<string> {
  const db = getDb();
  let candidate = base;
  for (let i = 2; ; i++) {
    const found =
      table === "repos"
        ? await db.query.repos.findFirst({ where: eq(repos.slug, candidate) })
        : await db.query.slideTools.findFirst({ where: eq(slideTools.slug, candidate) });
    if (!found) return candidate;
    candidate = `${base}-${i}`;
  }
}

export const generateRouter = createRouter({
  /* ---------------- cost estimate (design §8) ---------------- */
  estimate: publicQuery
    .input(
      z.object({
        slideCount: z.number().int().min(1).max(MAX_SLIDES),
        imageStyle: imageStyleSchema,
        withTts: z.boolean().default(false),
        level: levelSchema,
        useOwnKey: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const usingOwnKey =
        input.useOwnKey && ctx.user ? await userHasKey(ctx.user.id, "text") : false;
      return estimateCost({
        slideCount: input.slideCount,
        imageStyle: input.imageStyle,
        withTts: input.withTts,
        level: input.level,
        usingOwnKey,
      });
    }),

  /* ---------------- lesson path: repo + tool, one action ------- */
  lessonPath: authedProcedure
    .input(
      z.object({
        description: z.string().min(3).max(2000),
        template: templateSchema,
        level: levelSchema,
        slideCount: z.number().int().min(3).max(MAX_SLIDES).default(8),
        imageStyle: imageStyleSchema.default("sketch"),
        unitCount: z.number().int().min(1).max(8).default(4),
        lessonsPerUnit: z.number().int().min(1).max(6).default(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const usingOwnKey = await userHasKey(ctx.user.id, "text");
      // Scope proxy: one "deck's worth" per lesson of structure.
      const scopeSlides = Math.min(
        MAX_SLIDES,
        Math.max(3, Math.ceil((input.unitCount * input.lessonsPerUnit) / 2)),
      );
      const cost = await estimateCost({
        slideCount: scopeSlides,
        imageStyle: input.imageStyle,
        withTts: false,
        level: input.level,
        usingOwnKey,
      });
      if (ctx.user.tokenBalance < cost.total) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `INSUFFICIENT_TOKENS: this plan needs ${cost.total} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
        });
      }
      const reason = `lesson-path: ${input.description.slice(0, 60)}`;
      await applyTokenDelta(ctx.user.id, -cost.total, reason);

      let draft: import("../ai/prompts").LessonPathDraft;
      let usedMock = false;
      try {
        const prompt = buildLessonPathPrompt({
          description: input.description,
          template: input.template,
          unitCount: input.unitCount,
          lessonsPerUnit: input.lessonsPerUnit,
        });
        let parsed: import("../ai/prompts").LessonPathDraft | null = null;
        for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user.id,
              messages: [
                { role: "system", content: prompt },
                {
                  role: "user",
                  content:
                    attempt === 0
                      ? input.description
                      : `${input.description}\n\nReminder: STRICT JSON ONLY, exactly the requested shape.`,
                },
              ],
              maxTokens: 4096,
            });
            if (!result) break; // no key → mock below
            parsed = lessonPathSchema.parse(JSON.parse(extractJson(result.text)));
          } catch (err) {
            console.warn(`[generate.lessonPath] LLM parse attempt ${attempt + 1} failed:`, err);
          }
        }
        usedMock = parsed === null;
        if (parsed === null && !mockAiAllowed()) {
          await refundTokens(ctx.user.id, cost.total, `refund: ${reason}`);
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: AI_UNAVAILABLE_MSG });
        }
        draft = parsed ?? mockLessonPath({
          description: input.description,
          template: input.template,
          unitCount: input.unitCount,
          lessonsPerUnit: input.lessonsPerUnit,
        });
      } catch (err) {
        if (err instanceof TRPCError) throw err; // already refunded above
        await refundTokens(ctx.user.id, cost.total, `refund: ${reason}`);
        console.error("[generate.lessonPath] generation failed, refunded:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Generation failed — tokens refunded" });
      }

      try {
        const db = getDb();
        const toolSlug = await uniqueSlug("slideTools", slugify(draft.toolName));
        const repoSlug = await uniqueSlug("repos", slugify(draft.title));
        const totalLessons = draft.units.reduce((n, u) => n + u.lessons.length, 0);
        if (totalLessons === 0) throw new Error("Draft contains no lessons");

        await db.transaction(async (tx) => {
          const [{ id: newToolId }] = await tx
            .insert(slideTools)
            .values({
              slug: toolSlug,
              name: draft.toolName,
              description: draft.description,
              ownerId: ctx.user.id,
              topic: draft.toolTopic,
              instructions: draft.toolInstructions,
              defaultLevel: input.level,
              defaultSlideCount: input.slideCount,
              defaultImageStyle: input.imageStyle,
              isPublic: true,
            })
            .returning({ id: slideTools.id });
          void newToolId;
          const [{ id: newRepoId }] = await tx
            .insert(repos)
            .values({
              slug: repoSlug,
              ref: repoRef(repoSlug),
              title: draft.title,
              description: draft.description,
              template: input.template,
              ownerId: ctx.user.id,
              studyToolSlug: toolSlug,
              isPublic: true,
            })
            .returning({ id: repos.id });
          let seq = 0;
          for (let u = 0; u < draft.units.length; u++) {
            const unit = draft.units[u];
            const [{ id: unitId }] = await tx
              .insert(units)
              .values({ repoId: newRepoId, title: unit.title, orderIndex: u })
              .returning({ id: units.id });
            for (let l = 0; l < unit.lessons.length; l++) {
              seq += 1;
              await tx.insert(lessons).values({
                unitId,
                title: unit.lessons[l].title,
                objective: unit.lessons[l].objective,
                orderIndex: l,
                globalSeq: seq,
              });
            }
          }
        });

        const fresh = await getDb().query.users.findFirst({ where: eq(users.id, ctx.user.id) });
        return {
          repoSlug,
          toolSlug,
          ref: repoRef(repoSlug),
          cost: cost.total,
          balance: fresh?.tokenBalance ?? ctx.user.tokenBalance - cost.total,
          usedMock,
        };
      } catch (err) {
        await refundTokens(ctx.user.id, cost.total, `refund: ${reason}`);
        console.error("[generate.lessonPath] persistence failed, refunded:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not save the notebook — tokens refunded" });
      }
    }),

  /* ---------------- slide deck generation ---------------------- */
  slides: publicQuery
    .input(
      z.object({
        toolSlug: z.string().min(1),
        topic: z.string().max(2000).optional(),
        instructions: z.string().max(4000).optional(),
        level: levelSchema,
        slideCount: z.number().int().min(1).max(MAX_SLIDES),
        imageStyle: imageStyleSchema,
        seed: z
          .object({
            repoSlug: z.string(),
            repoRef: z.string(),
            unitTitle: z.string(),
            lessonTitle: z.string(),
            lessonIndex: z.number().int(),
            lessonCount: z.number().int(),
            lessonSeq: z.number().int(),
            lessonSeqTotal: z.number().int(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{
      deck: SlideDeck;
      usedMock: boolean;
      cost: number;
      balance: number | null;
      previouslyTaught: string | null;
    }> => {
      const db = getDb();
      const tool = await db.query.slideTools.findFirst({
        where: eq(slideTools.slug, input.toolSlug),
      });
      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Slide tool not found" });

      const isGuest = !ctx.user;
      if (isGuest) rateLimit(clientKey(ctx.req), 10, 60_000);
      const slideCount = isGuest ? Math.min(input.slideCount, GUEST_MAX_SLIDES) : input.slideCount;

      // Resolve topic/instructions: explicit input > lesson objective (seed) > tool defaults
      let topic = input.topic ?? tool.topic;
      let instructions = input.instructions ?? tool.instructions;
      let previouslyTaught: string | null = null;
      if (input.seed) {
        const repo = await db.query.repos.findFirst({ where: eq(repos.slug, input.seed.repoSlug) });
        if (repo) {
          const repoUnits = await db.select().from(units).where(eq(units.repoId, repo.id));
          const unitIds = repoUnits.map((u) => u.id);
          for (const unitId of unitIds) {
            const lesson = await db.query.lessons.findFirst({
              where: (l, { and, eq: e }) => and(e(l.unitId, unitId), e(l.globalSeq, input.seed!.lessonSeq)),
            });
            if (lesson) {
              if (!input.topic) topic = lesson.objective;
              if (!input.instructions) instructions = lesson.objective;
              break;
            }
          }
          previouslyTaught = await buildPreviouslyTaught(repo.id, input.seed.lessonSeq);
        }
      }

      // Token gate — signed-in users only; guests get the free limited path
      let cost = 0;
      let reason = "";
      if (ctx.user) {
        const usingOwnKey = await userHasKey(ctx.user.id, "text");
        const estimate = await estimateCost({
          slideCount,
          imageStyle: input.imageStyle,
          withTts: false,
          level: input.level,
          usingOwnKey,
        });
        if (ctx.user.tokenBalance < estimate.total) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `INSUFFICIENT_TOKENS: this deck needs ${estimate.total} 🪙, you have ${ctx.user.tokenBalance} 🪙`,
          });
        }
        cost = estimate.total;
        reason = `slides: ${tool.slug} (${slideCount} slides)`;
        await applyTokenDelta(ctx.user.id, -cost, reason);
      }

      const systemPrompt = buildSlidesSystemPrompt({
        level: input.level,
        imageStyle: input.imageStyle,
        previouslyTaught,
      });
      const userPrompt = [
        `TOPIC: ${topic}`,
        instructions && instructions !== topic ? `INSTRUCTIONS: ${instructions}` : null,
        `Write exactly ${slideCount} slides.`,
        input.seed
          ? `This is lesson ${input.seed.lessonSeq} of ${input.seed.lessonSeqTotal} ("${input.seed.lessonTitle}", unit "${input.seed.unitTitle}") in the repository "${input.seed.repoSlug}".`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      let deck: SlideDeck | null = null;
      let usedMock = false;
      try {
        for (let attempt = 0; attempt < 2 && deck === null; attempt++) {
          try {
            const result = await completeText({
              userId: ctx.user?.id,
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content:
                    attempt === 0
                      ? userPrompt
                      : `${userPrompt}\n\nReminder: STRICT JSON ONLY, exactly the requested shape.`,
                },
              ],
              // A full deck is a large JSON; leave generous headroom so the
              // model's output is never truncated mid-object (providers clamp
              // this to their own per-model maximums).
              maxTokens: 16384,
            });
            if (!result) break; // no key configured → mock
            deck = slideDeckSchema.parse(JSON.parse(extractJson(result.text)));
          } catch (err) {
            console.warn(`[generate.slides] LLM parse attempt ${attempt + 1} failed:`, err);
          }
        }
      } catch (err) {
        console.error("[generate.slides] provider error:", err);
      }

      if (!deck) {
        if (!mockAiAllowed()) {
          if (ctx.user && cost > 0) await refundTokens(ctx.user.id, cost, `refund: ${reason}`);
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: AI_UNAVAILABLE_MSG });
        }
        usedMock = true;
        deck = mockDeck({
          topic,
          level: input.level,
          slideCount,
          imageStyle: input.imageStyle,
          previouslyTaught,
        });
      }
      // Enforce the requested slide count even if the model drifted
      deck = { ...deck, slides: deck.slides.slice(0, slideCount), level: input.level, imageStyle: input.imageStyle };

      // Attach real generated images when an image key is configured.
      // Cheap key check first — without a key this adds zero latency and the
      // player keeps the style-thumbnail fallback. Cap at 4 images per deck
      // to bound cost/latency; failures only skip that one image.
      if (input.imageStyle !== "none") {
        const imageKey = await resolveKey(ctx.user?.id, "image");
        if (imageKey) {
          let generated = 0;
          for (const slide of deck.slides) {
            if (generated >= 4) break;
            for (const comp of slide.components) {
              if (generated >= 4) break;
              if (comp.type !== "image") continue;
              try {
                const url = await generateImage({
                  userId: ctx.user?.id,
                  prompt: comp.prompt,
                  style: input.imageStyle,
                });
                if (url) {
                  comp.imageUrl = url;
                  generated += 1;
                }
              } catch (err) {
                console.warn("[generate.slides] image generation failed for one component:", err);
              }
            }
          }
        }
      }

      let balance: number | null = null;
      if (ctx.user) {
        const fresh = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
        balance = fresh?.tokenBalance ?? null;
      }
      return { deck, usedMock, cost, balance, previouslyTaught };
    }),

})

/* ---------------- coach chat --------------------------------- */
export const coachChatProcedure = publicQuery
    .input(
      z.object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "coach"]),
              content: z.string().min(1).max(4000),
            }),
          )
          .min(1)
          .max(40),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<CoachReply> => {
      rateLimit(clientKey(ctx.req), 20, 60_000);
      const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
      const history = input.messages.slice(-12).map((m) => ({
        role: (m.role === "coach" ? "assistant" : "user") as "assistant" | "user",
        content: m.content,
      }));
      try {
        const result = await completeText({
          userId: ctx.user?.id,
          messages: [{ role: "system", content: COACH_SYSTEM_PROMPT }, ...history],
          maxTokens: 1024,
        });
        if (result) {
          try {
            return coachResponseSchema.parse(JSON.parse(extractJson(result.text)));
          } catch (err) {
            console.warn("[coach.chat] parse failed, falling back to mock:", err);
          }
        }
      } catch (err) {
        console.error("[coach.chat] provider error, falling back to mock:", err);
      }
      return mockCoachReply(lastUser?.content ?? "hello");
    });
