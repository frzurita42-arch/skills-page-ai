import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { authedProcedure } from "../procedures";
import { getDb } from "../queries/connection";
import { lessons, repos, slideTools, units, users } from "@db/schema";
import { completeText, generateImage, userHasKey } from "../ai/provider";
import { mockCoachReply, mockDeck, mockLessonPath } from "../ai/mock";
import {
  buildLessonPathPrompt,
  buildSlidesSystemPrompt,
  COACH_SYSTEM_PROMPT,
  coachResponseSchema,
  extractJson,
  imageStyleSchema,
  lessonPathSchema,
  ensureExplanatoryProse,
  shuffleQuizAnswers,
  levelSchema,
  repairDeckDraft,
  repoRef,
  slideDeckSchema,
  slugify,
  templateSchema,
} from "../ai/prompts";
import { estimateCost } from "../cost";
import { applyTokenDelta, refundTokens } from "../tokens";
import { buildPreviouslyTaught } from "../memory";
import { loadTemplateCatalog } from "./templates";
import {
  templatesForSubjectAndLevel,
  slideConformsToAny,
  slideConformsToTemplate,
  bestMatchingTemplate,
  GRADABLE_TYPES,
  TEMPLATE_COMPONENT_LABELS,
} from "@contracts/slide-templates";
import { isStemTopic } from "@contracts/stem";
import { typedOverlapCorrect } from "@contracts/grade";
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
        // Advanced: pin a specific layout template per slide (by template
        // name). null / missing entry = let the AI choose. Index i → slide i+1.
        templatePlan: z.array(z.string().max(120).nullable()).max(MAX_SLIDES).optional(),
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
      slidePlan: import("@contracts/types").SlidePlanInfo[];
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
          previouslyTaught = await buildPreviouslyTaught(repo.id, input.seed.lessonSeq, ctx.user?.id);
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

      // Offer the AI only the layouts that fit this topic's subject area AND
      // this deck's difficulty level (beginner=lighter text, advanced=denser).
      // The same filtered set is used to VALIDATE that each generated slide
      // conforms to an approved configuration (so text is guaranteed because
      // every template pairs its visuals with a text step).
      const catalog = await loadTemplateCatalog();
      const allowedTemplates = templatesForSubjectAndLevel(
        catalog,
        isStemTopic(topic),
        input.level,
      );
      // Minimum distinct body paragraphs a teaching slide must carry at this
      // CEFR band — a C1 deck must not ship slides with a single short line.
      // Mirrors the PARAGRAPH FLOOR stated in the system prompt.
      const paraFloor = ["C1", "C2"].includes(input.level)
        ? 4
        : ["B1", "B2"].includes(input.level)
          ? 3
          : input.level === "A2"
            ? 2
            : 1;
      const layoutTemplates = allowedTemplates.map((t) => ({
        name: t.name,
        tags: t.tags,
        components: t.components.map((c) => TEMPLATE_COMPONENT_LABELS[c]),
      }));

      // Advanced: a per-slide pinned template (chosen in the UI). Matched by
      // name against the FULL catalog so the user can pin any layout. When a
      // slide is pinned, its output must conform to exactly that template.
      const pinnedPlan: (typeof catalog[number] | null)[] = (input.templatePlan ?? [])
        .slice(0, slideCount)
        .map((name) =>
          name ? catalog.find((t) => t.name === name) ?? null : null,
        );
      const planLines = pinnedPlan
        .map((t, i) => {
          if (!t) return null;
          // spell out the exact deck component types the slide's JSON must
          // contain, and name the non-text pieces that must NOT be dropped
          const content = t.components.filter((c) => !GRADABLE_TYPES.includes(c));
          const hasEval = t.components.some((c) => GRADABLE_TYPES.includes(c));
          const mustInclude = content
            .filter((c) => c !== "prose")
            .map((c) => `a ${c} component (${TEMPLATE_COMPONENT_LABELS[c]})`);
          const proseCount = content.filter((c) => c === "prose").length;
          const typeArray = `[${content.map((c) => `"${c}"`).join(", ")}]`;
          // This layout expects N SEPARATE text blocks (each its own "prose"
          // component, rendered as its own row) — the player lays them out in
          // document order, so two paragraphs must be two prose components, not
          // one long block, or the "text → table → text" shape collapses.
          const proseRule =
            proseCount >= 2
              ? ` This layout has ${proseCount} separate text sections: emit ${proseCount} distinct "prose" components (each a real paragraph in its own array slot, in the order shown) — do NOT merge them into one.`
              : "";
          return `  • Slide ${i + 1} — layout "${t.name}": the slide's "components" array MUST contain these types, in this order: ${typeArray}${hasEval ? ', and the slide MUST have a "quiz"' : ""}.${mustInclude.length ? ` You MUST actually build ${mustInclude.join(" and ")} with real content on this slide — do NOT omit ${mustInclude.length > 1 ? "them" : "it"} or replace ${mustInclude.length > 1 ? "them" : "it"} with more paragraphs.` : ""}${proseRule}`;
        })
        .filter(Boolean);

      const systemPrompt = buildSlidesSystemPrompt({
        level: input.level,
        imageStyle: input.imageStyle,
        previouslyTaught,
        layoutTemplates,
      });
      const userPrompt = [
        `TOPIC: ${topic}`,
        instructions && instructions !== topic ? `INSTRUCTIONS: ${instructions}` : null,
        `Write exactly ${slideCount} slides.`,
        planLines.length > 0
          ? `SLIDE PLAN (MANDATORY) — the user has PINNED an exact layout for the slides listed below. This overrides your own layout choice for those slides: you MUST build each listed slide with exactly the component types shown, including every table/chart/image/code/formula/diagram called for (with real content about the topic — e.g. a topic-relevant table even if the layout name mentions grammar). For any slide number NOT listed, choose a fitting layout from the catalog.\n${planLines.join("\n")}`
          : null,
        input.seed
          ? `This is lesson ${input.seed.lessonSeq} of ${input.seed.lessonSeqTotal} ("${input.seed.lessonTitle}", unit "${input.seed.unitTitle}") in the repository "${input.seed.repoSlug}".`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      let deck: SlideDeck | null = null;
      let lastAttempt: SlideDeck | null = null; // best non-conforming try, as a fallback
      let usedMock = false;
      // A pinned SLIDE PLAN is an explicit user request, so give the model
      // more chances to honor it exactly before we accept a miss.
      const hasPlan = pinnedPlan.some(Boolean);
      const maxAttempts = hasPlan ? 3 : 2;
      try {
        for (let attempt = 0; attempt < maxAttempts && deck === null; attempt++) {
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
                      : `${userPrompt}\n\nReminder: STRICT JSON ONLY, exactly the requested shape. Return EXACTLY ${slideCount} slides — no fewer. EVERY slide MUST follow one of the SLIDE LAYOUT TEMPLATES exactly — include all of its steps, so any image/chart/table/diagram/formula/code is paired with the text that explains it. Never a slide that is only a visual and a question.${hasPlan ? " Your previous attempt did NOT honor the MANDATORY SLIDE PLAN — for each pinned slide, the 'components' array MUST include the exact table/chart/image/code/formula/diagram it lists, built with real content. Do not drop them." : ""}`,
                },
              ],
              // A full deck is a large JSON; leave generous headroom so the
              // model's output is never truncated mid-object (providers clamp
              // this to their own per-model maximums).
              maxTokens: 16384,
            });
            if (!result) break; // no key configured → mock
            const repaired = repairDeckDraft(JSON.parse(extractJson(result.text)), {
              level: input.level,
              imageStyle: input.imageStyle,
              topic,
            });
            const parsedDeck = slideDeckSchema.parse(repaired);
            // Each slide must conform to one of the approved layout templates
            // (a text-less visual+question slide matches none of them). Give
            // the model one more attempt to follow the catalog before we
            // accept the deck (final safety net fills any gap below).
            const nonConforming =
              allowedTemplates.length > 0 &&
              parsedDeck.slides.some((s, i) => {
                const shape = {
                  componentTypes: s.components.map((c) => c.type),
                  hasQuiz: !!s.quiz,
                };
                const pinned = pinnedPlan[i];
                // a pinned slide must match its chosen template EXACTLY (strict
                // prose count, so every text block it lists is produced);
                // others just need to match any allowed layout
                const structOk = pinned
                  ? slideConformsToTemplate(shape, pinned, true)
                  : slideConformsToAny(shape, allowedTemplates);
                // and — regardless of layout — a teaching slide must carry the
                // CEFR paragraph floor of distinct body-text paragraphs, so a
                // C1 slide can't ship as one short line. Count paragraphs
                // across every prose component.
                const paraCount = s.components.reduce(
                  (n, c) => n + (c.type === "prose" ? c.paragraphs.length : 0),
                  0,
                );
                return !structOk || paraCount < paraFloor;
              });
            // The model sometimes under-delivers (e.g. 3 slides when 8 were
            // asked). Retry (up to maxAttempts) before accepting a miss.
            const tooFewSlides = parsedDeck.slides.length < slideCount;
            if (attempt < maxAttempts - 1 && (nonConforming || tooFewSlides)) {
              console.warn(
                tooFewSlides
                  ? `[generate.slides] model returned ${parsedDeck.slides.length}/${slideCount} slides — retry ${attempt + 1}/${maxAttempts - 1}`
                  : `[generate.slides] a slide did not match its ${hasPlan ? "pinned" : "approved"} template — retry ${attempt + 1}/${maxAttempts - 1}`,
              );
              // keep the fullest attempt so far as a fallback
              if (!lastAttempt || parsedDeck.slides.length > lastAttempt.slides.length) {
                lastAttempt = parsedDeck;
              }
              continue;
            }
            deck = parsedDeck;
          } catch (err) {
            const detail =
              err instanceof z.ZodError
                ? JSON.stringify(err.issues.slice(0, 5))
                : err instanceof Error
                  ? err.message
                  : String(err);
            console.warn(`[generate.slides] LLM parse attempt ${attempt + 1} failed:`, detail);
          }
        }
      } catch (err) {
        console.error("[generate.slides] provider error:", err);
      }

      // Both attempts under-delivered but the model did return usable slides —
      // ship its best try rather than falling through to mock/error.
      if (!deck && lastAttempt) {
        console.warn(
          `[generate.slides] accepting best attempt with ${lastAttempt.slides.length}/${slideCount} slides`,
        );
        deck = lastAttempt;
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
      // Guarantee every slide has explanatory text — no image-only slides ship
      deck = ensureExplanatoryProse(deck);
      // Randomize each quiz's correct-answer position (models almost always
      // put the answer first, so otherwise every question is "A").
      deck = shuffleQuizAnswers(deck);

      // Eagerly generate ONLY the first slide's image inline so slide 1 opens
      // with its picture already in place (no visible wait on the opening
      // slide). Every other slide's image still streams in lazily in the
      // player. Costs one image's latency, not the whole deck's.
      if (input.imageStyle !== "none" && deck.slides.length > 0) {
        const firstImg = deck.slides[0].components.find((c) => c.type === "image");
        if (firstImg && firstImg.type === "image" && !firstImg.imageUrl) {
          try {
            const url = await generateImage({
              userId: ctx.user?.id,
              prompt: firstImg.prompt,
              style: input.imageStyle,
            });
            if (url) firstImg.imageUrl = url;
          } catch (err) {
            console.warn(
              "[generate.slides] first-slide image failed (player will lazy-load it):",
              err instanceof Error ? err.message : err,
            );
          }
        }
      }

      // NOTE: images are NOT generated here. Generating up to N images inline
      // (each up to 60s) was the dominant cause of the long "dealing your
      // deck" wait. The deck now returns as soon as the text is ready, and the
      // player lazily fetches each slide's image via generate.slideImage as
      // the learner advances (current + next prefetched). Until an image
      // arrives the player shows the style thumbnail, so nothing looks broken.

      // Per-slide layout info for the admin diagnostic badge: the pinned
      // template (what the AI was told to use) or the best-matching layout the
      // AI actually produced.
      const slidePlan = deck.slides.map((s, i) => {
        const shape = { componentTypes: s.components.map((c) => c.type), hasQuiz: !!s.quiz };
        const pinned = pinnedPlan[i];
        if (pinned) {
          return { template: pinned.name, pinned: true, components: pinned.components as string[] };
        }
        const match = bestMatchingTemplate(shape, allowedTemplates);
        // Show the slide's ACTUAL component sequence (not the matched
        // template's ideal one) so the badge never claims more text sections
        // than the slide really has. Append the real quiz kind as its step.
        const quizStep =
          s.quiz &&
          ({ mcq: "quiz", mcq2: "mcq2", fillblank: "fillblank", typed: "shortanswer" }[
            s.quiz.kind ?? "mcq"
          ] as string);
        const realComponents = [
          ...s.components.map((c) => c.type),
          ...(quizStep ? [quizStep] : []),
        ];
        return {
          template: match?.name ?? null,
          pinned: false,
          components: realComponents,
        };
      });

      let balance: number | null = null;
      if (ctx.user) {
        const fresh = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
        balance = fresh?.tokenBalance ?? null;
      }
      return { deck, usedMock, cost, balance, previouslyTaught, slidePlan };
    }),

  /**
   * Generate ONE slide image on demand. The deck's image cost is already paid
   * at generation time, so this is not charged again — it just turns a slide's
   * image prompt into a data URI. The player calls it lazily per slide (current
   * + next prefetch) so the deck can open immediately instead of waiting for
   * every image up front. Returns null when no image key is configured or the
   * provider fails, and the player keeps the style-thumbnail fallback.
   */
  slideImage: publicQuery
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        style: imageStyleSchema,
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ imageUrl: string | null }> => {
      if (input.style === "none") return { imageUrl: null };
      const imageUrl = await generateImage({
        userId: ctx.user?.id,
        prompt: input.prompt,
        style: input.style,
      });
      return { imageUrl };
    }),

  /**
   * Grade a typed free-text answer against the question's reference answer.
   * Uses the AI when a text key is configured; otherwise falls back to a
   * lenient token-overlap check so typed questions still work keyless.
   */
  gradeTyped: publicQuery
    .input(
      z.object({
        question: z.string().min(1).max(2000),
        reference: z.string().min(1).max(2000),
        answer: z.string().max(4000),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ correct: boolean; feedback: string }> => {
      const student = input.answer.trim();
      if (!student) return { correct: false, feedback: "No answer was entered." };

      try {
        const result = await completeText({
          userId: ctx.user?.id,
          messages: [
            {
              role: "system",
              content:
                'You grade a student\'s short typed answer against a reference answer. Be lenient about wording, spelling, and phrasing — reward correct meaning, not exact words. Reply STRICT JSON ONLY: {"correct":true|false,"feedback":"one short encouraging sentence"}.',
            },
            {
              role: "user",
              content: `QUESTION: ${input.question}\nREFERENCE ANSWER: ${input.reference}\nSTUDENT ANSWER: ${student}\n\nIs the student's answer correct in meaning? Reply JSON only.`,
            },
          ],
          maxTokens: 200,
        });
        if (result) {
          const parsed = JSON.parse(extractJson(result.text)) as {
            correct?: boolean;
            feedback?: string;
          };
          if (typeof parsed.correct === "boolean") {
            return {
              correct: parsed.correct,
              feedback:
                (parsed.feedback && String(parsed.feedback).slice(0, 300)) ||
                (parsed.correct ? "Correct." : "Not quite."),
            };
          }
        }
      } catch (err) {
        console.warn("[gradeTyped] AI grading failed, using overlap fallback:", err instanceof Error ? err.message : err);
      }

      // fallback: token overlap with the reference
      const correct = typedOverlapCorrect(student, input.reference);
      return {
        correct,
        feedback: correct
          ? "Looks right — you covered the key idea."
          : "Missing the key idea — compare with the explanation.",
      };
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
