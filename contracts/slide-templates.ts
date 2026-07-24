/* ------------------------------------------------------------------ */
/* Slide layout templates.                                              */
/* A template is an ordered recipe of slide components ("Text → Table   */
/* → Multiple choice") tagged by subject AND difficulty level. The      */
/* catalog is shown in the Templates page and injected into the         */
/* slide-generation prompt so the AI composes slides from approved      */
/* layouts appropriate to the topic and level. Built-ins live here in   */
/* code (shared by UI + API); user-added templates live in the          */
/* slideTemplates table.                                                */
/* ------------------------------------------------------------------ */

import { LEVELS, levelTier, type Level } from "./types";

/**
 * The component vocabulary a template step may use. The first eight map 1:1
 * onto the player's renderable slide components. The last four are GRADABLE
 * evaluation steps — every template must end with at least one of them so a
 * slide can always be scored:
 *   quiz        — 4-option multiple choice
 *   mcq2        — 2-option multiple choice (this/that, true/false)
 *   fillblank   — fill in the blank(s)
 *   shortanswer — typed free answer, checked by AI
 */
export const TEMPLATE_COMPONENT_TYPES = [
  "prose",
  "latex",
  "chart",
  "svg",
  "table",
  "stickynote",
  "image",
  "code",
  "quiz",
  "mcq2",
  "fillblank",
  "shortanswer",
] as const;

export type TemplateComponentType = (typeof TEMPLATE_COMPONENT_TYPES)[number];

export const GRADABLE_TYPES: TemplateComponentType[] = [
  "quiz",
  "mcq2",
  "fillblank",
  "shortanswer",
];

export function isGradable(t: TemplateComponentType): boolean {
  return GRADABLE_TYPES.includes(t);
}

/** Human labels for the template-bar chips. */
export const TEMPLATE_COMPONENT_LABELS: Record<TemplateComponentType, string> = {
  prose: "Text",
  latex: "Formula",
  chart: "Graph",
  svg: "Diagram",
  table: "Table",
  stickynote: "Sticky note",
  image: "Image",
  code: "Code",
  quiz: "Multiple choice",
  mcq2: "2-option",
  fillblank: "Fill blank",
  shortanswer: "Typed answer",
};

/** Compact labels for tight spaces (e.g. a <select> option, where text can't
 *  be styled smaller) — used to spell out a template's content sequence. */
export const TEMPLATE_COMPONENT_SHORT: Record<TemplateComponentType, string> = {
  prose: "Text",
  latex: "Formula",
  chart: "Graph",
  svg: "Diagram",
  table: "Table",
  stickynote: "Note",
  image: "Image",
  code: "Code",
  quiz: "MCQ",
  mcq2: "2-opt",
  fillblank: "Fill-in",
  shortanswer: "Typed",
};

/** A one-line "Text · Table · Text · Typed" summary of a template's content
 *  distribution, in order — for showing the shape next to its name. */
export function templateSequenceLabel(
  components: TemplateComponentType[],
  sep = " · ",
): string {
  return components.map((c) => TEMPLATE_COMPONENT_SHORT[c] ?? c).join(sep);
}

// Template levels are the same CEFR scale as decks (A0-C2).
export type TemplateLevel = Level;
export const TEMPLATE_LEVELS: TemplateLevel[] = LEVELS;

export type TemplateSection = "stem" | "humanities" | "general";

export interface SlideTemplate {
  /** builtin templates use string ids ("bi-…"); custom rows use DB numeric ids */
  id: string | number;
  name: string;
  level: TemplateLevel;
  components: TemplateComponentType[];
  /** lowercase hashtags, e.g. ["math", "statistics"] */
  tags: string[];
  builtin: boolean;
  createdByName?: string | null;
  createdById?: number | null;
}

/** Tags treated as STEM when filtering the catalog for a topic. */
export const STEM_TAGS = [
  "math",
  "algebra",
  "calculus",
  "geometry",
  "physics",
  "chemistry",
  "biology",
  "science",
  "statistics",
  "data",
  "economics",
  "programming",
  "cs",
  "engineering",
  "stem",
];

