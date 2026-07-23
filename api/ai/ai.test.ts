import { describe, expect, it } from "vitest";
import {
  extractJson,
  repairDeckDraft,
  ensureExplanatoryProse,
  everySlideHasProse,
  slideHasProse,
  repoRef,
  slugify,
  slideDeckSchema,
  lessonPathSchema,
} from "./prompts";
import { mockDeck, mockLessonPath, mockCoachReply } from "./mock";
import { isStemTopic } from "@contracts/stem";

describe("isStemTopic", () => {
  it("classifies sciences as STEM", () => {
    for (const t of [
      "Mycology",
      "Particle physics",
      "Introduction to Astronomy",
      "Organic chemistry basics",
      "Geology of volcanoes",
      "Newton's laws of motion",
      "Machine learning for beginners",
      "Cell biology",
    ]) {
      expect(isStemTopic(t), t).toBe(true);
    }
  });

  it("classifies humanities-style topics as non-STEM", () => {
    for (const t of [
      "The history of the Roman Empire",
      "French cooking",
      "A biography of Frida Kahlo",
      "Creative writing workshop",
      "Philosophy of art",
    ]) {
      expect(isStemTopic(t), t).toBe(false);
    }
  });
});

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

describe("repairDeckDraft", () => {
  const defaults = { level: "beginner", imageStyle: "sketch", topic: "Fungi" };

  it("salvages a deck with one bad component and a bad quiz", () => {
    const raw = {
      slides: [
        {
          title: "Good slide",
          components: [
            { type: "prose", paragraphs: ["Fungi are neither plants nor animals."] },
            { type: "chart", chartType: "bar", title: "bad", labels: ["a"], series: [] }, // invalid
          ],
          quiz: {
            question: "Pick one",
            options: ["a", "b", "c"], // only 3 — invalid
            correctIndex: 0,
            explanation: "x",
          },
        },
        { title: "Empty slide", components: [] }, // dropped entirely
      ],
      // level/imageStyle/topic missing — filled from defaults
    };
    const deck = slideDeckSchema.parse(repairDeckDraft(raw, defaults));
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].components).toHaveLength(1);
    expect(deck.slides[0].quiz).toBeUndefined();
    expect(deck.level).toBe("beginner");
    expect(deck.imageStyle).toBe("sketch");
    expect(deck.topic).toBe("Fungi");
  });

  it("snaps invented image styles to the deck style", () => {
    const raw = {
      slides: [
        {
          title: "s",
          components: [
            { type: "image", prompt: "a mushroom", alt: "mushroom", style: "hand-drawn" },
          ],
        },
      ],
      level: "beginner",
      imageStyle: "sketch",
      topic: "Fungi",
    };
    const deck = slideDeckSchema.parse(repairDeckDraft(raw, defaults));
    const img = deck.slides[0].components[0];
    expect(img.type).toBe("image");
    if (img.type === "image") expect(img.style).toBe("sketch");
  });

  it("leaves a fully valid deck untouched", () => {
    const raw = {
      slides: [
        {
          title: "s",
          components: [{ type: "prose", paragraphs: ["p"] }],
          quiz: {
            question: "q?",
            options: ["a", "b", "c", "d"],
            correctIndex: 1,
            explanation: "e",
          },
        },
      ],
      level: "advanced",
      imageStyle: "none",
      topic: "Spores",
    };
    const deck = slideDeckSchema.parse(repairDeckDraft(structuredClone(raw), defaults));
    expect(deck).toEqual(raw);
  });
});

describe("explanatory-prose guarantees", () => {
  it("repair salvages prose with blank paragraphs instead of dropping it", () => {
    const raw = {
      slides: [
        {
          title: "Osmosis",
          components: [
            { type: "prose", paragraphs: ["", "Water moves across the membrane.", "  "] },
            { type: "image", prompt: "a cell", alt: "cell", style: "sketch" },
          ],
          quiz: { question: "q", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" },
        },
      ],
      level: "beginner",
      imageStyle: "sketch",
      topic: "Cells",
    };
    const deck = slideDeckSchema.parse(
      repairDeckDraft(raw, { level: "beginner", imageStyle: "sketch", topic: "Cells" }),
    );
    expect(slideHasProse(deck.slides[0])).toBe(true);
    const prose = deck.slides[0].components.find((c) => c.type === "prose");
    expect(prose?.type === "prose" && prose.paragraphs).toEqual(["Water moves across the membrane."]);
  });

  it("detects a visual-only slide as missing prose", () => {
    const deck = {
      slides: [
        {
          title: "Just a picture",
          components: [{ type: "image", prompt: "x", alt: "x", style: "sketch" }],
          quiz: { question: "q", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" },
        },
      ],
    };
    expect(everySlideHasProse(deck)).toBe(false);
  });

  it("ensureExplanatoryProse injects text on a visual-only slide, and it validates", () => {
    const deck = slideDeckSchema.parse({
      slides: [
        {
          title: "Photosynthesis at a glance",
          components: [
            { type: "prose", paragraphs: ["Plants make food from light."] },
            { type: "prose", paragraphs: ["placeholder"] },
          ],
          quiz: { question: "q", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" },
        },
      ],
      level: "beginner",
      imageStyle: "sketch",
      topic: "Plants",
    });
    // force the first slide to be visual-only, then guarantee prose
    deck.slides[0].components = [
      { type: "image", prompt: "a leaf", alt: "leaf", style: "sketch" },
    ];
    expect(everySlideHasProse(deck)).toBe(false);
    const fixed = ensureExplanatoryProse(deck);
    expect(everySlideHasProse(fixed)).toBe(true);
    // still a valid deck after injection
    expect(() => slideDeckSchema.parse(fixed)).not.toThrow();
    // the injected paragraph references the visual
    const prose = fixed.slides[0].components.find((c) => c.type === "prose");
    expect(prose?.type === "prose" && prose.paragraphs[0]).toContain("image");
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
