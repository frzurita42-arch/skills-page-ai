import { describe, expect, it } from "vitest";
import {
  BUILTIN_SLIDE_TEMPLATES,
  templatesForSubject,
  templatesForSubjectAndLevel,
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
