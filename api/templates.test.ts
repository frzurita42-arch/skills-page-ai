import { describe, expect, it } from "vitest";
import {
  BUILTIN_SLIDE_TEMPLATES,
  templatesForSubject,
  templatesForSubjectAndLevel,
  slideConformsToTemplate,
  slideConformsToAny,
  sectionForTags,
  isGradable,
  GRADABLE_TYPES,
  TEMPLATE_COMPONENT_LABELS,
  TEMPLATE_LEVELS,
} from "@contracts/slide-templates";

describe("slide-template catalog", () => {
  it("every built-in has a name, level, components, valid labels, and a gradable step", () => {
    for (const t of BUILTIN_SLIDE_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(TEMPLATE_LEVELS).toContain(t.level);
      expect(t.components.length).toBeGreaterThan(0);
      for (const c of t.components) expect(TEMPLATE_COMPONENT_LABELS[c]).toBeTruthy();
      // every template must be scoreable
      expect(t.components.some((c) => isGradable(c)), t.name).toBe(true);
    }
  });

  it("has ~10 STEM and ~10 humanities per level, and 10 general", () => {
    const stem = BUILTIN_SLIDE_TEMPLATES.filter((t) => sectionForTags(t.tags) === "stem");
    const hum = BUILTIN_SLIDE_TEMPLATES.filter((t) => sectionForTags(t.tags) === "humanities");
    const gen = BUILTIN_SLIDE_TEMPLATES.filter((t) => sectionForTags(t.tags) === "general");
    for (const level of TEMPLATE_LEVELS) {
      expect(stem.filter((t) => t.level === level).length).toBeGreaterThanOrEqual(10);
      expect(hum.filter((t) => t.level === level).length).toBeGreaterThanOrEqual(10);
    }
    expect(gen.length).toBeGreaterThanOrEqual(10);
  });

  it("advanced templates carry denser text than beginner ones", () => {
    const proseCount = (level: "beginner" | "advanced") =>
      BUILTIN_SLIDE_TEMPLATES.filter((t) => t.level === level).reduce(
        (n, t) => n + t.components.filter((c) => c === "prose").length,
        0,
      ) / Math.max(1, BUILTIN_SLIDE_TEMPLATES.filter((t) => t.level === level).length);
    expect(proseCount("advanced")).toBeGreaterThan(proseCount("beginner"));
  });

  it("STEM subjects get STEM+general layouts; humanities-only ones are dropped", () => {
    const stem = templatesForSubject(BUILTIN_SLIDE_TEMPLATES, true);
    for (const t of stem) expect(sectionForTags(t.tags)).not.toBe("humanities");
    expect(stem.some((t) => sectionForTags(t.tags) === "general")).toBe(true);
  });

  it("subject+level filtering returns only that level (when non-empty)", () => {
    const advStem = templatesForSubjectAndLevel(BUILTIN_SLIDE_TEMPLATES, true, "advanced");
    expect(advStem.length).toBeGreaterThan(0);
    for (const t of advStem) expect(t.level).toBe("advanced");
    for (const t of advStem) expect(sectionForTags(t.tags)).not.toBe("humanities");
  });

  it("gradable set is exactly the four evaluation types", () => {
    expect(new Set(GRADABLE_TYPES)).toEqual(
      new Set(["quiz", "mcq2", "fillblank", "shortanswer"]),
    );
  });
});

describe("slide conformance to templates", () => {
  const beginnerStem = templatesForSubjectAndLevel(BUILTIN_SLIDE_TEMPLATES, true, "beginner");

  it("an image + quiz slide with no text conforms to NO beginner STEM template", () => {
    // this is exactly the bad slide the user reported
    const shape = { componentTypes: ["image"], hasQuiz: true };
    expect(slideConformsToAny(shape, beginnerStem)).toBe(false);
  });

  it("a text + image + quiz slide conforms to an approved template", () => {
    const shape = { componentTypes: ["image", "prose"], hasQuiz: true };
    expect(slideConformsToAny(shape, beginnerStem)).toBe(true);
  });

  it("a template with a gradable step is not satisfied without a quiz", () => {
    const t = BUILTIN_SLIDE_TEMPLATES.find((x) => x.name === "Spot it on the graph")!;
    expect(slideConformsToTemplate({ componentTypes: ["prose", "chart"], hasQuiz: false }, t)).toBe(false);
    expect(slideConformsToTemplate({ componentTypes: ["prose", "chart"], hasQuiz: true }, t)).toBe(true);
  });

  it("extra components are allowed (template content is a subset)", () => {
    const t = BUILTIN_SLIDE_TEMPLATES.find((x) => x.name === "Read the table")!; // prose + table + mcq2
    const shape = { componentTypes: ["prose", "table", "stickynote"], hasQuiz: true };
    expect(slideConformsToTemplate(shape, t)).toBe(true);
  });

  it("every built-in template is self-conforming (its own shape satisfies it)", () => {
    for (const t of BUILTIN_SLIDE_TEMPLATES) {
      const content = t.components.filter((c) => !["quiz", "mcq2", "fillblank", "shortanswer"].includes(c));
      const hasQuiz = t.components.some((c) => ["quiz", "mcq2", "fillblank", "shortanswer"].includes(c));
      expect(slideConformsToTemplate({ componentTypes: content, hasQuiz }, t), t.name).toBe(true);
    }
  });
});
