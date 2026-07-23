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

export type TemplateLevel = "beginner" | "intermediate" | "advanced";
export const TEMPLATE_LEVELS: TemplateLevel[] = ["beginner", "intermediate", "advanced"];

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
  bi("Concept in a line", "beginner", ["prose", "mcq2"], ["math", "science"]),
  bi("One formula", "beginner", ["prose", "latex", "mcq2"], ["math", "physics"]),
  bi("Spot it on the graph", "beginner", ["prose", "chart", "quiz"], ["math", "statistics"]),
  bi("Label the diagram", "beginner", ["prose", "svg", "quiz"], ["science", "biology"]),
  bi("Read the table", "beginner", ["prose", "table", "mcq2"], ["stem", "data"]),
  bi("Picture the idea", "beginner", ["image", "prose", "quiz"], ["science"]),
  bi("First code line", "beginner", ["prose", "code", "mcq2"], ["programming", "cs"]),
  bi("Fill the value", "beginner", ["prose", "latex", "fillblank"], ["math", "algebra"]),
  bi("True or false science", "beginner", ["prose", "mcq2"], ["science"]),
  bi("One-step problem", "beginner", ["prose", "latex", "quiz"], ["math"]),

  // intermediate (2-3 texts, mixed evaluation)
  bi("Explain then apply", "intermediate", ["prose", "prose", "latex", "quiz"], ["math", "physics"]),
  bi("Worked example", "intermediate", ["prose", "latex", "prose", "fillblank"], ["math", "physics"]),
  bi("Graph analysis", "intermediate", ["prose", "chart", "prose", "quiz"], ["statistics", "economics"]),
  bi("Diagram deep dive", "intermediate", ["prose", "svg", "prose", "shortanswer"], ["biology", "engineering"]),
  bi("Data reasoning", "intermediate", ["prose", "table", "prose", "quiz"], ["data", "science"]),
  bi("Debug the code", "intermediate", ["prose", "code", "prose", "quiz"], ["programming", "cs"]),
  bi("Two-step problem", "intermediate", ["prose", "latex", "prose", "fillblank"], ["math"]),
  bi("Compare methods", "intermediate", ["prose", "table", "prose", "shortanswer"], ["stem"]),
  bi("Formula + graph", "intermediate", ["prose", "latex", "chart", "quiz"], ["physics", "math"]),
  bi("Cause and effect", "intermediate", ["prose", "prose", "svg", "quiz"], ["science", "chemistry"]),

  // advanced (3-4 texts + visual, analytical evaluation)
  bi("Derivation walk-through", "advanced", ["prose", "latex", "prose", "prose", "shortanswer"], ["math", "physics"]),
  bi("Model & interpret", "advanced", ["prose", "chart", "prose", "prose", "shortanswer"], ["statistics", "data"]),
  bi("Full worked solution", "advanced", ["prose", "prose", "latex", "chart", "fillblank"], ["math", "physics"]),
  bi("System analysis", "advanced", ["prose", "svg", "prose", "prose", "shortanswer"], ["engineering", "science"]),
  bi("Data-driven argument", "advanced", ["prose", "table", "prose", "prose", "shortanswer"], ["economics", "data"]),
  bi("Algorithm reasoning", "advanced", ["prose", "code", "prose", "prose", "quiz"], ["programming", "cs"]),
  bi("Multi-step proof", "advanced", ["prose", "latex", "prose", "latex", "shortanswer"], ["math"]),
  bi("Contrast two models", "advanced", ["prose", "prose", "table", "prose", "shortanswer"], ["stem", "science"]),
  bi("Edge cases", "advanced", ["prose", "prose", "prose", "code", "quiz"], ["cs", "programming"]),
  bi("Quantitative deep dive", "advanced", ["prose", "latex", "chart", "prose", "fillblank"], ["physics", "math"]),
];