/** Tags treated as humanities/reading-heavy. */
export const HUMANITIES_TAGS = [
  "humanities",
  "history",
  "literature",
  "language",
  "esl",
  "reading",
  "arts",
  "writing",
  "philosophy",
  "civics",
];

export function sectionForTags(tags: string[]): TemplateSection {
  if (tags.length === 0) return "general";
  if (tags.some((t) => STEM_TAGS.includes(t))) return "stem";
  if (tags.some((t) => HUMANITIES_TAGS.includes(t))) return "humanities";
  return "general";
}

/* ------------------------------------------------------------------ */
/* Built-in catalog                                                     */
/* Density by level: beginner = 1 short text; intermediate = 2-3 texts; */
/* advanced = 3-4 texts + a visual aid. Every entry ends gradable, and  */
/* the evaluation type is varied across the set.                        */
/* ------------------------------------------------------------------ */

function bi(
  name: string,
  level: TemplateLevel,
  components: TemplateComponentType[],
  tags: string[],
): SlideTemplate {
  const id = "bi-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return { id, name, level, components, tags, builtin: true };
}

/* ---------------- STEM: 10 per level ---------------- */
const STEM_TEMPLATES: SlideTemplate[] = [
  // beginner (1 text, light evaluation)
  bi("Concept in a line", "A1", ["prose", "mcq2"], ["math", "science"]),
  bi("One formula", "A1", ["prose", "latex", "mcq2"], ["math", "physics"]),
  bi("Spot it on the graph", "A1", ["prose", "chart", "quiz"], ["math", "statistics"]),
  bi("Label the diagram", "A1", ["prose", "svg", "quiz"], ["science", "biology"]),
  bi("Read the table", "A1", ["prose", "table", "mcq2"], ["stem", "data"]),
  bi("Picture the idea", "A1", ["image", "prose", "quiz"], ["science"]),
  bi("First code line", "A1", ["prose", "code", "mcq2"], ["programming", "cs"]),
  bi("Fill the value", "A1", ["prose", "latex", "fillblank"], ["math", "algebra"]),
  bi("True or false science", "A1", ["prose", "mcq2"], ["science"]),
  bi("One-step problem", "A1", ["prose", "latex", "quiz"], ["math"]),

  // intermediate (2-3 texts, mixed evaluation)
  bi("Explain then apply", "B1", ["prose", "prose", "latex", "quiz"], ["math", "physics"]),
  bi("Worked example", "B1", ["prose", "latex", "prose", "fillblank"], ["math", "physics"]),
  bi("Graph analysis", "B1", ["prose", "chart", "prose", "quiz"], ["statistics", "economics"]),
  bi("Diagram deep dive", "B1", ["prose", "svg", "prose", "shortanswer"], ["biology", "engineering"]),
  bi("Data reasoning", "B1", ["prose", "table", "prose", "quiz"], ["data", "science"]),
  bi("Debug the code", "B1", ["prose", "code", "prose", "quiz"], ["programming", "cs"]),
  bi("Two-step problem", "B1", ["prose", "latex", "prose", "fillblank"], ["math"]),
  bi("Compare methods", "B1", ["prose", "table", "prose", "shortanswer"], ["stem"]),
  bi("Formula + graph", "B1", ["prose", "latex", "chart", "quiz"], ["physics", "math"]),
  bi("Cause and effect", "B1", ["prose", "prose", "svg", "quiz"], ["science", "chemistry"]),

  // advanced (3-4 texts + visual, analytical evaluation)
  bi("Derivation walk-through", "C1", ["prose", "latex", "prose", "prose", "shortanswer"], ["math", "physics"]),
  bi("Model & interpret", "C1", ["prose", "chart", "prose", "prose", "shortanswer"], ["statistics", "data"]),
  bi("Full worked solution", "C1", ["prose", "prose", "latex", "chart", "fillblank"], ["math", "physics"]),
  bi("System analysis", "C1", ["prose", "svg", "prose", "prose", "shortanswer"], ["engineering", "science"]),
  bi("Data-driven argument", "C1", ["prose", "table", "prose", "prose", "shortanswer"], ["economics", "data"]),
  bi("Algorithm reasoning", "C1", ["prose", "code", "prose", "prose", "quiz"], ["programming", "cs"]),
  bi("Multi-step proof", "C1", ["prose", "latex", "prose", "latex", "shortanswer"], ["math"]),
  bi("Contrast two models", "C1", ["prose", "prose", "table", "prose", "shortanswer"], ["stem", "science"]),
  bi("Edge cases", "C1", ["prose", "prose", "prose", "code", "quiz"], ["cs", "programming"]),
  bi("Quantitative deep dive", "C1", ["prose", "latex", "chart", "prose", "fillblank"], ["physics", "math"]),
];

