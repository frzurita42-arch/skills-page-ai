/* ------------------------------------------------------------------ */
/* Slide layout templates.                                              */
/* A template is an ordered recipe of slide components ("Text → Table   */
/* → Multiple choice") tagged by subject. The catalog is shown in the   */
/* Templates page and injected into the slide-generation prompt so the  */
/* AI composes slides from approved layouts instead of improvising.     */
/* Built-ins live here in code (shared by UI + API); user-added         */
/* templates are stored in the slideTemplates table.                    */
/* ------------------------------------------------------------------ */

/**
 * The component vocabulary a template step may use. These map 1:1 onto the
 * player's renderable slide components — plus "quiz", which means "attach
 * this slide's multiple-choice question here".
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
] as const;

export type TemplateComponentType = (typeof TEMPLATE_COMPONENT_TYPES)[number];

/** Human labels for the template-bar chips (mirrors the sketch UI wording). */
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
};

export interface SlideTemplate {
  /** builtin templates use string ids ("builtin-read-graph"); custom rows use DB numeric ids */
  id: string | number;
  name: string;
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
];

export const BUILTIN_SLIDE_TEMPLATES: SlideTemplate[] = [
  // ---------- STEM ----------
  {
    id: "builtin-concept-formula",
    name: "Math concept",
    components: ["prose", "latex", "svg"],
    tags: ["math", "algebra", "physics"],
    builtin: true,
  },
  {
    id: "builtin-worked-solution",
    name: "Worked solution",
    components: ["prose", "latex", "chart", "quiz"],
    tags: ["math", "physics", "stem"],
    builtin: true,
  },
  {
    id: "builtin-read-graph",
    name: "Read the graph",
    components: ["prose", "chart", "quiz"],
    tags: ["math", "statistics", "economics"],
    builtin: true,
  },
  {
    id: "builtin-data-table",
    name: "Data table drill",
    components: ["prose", "table", "quiz"],
    tags: ["stem", "data", "science"],
    builtin: true,
  },
  {
    id: "builtin-diagram-deep-dive",
    name: "Explain the diagram",
    components: ["prose", "svg", "quiz"],
    tags: ["science", "biology", "engineering"],
    builtin: true,
  },
  {
    id: "builtin-code-walkthrough",
    name: "Code walkthrough",
    components: ["prose", "code", "quiz"],
    tags: ["programming", "cs"],
    builtin: true,
  },
  // ---------- Humanities / reading-heavy ----------
  {
    id: "builtin-close-reading",
    name: "Close reading",
    components: ["prose", "prose", "quiz"],
    tags: ["humanities", "history", "literature"],
    builtin: true,
  },
  {
    id: "builtin-scholar-reading",
    name: "Scholar reading (dense)",
    components: ["prose", "prose", "prose", "quiz"],
    tags: ["humanities", "history", "reading"],
    builtin: true,
  },
  {
    id: "builtin-narrative-image",
    name: "Narrative + image",
    components: ["prose", "image", "prose"],
    tags: ["humanities", "history", "arts"],
    builtin: true,
  },
  {
    id: "builtin-compare-table",
    name: "Compare & contrast",
    components: ["prose", "table", "prose"],
    tags: ["humanities", "language"],
    builtin: true,
  },
  {
    id: "builtin-esl-visual",
    name: "Visual vocabulary",
    components: ["image", "prose", "quiz"],
    tags: ["esl", "language"],
    builtin: true,
  },
  // ---------- General ----------
  {
    id: "builtin-key-takeaway",
    name: "Key takeaway",
    components: ["prose", "stickynote", "quiz"],
    tags: [],
    builtin: true,
  },
  {
    id: "builtin-picture-first",
    name: "Picture first",
    components: ["image", "prose", "quiz"],
    tags: [],
    builtin: true,
  },
];

/**
 * Filter the catalog for a topic classification: STEM topics drop
 * humanities-only templates and vice versa; untagged templates always apply.
 */
export function templatesForSubject(all: SlideTemplate[], stem: boolean): SlideTemplate[] {
  return all.filter((t) => {
    if (t.tags.length === 0) return true;
    const isStemT = t.tags.some((tag) => STEM_TAGS.includes(tag));
    const isHumT = t.tags.some((tag) => HUMANITIES_TAGS.includes(tag));
    if (isStemT && !isHumT) return stem;
    if (isHumT && !isStemT) return !stem;
    return true;
  });
}
