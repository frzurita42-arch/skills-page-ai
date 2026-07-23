import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Zod schemas for LLM outputs (mirror contracts/types.ts)              */
/* ------------------------------------------------------------------ */

export const levelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const imageStyleSchema = z.enum(["sketch", "watercolor", "flat", "photo", "none"]);
export const templateSchema = z.enum(["course", "restaurant", "service", "shop", "other"]);

export const slideComponentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prose"), paragraphs: z.array(z.string().min(1)).min(1) }),
  z.object({
    type: z.literal("latex"),
    formula: z.string().min(1),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("chart"),
    chartType: z.enum(["bar", "line", "pie", "area"]),
    title: z.string(),
    labels: z.array(z.string()).min(2),
    series: z.array(z.object({ name: z.string(), data: z.array(z.number()) })).min(1),
    why: z.string().optional(),
  }),
  z.object({
    type: z.literal("svg"),
    title: z.string(),
    description: z.string(),
    sceneHint: z.string(),
  }),
  z.object({
    type: z.literal("table"),
    title: z.string().optional(),
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())).min(1),
  }),
  z.object({ type: z.literal("stickynote"), text: z.string().min(1) }),
  z.object({
    type: z.literal("image"),
    prompt: z.string().min(1),
    alt: z.string().min(1),
    style: imageStyleSchema,
  }),
  z.object({
    type: z.literal("code"),
    language: z.string(),
    code: z.string().min(1),
    caption: z.string().optional(),
  }),
]);

export const slideQuizSchema = z.object({
  question: z.string().min(1),
  options: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
});

export const slideSchema = z.object({
  title: z.string().min(1),
  components: z.array(slideComponentSchema).min(1),
  quiz: slideQuizSchema.optional(),
});

export const slideDeckSchema = z.object({
  slides: z.array(slideSchema).min(1),
  level: levelSchema,
  imageStyle: imageStyleSchema,
  topic: z.string().min(1),
});