/* ---------------- Humanities: 10 per level ---------------- */
const HUMANITIES_TEMPLATES: SlideTemplate[] = [
  // beginner
  bi("Short read", "A1", ["prose", "mcq2"], ["humanities", "reading"]),
  bi("Story moment", "A1", ["prose", "image", "quiz"], ["history", "literature"]),
  bi("New word", "A1", ["image", "prose", "fillblank"], ["esl", "language"]),
  bi("Who / what / when", "A1", ["prose", "quiz"], ["history"]),
  bi("Simple compare", "A1", ["prose", "table", "mcq2"], ["humanities"]),
  bi("Picture a scene", "A1", ["image", "prose", "mcq2"], ["arts", "history"]),
  bi("Read and answer", "A1", ["prose", "shortanswer"], ["reading", "esl"]),
  bi("Key term", "A1", ["prose", "stickynote", "quiz"], ["humanities"]),
  bi("True or false history", "A1", ["prose", "mcq2"], ["history", "civics"]),
  bi("Fill the sentence", "A1", ["prose", "fillblank"], ["language", "esl"]),
  // grammar rules | examples table with varied evaluation kinds
  bi("Grammar table", "A1", ["prose", "table", "fillblank"], ["language", "esl", "grammar"]),
  bi("Grammar this or that", "A1", ["prose", "table", "mcq2"], ["language", "esl", "grammar"]),
  bi("Grammar quick pick", "A1", ["prose", "table", "quiz"], ["language", "esl", "grammar"]),
  // humanities graphs (timelines / trends)
  bi("Read the timeline", "A1", ["prose", "chart", "mcq2"], ["history", "humanities"]),

  // intermediate (2-3 texts)
  bi("Close reading", "B1", ["prose", "prose", "quiz"], ["humanities", "literature"]),
  bi("Narrative + image", "B1", ["prose", "image", "prose", "quiz"], ["history", "arts"]),
  bi("Compare & contrast", "B1", ["prose", "table", "prose", "shortanswer"], ["humanities", "language"]),
  bi("Cause in history", "B1", ["prose", "prose", "shortanswer"], ["history", "civics"]),
  bi("Read a passage", "B1", ["prose", "prose", "fillblank"], ["reading", "esl"]),
  bi("Interpret a source", "B1", ["prose", "image", "prose", "shortanswer"], ["history"]),
  bi("Theme & evidence", "B1", ["prose", "prose", "quiz"], ["literature"]),
  bi("Dialogue practice", "B1", ["prose", "prose", "fillblank"], ["language", "esl"]),
  bi("Two viewpoints", "B1", ["prose", "table", "prose", "shortanswer"], ["philosophy", "civics"]),
  bi("Timeline reasoning", "B1", ["prose", "prose", "quiz"], ["history"]),
  // grammar rules | examples table, explained, then checked (varied evals)
  bi("Grammar in context", "B1", ["prose", "table", "prose", "quiz"], ["language", "esl", "grammar"]),
  bi("Grammar cloze", "B1", ["prose", "table", "prose", "fillblank"], ["language", "esl", "grammar"]),
  // humanities graph read + interpret
  bi("Historical trends", "B1", ["prose", "chart", "prose", "quiz"], ["history", "humanities"]),

  // advanced (3-4 dense texts + aid)
  bi("Scholar reading", "C1", ["prose", "prose", "prose", "shortanswer"], ["humanities", "reading"]),
  bi("Critical analysis", "C1", ["prose", "prose", "prose", "prose", "shortanswer"], ["literature", "philosophy"]),
  bi("Source critique", "C1", ["prose", "image", "prose", "prose", "shortanswer"], ["history"]),
  bi("Argue a thesis", "C1", ["prose", "prose", "prose", "shortanswer"], ["writing", "humanities"]),
  bi("Compare traditions", "C1", ["prose", "table", "prose", "prose", "shortanswer"], ["humanities", "arts"]),
  bi("Dense passage study", "C1", ["prose", "prose", "prose", "fillblank"], ["reading", "literature"]),
  bi("Historiography", "C1", ["prose", "prose", "table", "prose", "shortanswer"], ["history"]),
  bi("Rhetoric breakdown", "C1", ["prose", "prose", "prose", "quiz"], ["writing", "language"]),
  bi("Ethics debate", "C1", ["prose", "prose", "prose", "shortanswer"], ["philosophy", "civics"]),
  bi("Advanced ESL reading", "C1", ["prose", "prose", "prose", "fillblank"], ["esl", "language"]),
  // dense grammar rules | examples table with typed answer / judgement
  bi("Grammar deep dive", "C1", ["prose", "table", "prose", "shortanswer"], ["language", "writing", "grammar"]),
  bi("Grammar judgement", "C1", ["prose", "prose", "table", "mcq2"], ["language", "writing", "grammar"]),
  // humanities data argument from a graph
  bi("Data in history", "C1", ["prose", "chart", "prose", "prose", "shortanswer"], ["history", "humanities"]),
];