/* ---------------- Humanities: 10 per level ---------------- */
const HUMANITIES_TEMPLATES: SlideTemplate[] = [
  // beginner
  bi("Short read", "beginner", ["prose", "mcq2"], ["humanities", "reading"]),
  bi("Story moment", "beginner", ["prose", "image", "quiz"], ["history", "literature"]),
  bi("New word", "beginner", ["image", "prose", "fillblank"], ["esl", "language"]),
  bi("Who / what / when", "beginner", ["prose", "quiz"], ["history"]),
  bi("Simple compare", "beginner", ["prose", "table", "mcq2"], ["humanities"]),
  bi("Picture a scene", "beginner", ["image", "prose", "mcq2"], ["arts", "history"]),
  bi("Read and answer", "beginner", ["prose", "shortanswer"], ["reading", "esl"]),
  bi("Key term", "beginner", ["prose", "stickynote", "quiz"], ["humanities"]),
  bi("True or false history", "beginner", ["prose", "mcq2"], ["history", "civics"]),
  bi("Fill the sentence", "beginner", ["prose", "fillblank"], ["language", "esl"]),

  // intermediate (2-3 texts)
  bi("Close reading", "intermediate", ["prose", "prose", "quiz"], ["humanities", "literature"]),
  bi("Narrative + image", "intermediate", ["prose", "image", "prose", "quiz"], ["history", "arts"]),
  bi("Compare & contrast", "intermediate", ["prose", "table", "prose", "shortanswer"], ["humanities", "language"]),
  bi("Cause in history", "intermediate", ["prose", "prose", "shortanswer"], ["history", "civics"]),
  bi("Read a passage", "intermediate", ["prose", "prose", "fillblank"], ["reading", "esl"]),
  bi("Interpret a source", "intermediate", ["prose", "image", "prose", "shortanswer"], ["history"]),
  bi("Theme & evidence", "intermediate", ["prose", "prose", "quiz"], ["literature"]),
  bi("Dialogue practice", "intermediate", ["prose", "prose", "fillblank"], ["language", "esl"]),
  bi("Two viewpoints", "intermediate", ["prose", "table", "prose", "shortanswer"], ["philosophy", "civics"]),
  bi("Timeline reasoning", "intermediate", ["prose", "prose", "quiz"], ["history"]),

  // advanced (3-4 dense texts + aid)
  bi("Scholar reading", "advanced", ["prose", "prose", "prose", "shortanswer"], ["humanities", "reading"]),
  bi("Critical analysis", "advanced", ["prose", "prose", "prose", "prose", "shortanswer"], ["literature", "philosophy"]),
  bi("Source critique", "advanced", ["prose", "image", "prose", "prose", "shortanswer"], ["history"]),
  bi("Argue a thesis", "advanced", ["prose", "prose", "prose", "shortanswer"], ["writing", "humanities"]),
  bi("Compare traditions", "advanced", ["prose", "table", "prose", "prose", "shortanswer"], ["humanities", "arts"]),
  bi("Dense passage study", "advanced", ["prose", "prose", "prose", "fillblank"], ["reading", "literature"]),
  bi("Historiography", "advanced", ["prose", "prose", "table", "prose", "shortanswer"], ["history"]),
  bi("Rhetoric breakdown", "advanced", ["prose", "prose", "prose", "quiz"], ["writing", "language"]),
  bi("Ethics debate", "advanced", ["prose", "prose", "prose", "shortanswer"], ["philosophy", "civics"]),
  bi("Advanced ESL reading", "advanced", ["prose", "prose", "prose", "fillblank"], ["esl", "language"]),
];

/* ---------------- General: 10 (untagged, level-spread) ---------------- */
const GENERAL_TEMPLATES: SlideTemplate[] = [
  bi("Key takeaway", "beginner", ["prose", "stickynote", "mcq2"], []),
  bi("Picture first", "beginner", ["image", "prose", "quiz"], []),
  bi("Quick check", "beginner", ["prose", "fillblank"], []),
  bi("Explain & apply", "intermediate", ["prose", "prose", "quiz"], []),
  bi("Show and compare", "intermediate", ["prose", "table", "prose", "shortanswer"], []),
  bi("Illustrated idea", "intermediate", ["prose", "image", "prose", "quiz"], []),
  bi("Reflect in writing", "intermediate", ["prose", "prose", "shortanswer"], []),
  bi("Deep explainer", "advanced", ["prose", "prose", "prose", "shortanswer"], []),
  bi("Case study", "advanced", ["prose", "prose", "table", "prose", "shortanswer"], []),
  bi("Synthesis", "advanced", ["prose", "prose", "prose", "quiz"], []),
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
  const byLevel = bySubject.filter((t) => t.level === level);
  return byLevel.length > 0 ? byLevel : bySubject;
}
