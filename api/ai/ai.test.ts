import { describe, expect, it } from "vitest";
import { extractJson, repoRef, slugify, slideDeckSchema, lessonPathSchema } from "./prompts";
import { mockDeck, mockLessonPath, mockCoachReply } from "./mock";

describe("slugify", () => {
  it("makes stable kebab slugs", () => {
    expect(slugify("FS1111 — Foundations of Physics: Motion & Forces")).toBe(
      "fs1111-foundations-of-physics-motion-forces",
    );
    expect(slugify("  Casa Azul — Mexican Kitchen  ")).toBe("casa-azul-mexican-kitchen");
    expect(slugify("!!!")).toBe("untitled");
  });
});

describe("repoRef", () => {
  it("is 5 chars, deterministic, and slug-dependent", () => {
    const a = repoRef("physics-fs1111-motion");
    expect(a).toMatch(/^[A-Z2-9]{5}$/);
    expect(repoRef("physics-fs1111-motion")).toBe(a);
    expect(repoRef("casa-azul-menu")).not.toBe(a);
  });
});

describe("extractJson", () => {
  it("tolerates fences and surrounding prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('sure! {"a":{"b":2}} hope that helps')).toBe('{"a":{"b":2}}');
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("mock generators satisfy the output contracts", () => {
  it("mockDeck validates against slideDeckSchema", () => {
    const deck = mockDeck({
      topic: "Newton's laws of motion",
      level: "beginner",
      slideCount: 6,
      imageStyle: "sketch",
    });
    const parsed = slideDeckSchema.parse(deck);
    expect(parsed.slides).toHaveLength(6);
    // at most one sticky note per deck
    const stickies = parsed.slides.flatMap((s) =>
      s.components.filter((c) => c.type === "stickynote"),
    );
    expect(stickies.length).toBeLessThanOrEqual(1);
    // at most one latex per slide
    for (const s of parsed.slides) {
      expect(s.components.filter((c) => c.type === "latex").length).toBeLessThanOrEqual(1);
    }
  });

  it("mock quiz questions are closed-form MCQs (never open-ended prompts)", () => {
    for (const level of ["beginner", "intermediate", "advanced"] as const) {
      const deck = mockDeck({ topic: "Newton's laws of motion", level, slideCount: 8, imageStyle: "sketch" });
      const questions = deck.slides.flatMap((s) => (s.quiz ? [s.quiz.question] : []));
      expect(questions.length).toBeGreaterThan(0);
      for (const q of questions) {
        expect(q.toLowerCase()).not.toContain("in your own words");
        expect(q.toLowerCase()).not.toMatch(/\b(explain|describe|what do you think)\b/);
      }
    }
  });

  it("mockDeck is deterministic", () => {
    const opts = { topic: "chilaquiles", level: "intermediate" as const, slideCount: 4, imageStyle: "flat" as const };
    expect(mockDeck(opts)).toEqual(mockDeck(opts));
  });

  it("mockLessonPath validates and respects requested shape", () => {
    const draft = mockLessonPath({
      description: "A taco restaurant menu",
      template: "restaurant",
      unitCount: 3,
      lessonsPerUnit: 2,
    });
    const parsed = lessonPathSchema.parse(draft);
    expect(parsed.units).toHaveLength(3);
    for (const u of parsed.units) expect(u.lessons).toHaveLength(2);
  });

  it("mockCoachReply detects templates from keywords", () => {
    expect(mockCoachReply("build my restaurant menu").actions[0].payload?.template).toBe("restaurant");
    expect(mockCoachReply("teach new technicians plumbing repair").actions[0].payload?.template).toBe("service");
    expect(mockCoachReply("my candle shop collection").actions[0].payload?.template).toBe("shop");
    expect(mockCoachReply("a physics course").actions[0].payload?.template).toBe("course");
  });
});