/* ---------------- General: 10 (untagged, level-spread) ---------------- */
const GENERAL_TEMPLATES: SlideTemplate[] = [
  bi("Key takeaway", "A1", ["prose", "stickynote", "mcq2"], []),
  bi("Picture first", "A1", ["image", "prose", "quiz"], []),
  bi("Quick check", "A1", ["prose", "fillblank"], []),
  bi("Explain & apply", "B1", ["prose", "prose", "quiz"], []),
  bi("Show and compare", "B1", ["prose", "table", "prose", "shortanswer"], []),
  bi("Illustrated idea", "B1", ["prose", "image", "prose", "quiz"], []),
  bi("Reflect in writing", "B1", ["prose", "prose", "shortanswer"], []),
  bi("Deep explainer", "C1", ["prose", "prose", "prose", "shortanswer"], []),
  bi("Case study", "C1", ["prose", "prose", "table", "prose", "shortanswer"], []),
  bi("Synthesis", "C1", ["prose", "prose", "prose", "quiz"], []),
  // Tables & graphs available to EVERY subject (STEM + humanities + general),
  // so the STEM table/graph shapes are reusable anywhere.
  bi("Table at a glance", "A1", ["prose", "table", "mcq2"], []),
  bi("Read the chart", "A1", ["prose", "chart", "quiz"], []),
  bi("Interpret the graph", "B1", ["prose", "chart", "prose", "quiz"], []),
  bi("Graph analysis (general)", "C1", ["prose", "chart", "prose", "shortanswer"], []),
];

export const BUILTIN_SLIDE_TEMPLATES: SlideTemplate[] = [
  ...STEM_TEMPLATES,
  ...HUMANITIES_TEMPLATES,
  ...GENERAL_TEMPLATES,
];

/**
 * Filter the catalog for a topic classification: STEM topics drop
 * humanities-only templates and vice versa; untagged (general) templates
 * always apply.
 */
export function templatesForSubject(all: SlideTemplate[], stem: boolean): SlideTemplate[] {
  return all.filter((t) => {
    const section = sectionForTags(t.tags);
    if (section === "general") return true;
    return section === (stem ? "stem" : "humanities");
  });
}

/**
 * The layouts offered to the generator for one lesson: matching subject
 * area AND difficulty level (falls back to all levels if a level has none).
 */
