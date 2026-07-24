import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Zod schemas for LLM outputs (mirror contracts/types.ts)              */
/* ------------------------------------------------------------------ */

export const levelSchema = z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
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

export const quizKindSchema = z.enum(["mcq", "mcq2", "fillblank", "typed"]);

/**
 * A slide's evaluation. Backward compatible: a quiz with no `kind` and 4
 * options parses as a 4-option MCQ. mcq2 = 2 options; fillblank/typed carry an
 * `answer` (accepted / reference) and no options.
 */
export const slideQuizSchema = z
  .object({
    kind: quizKindSchema.default("mcq"),
    question: z.string().min(1),
    options: z.array(z.string().min(1)).optional(),
    correctIndex: z.number().int().min(0).optional(),
    answer: z.string().min(1).optional(),
    acceptableAnswers: z.array(z.string().min(1)).optional(),
    explanation: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    const addErr = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (q.kind === "mcq" || q.kind === "mcq2") {
      const need = q.kind === "mcq" ? 4 : 2;
      if (!q.options || q.options.length !== need) addErr(`${q.kind} needs exactly ${need} options`);
      if (
        typeof q.correctIndex !== "number" ||
        q.correctIndex < 0 ||
        q.correctIndex >= (q.options?.length ?? 0)
      ) {
        addErr(`${q.kind} needs a valid correctIndex`);
      }
    } else {
      // fillblank / typed
      if (!q.answer || !q.answer.trim()) addErr(`${q.kind} needs an "answer"`);
    }
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
SLIDE LAYOUT TEMPLATES — this is the ONLY set of slide configurations you may use. Build each slide as one of these layouts, following its component types IN ORDER and including ALL of its steps; pick the layout that best fits the concept and vary layouts across the deck. A layout with several "Text" steps means that many DISTINCT paragraphs (never repeat one). The evaluation step names map to the quiz "kind" (see rule 6): "Multiple choice"→mcq, "2-option"→mcq2, "Fill blank"→fillblank, "Typed answer"→typed. Emit the quiz with EXACTLY that kind and its required fields — do not substitute one kind for another. These layouts are already chosen for this deck's difficulty level, so honor the text density they imply.
${opts.layoutTemplates.map((t) => `- ${t.name}${t.tags.length ? ` [${t.tags.join(", ")}]` : ""}: ${t.components.join(" -> ")}`).join("\n")}
When a layout calls for a Table, emit a valid table component with real rows, e.g. {"type":"table","columns":["Rule","Example"],"rows":[["Add -ed for past tense","walk -> walked"],["Double the consonant","stop -> stopped"]]}. When it calls for a Graph, emit a chart component, e.g. {"type":"chart","chartType":"bar","title":"...","labels":["A","B","C"],"series":[{"name":"...","data":[3,5,2]}]}. A malformed table/chart is dropped, which breaks the layout — always give columns+rows / labels+series.
`
      : "";

  return `You are the SketchLearn teaching engine. You write evaluated slide decks that teach ONE topic deeply.

TEACHING RULES (non-negotiable):
1. NO greeting/welcome/outline slide — start teaching immediately on slide 1.
2. EVERY slide MUST be built from ONE of the SLIDE LAYOUT TEMPLATES listed below — use that template's exact component configuration (its component types, in the given order). Do NOT invent a slide shape that is not in the catalog, and do NOT drop any of a template's steps. Because every template pairs its visual/data steps with explanatory text, this means a slide is never just an image (or just a chart/table/diagram/formula/code) next to a question — the text step explains, in words, what the visual shows, what to notice in it, and what it means, and the quiz tests that explanation. Slides build introduce -> develop -> apply; never restate an earlier point; the deck reads as ONE continuous piece of teaching, with at most a one-clause stitch between slides.
3. Choose components deliberately per concept from this palette: prose, chart (bar/line/pie/area with real plausible data), latex, svg (a diagram description the app sketches), table (compact, few columns), stickynote (max ONE per deck, for a mnemonic or key warning), image (a vivid visual with an alt text and a generation prompt), code (short snippet).
4. SUBJECT GATING: latex and code ONLY for math/STEM/technical topics. Humanities, languages, business, food, history -> prose + images + tables + diagrams + sticky notes.
5. HARD max ONE latex formula per slide. When a formula or graph is present, order components: (1) the formula, (2) its graph/diagram, (3) a short "why it is here" text.
6. EVALUATION ("quiz"): each slide's evaluation MUST match the evaluation step its layout template lists, using the "kind" field — answerable ONLY from that slide's content plus everyday knowledge, difficulty matched to level "${opts.level}":
   - "Multiple choice" -> {"kind":"mcq","question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."} — EXACTLY 4 options, ONE objectively correct.
   - "2-option" -> {"kind":"mcq2","question":"...","options":["a","b"],"correctIndex":0,"explanation":"..."} — EXACTLY 2 options (e.g. true/false, this/that).
   - "Fill blank" -> {"kind":"fillblank","question":"The past tense of run is ___.","answer":"ran","acceptableAnswers":["ran"],"explanation":"..."} — put a ___ blank in the question; "answer" is the exact missing word/phrase; add other correct spellings/forms to acceptableAnswers.
   - "Typed answer" -> {"kind":"typed","question":"In one sentence, why ...?","answer":"a concise correct reference answer","explanation":"..."} — an open recall/short-answer question the student types; "answer" is the model answer used to grade them.
   Choose the kind from the template's step; do NOT substitute a multiple-choice for a fill-blank/typed step. NEVER phrase mcq/mcq2 as "explain"/"in your own words"; those belong to the typed kind.
7. Images use imageStyle "${opts.imageStyle}"${opts.imageStyle === "none" ? " — style is 'none', so DO NOT emit any image components" : ""}.
8. CEFR LEVEL "${opts.level}" — calibrate reading difficulty precisely to this level (this controls VOCABULARY and SENTENCE COMPLEXITY, not how much you teach; every slide still fully explains its visual):
   - A0 (pre-beginner): 1-2 very short sentences, ~present tense, only the ~300 most common words, define/illustrate each key word; lean on images.
   - A1 (beginner): short simple sentences, common everyday vocabulary, one idea per sentence, define every term with a concrete example.
   - A2 (elementary): simple connected sentences, familiar topics, basic connectors (because, so, then).
   - B1 (intermediate): clear standard language, some subordinate clauses, explain any less-common term.
   - B2 (upper-intermediate): detailed paragraphs, some abstraction and comparison, precise terminology introduced with brief gloss.
   - C1 (advanced): complex, nuanced prose, dense information, edge cases, field-specific terms assumed.
   - C2 (mastery): near-native academic register, sophisticated argument, subtlety and exceptions, no hand-holding.
   Match sentence length and word choice to the level: a low level means SIMPLER language, not shallower coverage; a high level means denser, more sophisticated language.
   LENGTH scales with level too: higher levels get LONGER text in general — A0/A1 prose paragraphs are 1-2 short sentences; A2/B1 are ~2-4 sentences; B2 are full multi-sentence paragraphs; C1/C2 prose paragraphs are substantial and challenging (roughly 4-7 dense sentences each), giving the advanced reader more to work through. This is a general rule, not absolute: a genuinely simple point may still be stated briefly at any level — don't pad — but by default a higher-level reader should get more, lengthier, more demanding text.
${memory}${templates}
OUTPUT: STRICT JSON ONLY (no markdown fences, no commentary) matching exactly:
{"slides":[{"title":"...","components":[...],"quiz":{"kind":"mcq","question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."}}],"level":"${opts.level}","imageStyle":"${opts.imageStyle}","topic":"..."}
(set "quiz.kind" to the evaluation the slide's layout calls for: mcq, mcq2, fillblank, or typed, with the fields shown in rule 6.)`;
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
        // If a slide lost ALL its components (e.g. the model emitted only
        // eval-type components, which aren't renderable), salvage it with a
        // text paragraph instead of dropping it — dropping shrinks the deck
        // below the requested slide count.
        if (Array.isArray(s.components) && s.components.length === 0 && (s.title || s.quiz)) {
          s.components = [{ type: "prose", paragraphs: [slideFallbackParagraph(s as LooseSlide)] }];
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
/** A single explanatory paragraph for a slide that has none — drawn from its
 *  quiz (real, on-topic) when possible, else its title/visual. Shared by the
 *  repair salvage (so a slide is never dropped for shrinking the deck) and the
 *  final ensureExplanatoryProse net. */
export function slideFallbackParagraph(slide: LooseSlide): string {
  const fromQuiz = proseFromQuiz(slide.quiz);
  if (fromQuiz) return fromQuiz;
  const visual = (slide.components ?? []).find((c) => c?.type && VISUAL_LABEL[c.type]);
  const title = (slide.title ?? "this idea").trim();
  return visual
    ? `Look closely at ${title}: ${VISUAL_LABEL[visual.type as string]} below illustrates it. Study what it shows and how the parts relate.`
    : `Let's work through ${title}.`;
}

export function ensureExplanatoryProse<T extends { slides?: LooseSlide[] }>(deck: T): T {
  for (const slide of deck.slides ?? []) {
    if (slideHasProse(slide)) continue;
    if (!Array.isArray(slide.components)) slide.components = [];
    console.warn("[ai/prose] slide had no explanatory text — injecting a fallback paragraph:", slide.title);
    slide.components.unshift({ type: "prose", paragraphs: [slideFallbackParagraph(slide)] });
  }
  return deck;
}

type ShuffleQuiz = { options?: unknown; correctIndex?: unknown };
type ShuffleSlide = { quiz?: ShuffleQuiz | null };

/**
 * Randomize the position of each quiz's correct answer. Models overwhelmingly
 * place the correct option first (correctIndex 0), so without this every
 * question in a deck has answer "A". Fisher-Yates shuffle the options and
 * re-point correctIndex at the correct option's new slot. RNG is injectable
 * for deterministic tests.
 */
export function shuffleQuizAnswers<T extends { slides?: ShuffleSlide[] }>(
  deck: T,
  rng: () => number = Math.random,
): T {
  for (const slide of deck.slides ?? []) {
    const quiz = slide.quiz;
    if (
      !quiz ||
      !Array.isArray(quiz.options) ||
      quiz.options.length < 2 ||
      typeof quiz.correctIndex !== "number" ||
      quiz.correctIndex < 0 ||
      quiz.correctIndex >= quiz.options.length
    ) {
      continue;
    }
    const original = quiz.options.slice();
    const origIndex = quiz.correctIndex;
    // Shuffle an array of INDICES (duplicate-text safe), then rebuild options
    // in the new order and re-point correctIndex at the correct slot.
    const order = original.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    quiz.options = order.map((i) => original[i]);
    quiz.correctIndex = order.indexOf(origIndex);
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