export const lessonPathSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(1),
  toolName: z.string().min(3),
  toolTopic: z.string().min(1),
  toolInstructions: z.string().min(1),
  units: z
    .array(
      z.object({
        title: z.string().min(1),
        lessons: z
          .array(
            z.object({
              title: z.string().min(1),
              objective: z.string().min(10),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export const coachResponseSchema = z.object({
  reply: z.string().min(1),
  actions: z
    .array(
      z.object({
        kind: z.enum(["lesson-path", "slides", "repos"]),
        label: z.string().min(1),
        payload: z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            template: templateSchema.optional(),
            units: z.number().int().optional(),
            lessons: z.number().int().optional(),
            slug: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

export type LessonPathDraft = z.infer<typeof lessonPathSchema>;

/* ------------------------------------------------------------------ */
/* System prompts                                                       */
/* ------------------------------------------------------------------ */

export interface LayoutTemplateForPrompt {
  name: string;
  tags: string[];
  components: string[];
}

export function buildSlidesSystemPrompt(opts: {
  level: string;
  imageStyle: string;
  previouslyTaught: string | null;
  layoutTemplates?: LayoutTemplateForPrompt[];
}): string {
  const memory = opts.previouslyTaught
    ? `
PREVIOUSLY TAUGHT in this course — treat every item below as slides that already exist earlier in this same course. HARD anti-repetition rules:
(a) NEVER re-define, re-introduce, or re-explain anything listed below — not even "as a reminder". Reference it by name in at most ONE short clause ("using the hyphal growth from Lesson 2, ...").
(b) When a prior concept is needed, USE it — apply it, extend it, contrast it with the new material — exactly like a university course refers back to week 1 instead of re-teaching it.
(c) Every paragraph you write must teach material NOT covered below. If a slide would mostly restate prior material, replace it with the next new idea instead.
${opts.previouslyTaught}
`
    : "";

  const templates =
    opts.layoutTemplates && opts.layoutTemplates.length > 0
      ? `
SLIDE LAYOUT TEMPLATES — this is the ONLY set of slide configurations you may use. Build each slide as one of these layouts, following its component types IN ORDER and including ALL of its steps; pick the layout that best fits the concept and vary layouts across the deck. A layout with several "Text" steps means that many DISTINCT paragraphs (never repeat one). Any evaluation step ("Multiple choice", "2-option", "Fill blank", "Typed answer") is realized as this slide's quiz object — make the question style match (e.g. "2-option" → a question whose 4 options are two clear choices plus two distractors; "Fill blank" → a cloze sentence; "Typed answer" → a recall question) and keep exactly ONE objectively correct option. These layouts are already chosen for this deck's difficulty level, so honor the text density they imply.
${opts.layoutTemplates.map((t) => `- ${t.name}${t.tags.length ? ` [${t.tags.join(", ")}]` : ""}: ${t.components.join(" -> ")}`).join("\n")}
`
      : "";

  return `You are the SketchLearn teaching engine. You write evaluated slide decks that teach ONE topic deeply.

TEACHING RULES (non-negotiable):
1. NO greeting/welcome/outline slide — start teaching immediately on slide 1.
2. EVERY slide MUST be built from ONE of the SLIDE LAYOUT TEMPLATES listed below — use that template's exact component configuration (its component types, in the given order). Do NOT invent a slide shape that is not in the catalog, and do NOT drop any of a template's steps. Because every template pairs its visual/data steps with explanatory text, this means a slide is never just an image (or just a chart/table/diagram/formula/code) next to a question — the text step explains, in words, what the visual shows, what to notice in it, and what it means, and the quiz tests that explanation. Slides build introduce -> develop -> apply; never restate an earlier point; the deck reads as ONE continuous piece of teaching, with at most a one-clause stitch between slides.
3. Choose components deliberately per concept from this palette: prose, chart (bar/line/pie/area with real plausible data), latex, svg (a diagram description the app sketches), table (compact, few columns), stickynote (max ONE per deck, for a mnemonic or key warning), image (a vivid visual with an alt text and a generation prompt), code (short snippet).
4. SUBJECT GATING: latex and code ONLY for math/STEM/technical topics. Humanities, languages, business, food, history -> prose + images + tables + diagrams + sticky notes.
5. HARD max ONE latex formula per slide. When a formula or graph is present, order components: (1) the formula, (2) its graph/diagram, (3) a short "why it is here" text.
6. Per-slide MCQ: exactly 4 options, answerable ONLY from that slide's content plus everyday knowledge — one small step past the text (not a verbatim copy). Difficulty matched to level "${opts.level}". Quizzes appear on MOST slides, not necessarily every one. Quiz questions must be direct, closed-form multiple-choice questions with exactly ONE objectively correct option. NEVER phrase them as open-ended prompts such as "in your own words", "explain", "describe", or "what do you think" — the student picks an option, not writes prose.
7. Images use imageStyle "${opts.imageStyle}"${opts.imageStyle === "none" ? " — style is 'none', so DO NOT emit any image components" : ""}.
8. Level "${opts.level}": beginner = a clear, self-contained explanatory paragraph (2-4 plain sentences) that defines every term with concrete everyday examples — beginner means SIMPLE language, NOT less text, and never a bare sentence next to a picture; intermediate = 2-3 paragraphs that assume basics and connect ideas; advanced = 3-4 denser paragraphs with edge cases. Whatever the level, if the slide has a visual it also has the words that explain it.
${memory}${templates}
OUTPUT: STRICT JSON ONLY (no markdown fences, no commentary) matching exactly:
{"slides":[{"title":"...","components":[...],"quiz":{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."}}],"level":"${opts.level}","imageStyle":"${opts.imageStyle}","topic":"..."}`;
}

export function buildLessonPathPrompt(opts: {
  description: string;
  template: string;
  unitCount: number;
  lessonsPerUnit: number;
}): string {
  const guidance: Record<string, string> = {
    course:
      "A learning course: units are topic areas, lessons are teachable concepts. Each lesson objective is a TEACHING PROMPT (imperative, specific, mentions what the learner must be able to do at the end).",
    restaurant:
      "A restaurant menu presented as learning: units are menu categories (e.g. Breakfast, Lunch, Dinner), lessons are individual dishes. Each lesson objective is a STORY/EXPLORATION presentation prompt of that dish: its origins, ingredients, preparation, how it is served and enjoyed.",
    service:
      "A service catalog as training: units are service areas, lessons are individual jobs/services. Objectives teach what the service is, when it is needed, and how it is done.",
    shop: "A shop collection as product stories: units are categories, lessons are products. Objectives present each product's story, materials, use, and care.",
    other:
      "A structured collection: units group related lessons; each lesson objective is a presentation prompt.",
  };
  return `You are the SketchLearn lesson-path architect. Draft a complete repository structure.

SUBJECT: ${opts.description}
TEMPLATE: ${opts.template} — ${guidance[opts.template] ?? guidance.other}

RULES:
- Exactly ${opts.unitCount} units, each with exactly ${opts.lessonsPerUnit} lessons.
- Lesson order must build logically (lesson N assumes lessons 1..N-1).
- Objectives are 1-3 sentence prompts that will be fed directly to a slide-generation engine. Make them concrete and self-contained.
- toolName: a short friendly name for the slide tool that will present these lessons. toolTopic: the overall subject line. toolInstructions: 2-4 sentences of standing guidance for the slide tool (tone, audience, style).

OUTPUT: STRICT JSON ONLY (no markdown fences) matching exactly:
{"title":"...","description":"...","toolName":"...","toolTopic":"...","toolInstructions":"...","units":[{"title":"...","lessons":[{"title":"...","objective":"..."}]}]}`;
}

export const COACH_SYSTEM_PROMPT = `You are the SketchLearn Coach — a friendly pencil-mascot assistant inside a learning-studio app. You help people decide what to build: a Lesson Path (a repository of units -> lessons plus a linked slide tool, great for courses, restaurant menus, service catalogs, shop collections) or a single slide deck.

STYLE: warm, encouraging, concise (2-5 sentences), plain text. Never use markdown headers or tables.

BEHAVIOR:
- If the user describes something to teach/present, reply with a short plan and include a "lesson-path" action (with title, template one of course|restaurant|service|shop|other, rough units & lessons counts) and optionally a "slides" action for a single deck.
- If the user asks to browse/resume existing work, include a "repos" action.
- If the intent is unclear, ask ONE clarifying question, no actions.
- Restaurant/menu/cafe/dish words -> template restaurant. Repair/service/training/onboarding -> service. Shop/store/product/collection -> shop. Otherwise course.

OUTPUT: STRICT JSON ONLY: {"reply":"...","actions":[{"kind":"lesson-path|slides|repos","label":"short card label","payload":{"title":"...","template":"course","units":4,"lessons":12}}]}`;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** kebab-case slug, stable */
export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "untitled";
}

/** 5-char repo ref derived from slug (uppercase letters+digits), e.g. K7J2A */
export function repoRef(slug: string): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = 5381;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) + h + slug.charCodeAt(i)) >>> 0;
  }
  let out = "";
  let x = h;
  for (let i = 0; i < 5; i++) {
    out += alphabet[x % alphabet.length];
    x = Math.floor(x / alphabet.length) + h;
  }
  return out;
}

/**
 * Salvage an LLM deck draft before strict validation. Real model output is
 * imperfect in small ways — a quiz with 3 options, a chart with string data,
 * an image with a made-up style — and rejecting the WHOLE deck for one bad
 * piece wastes an otherwise good generation. Drop invalid components and
 * quizzes individually, drop slides left with no components, and fill the
 * top-level level/imageStyle/topic fields the caller already knows.
 */
export function repairDeckDraft(
  raw: unknown,
  defaults: { level: string; imageStyle: string; topic: string },
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const draft = raw as Record<string, unknown>;
  if (!levelSchema.safeParse(draft.level).success) draft.level = defaults.level;
  if (!imageStyleSchema.safeParse(draft.imageStyle).success) draft.imageStyle = defaults.imageStyle;
  if (typeof draft.topic !== "string" || !draft.topic.trim()) draft.topic = defaults.topic;

  if (Array.isArray(draft.slides)) {
    draft.slides = draft.slides
      .map((slide) => {
        if (!slide || typeof slide !== "object") return null;
        const s = slide as Record<string, unknown>;
        if (Array.isArray(s.components)) {
          const kept = s.components.filter((c) => {
            const comp = c as Record<string, unknown> | null;
            // images sometimes carry an invented style — snap it to the deck's
            if (
              comp &&
              comp.type === "image" &&
              !imageStyleSchema.safeParse(comp.style).success
            ) {
              comp.style = defaults.imageStyle;
            }
            // salvage prose whose paragraphs array has empty/blank entries
            // (dropping it whole is what left slides text-less before)
            if (comp && comp.type === "prose" && Array.isArray(comp.paragraphs)) {
              comp.paragraphs = comp.paragraphs.filter(
                (p) => typeof p === "string" && p.trim().length > 0,
              );
            }
            const ok = slideComponentSchema.safeParse(c).success;
            if (!ok) console.warn("[ai/repair] dropping invalid slide component:", comp?.type);
            return ok;
          });
          s.components = kept;
        }
        if (s.quiz !== undefined && !slideQuizSchema.safeParse(s.quiz).success) {
          console.warn("[ai/repair] dropping invalid quiz on slide:", s.title);
          delete s.quiz;
        }
        return s;
      })
      .filter(
        (s) =>
          s !== null && Array.isArray(s.components) && s.components.length > 0,
      );
  }
  return draft;
}

type LooseQuiz = {
  question?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
};
type LooseSlide = {
  title?: string;
  quiz?: LooseQuiz | null;
  components?: Array<{ type?: string; paragraphs?: unknown }>;
};

/** True when a slide carries at least one prose component with real text. */
export function slideHasProse(slide: LooseSlide): boolean {
  return (slide.components ?? []).some(
    (c) =>
      c?.type === "prose" &&
      Array.isArray(c.paragraphs) &&
      c.paragraphs.some((p) => typeof p === "string" && p.trim().length > 0),
  );
}

/** True when EVERY slide in a deck has explanatory prose. */
export function everySlideHasProse(deck: { slides?: LooseSlide[] }): boolean {
  const slides = deck?.slides;
  if (!Array.isArray(slides) || slides.length === 0) return false;
  return slides.every(slideHasProse);
}

const VISUAL_LABEL: Record<string, string> = {
  image: "the image",
  chart: "the chart",
  svg: "the diagram",
  table: "the table",
  latex: "the formula",
  code: "the code",
};

/** Build an on-topic paragraph for a text-less slide from its own quiz. The
 *  quiz's correct answer + explanation ARE real teaching content, so this
 *  yields prose related to the question instead of a generic placeholder. */
function proseFromQuiz(quiz: LooseQuiz | null | undefined): string | null {
  if (!quiz) return null;
  const correct =
    typeof quiz.correctIndex === "number" ? quiz.options?.[quiz.correctIndex] : undefined;
  const claim = correct?.trim().replace(/[.!?]+$/, "");
  const explanation = quiz.explanation?.trim();
  const parts = [claim ? `${claim}.` : null, explanation || null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Last-resort safety net: guarantee every slide has explanatory text. If the
 * model still returns a slide that is only a visual + question, prepend a
 * prose paragraph. Prefer text built from the slide's own quiz (its correct
 * answer + explanation), which is real, on-topic teaching content; only fall
 * back to a title/visual sentence when there is no quiz to draw from. The
 * prompt is expected to do this well; this just prevents a text-less or
 * off-topic slide from ever shipping.
 */
export function ensureExplanatoryProse<T extends { slides?: LooseSlide[] }>(deck: T): T {
  for (const slide of deck.slides ?? []) {
    if (slideHasProse(slide)) continue;
    if (!Array.isArray(slide.components)) slide.components = [];
    const fromQuiz = proseFromQuiz(slide.quiz);
    let paragraph: string;
    if (fromQuiz) {
      paragraph = fromQuiz;
    } else {
      const visual = slide.components.find((c) => c?.type && VISUAL_LABEL[c.type]);
      const title = (slide.title ?? "this idea").trim();
      paragraph = visual
        ? `Look closely at ${title}: ${VISUAL_LABEL[visual.type as string]} below illustrates it. Study what it shows and how the parts relate.`
        : `Let's work through ${title}.`;
    }
    console.warn("[ai/prose] slide had no explanatory text — injecting a fallback paragraph:", slide.title);
    slide.components.unshift({ type: "prose", paragraphs: [paragraph] });
  }
  return deck;
}

/** Extract the first JSON object from an LLM response (tolerates fences/prose). */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return candidate.slice(start, end + 1);
}