export function templatesForSubjectAndLevel(
  all: SlideTemplate[],
  stem: boolean,
  level: TemplateLevel,
): SlideTemplate[] {
  const bySubject = templatesForSubject(all, stem);
  // Match by TIER (A0-A2 light, B1-B2 mid, C1-C2 dense) so the whole catalog
  // stays usable across the CEFR scale; an exact-level match is also included.
  const tier = levelTier(level);
  const byTier = bySubject.filter((t) => t.level === level || levelTier(t.level) === tier);
  return byTier.length > 0 ? byTier : bySubject;
}

/* ------------------------------------------------------------------ */
/* Conformance — does a generated slide follow an approved template?    */
/* A rendered slide's components use the CONTENT vocabulary (prose,      */
/* latex, chart, svg, table, stickynote, image, code); its evaluation    */
/* lives in a separate quiz field. A slide CONFORMS to a template when   */
/* it contains every CONTENT step of that template (a multiset subset,   */
/* extras allowed) and has a quiz iff the template has a gradable step.  */
/* Because every template includes a prose step, conforming to any       */
/* template guarantees the slide has explanatory text.                   */
/* ------------------------------------------------------------------ */

/** A generated slide reduced to what conformance needs. */
export interface SlideShape {
  componentTypes: string[];
  hasQuiz: boolean;
}

export function slideConformsToTemplate(
  shape: SlideShape,
  t: SlideTemplate,
  strictProse = false,
): boolean {
  const needsContent = t.components.filter((c) => !isGradable(c));
  const needsQuiz = t.components.some((c) => isGradable(c));
  // Every NON-prose structural component the template calls for (table, chart,
  // image, code, latex, svg, stickynote) must be present in the slide, by
  // count. Prose count is SOFT by default (a "prose, prose" template expresses
  // density and models emit one prose with several paragraphs) — only require
  // ≥1. When strictProse is set (used for USER-PINNED slides), require the
  // exact prose count too, so a pinned "text → table → text" yields both texts.
  const have = [...shape.componentTypes];
  for (const step of needsContent) {
    if (step === "prose") continue;
    const idx = have.indexOf(step);
    if (idx === -1) return false;
    have.splice(idx, 1);
  }
  const proseNeeded = needsContent.filter((c) => c === "prose").length;
  const proseHave = shape.componentTypes.filter((c) => c === "prose").length;
  if (strictProse ? proseHave < proseNeeded : proseNeeded > 0 && proseHave < 1) return false;
  if (needsQuiz && !shape.hasQuiz) return false;
  return true;
}

export function slideConformsToAny(shape: SlideShape, templates: SlideTemplate[]): boolean {
  return templates.some((t) => slideConformsToTemplate(shape, t));
}

/** The template that best reflects a non-pinned slide's actual shape — used to
 *  LABEL which layout it ended up matching. Prefers templates whose visual
 *  components (table/chart/image/code/formula/diagram) match the slide's, so a
 *  slide that contains a table is labelled with a TABLE layout, not a
 *  same-length all-text one. Ties break toward more components. */
export function bestMatchingTemplate(
  shape: SlideShape,
  templates: SlideTemplate[],
): SlideTemplate | null {
  const matches = templates.filter((t) => slideConformsToTemplate(shape, t));
  if (matches.length === 0) return null;
  const slideVisuals = new Set(shape.componentTypes.filter((c) => c !== "prose"));
  const slideProse = shape.componentTypes.filter((c) => c === "prose").length;
  const score = (t: SlideTemplate): number => {
    const tv = new Set<string>(t.components.filter((c) => !isGradable(c) && c !== "prose"));
    let inter = 0;
    let extra = 0;
    tv.forEach((v) => (slideVisuals.has(v) ? inter++ : extra++));
    let missing = 0;
    slideVisuals.forEach((v) => {
      if (!tv.has(v)) missing++;
    });
    // Reward shared visuals, penalize visuals only one side has, and keep the
    // labelled template's TEXT density close to the slide's real one — so a
    // one-paragraph slide is not labelled a four-"Text" layout. Size breaks
    // remaining ties.
    const tProse = t.components.filter((c) => c === "prose").length;
    const proseGap = Math.abs(tProse - slideProse);
    return inter * 100 - extra * 10 - missing * 10 - proseGap * 12 + t.components.length;
  };
  return matches.reduce((a, b) => (score(b) > score(a) ? b : a));
}
