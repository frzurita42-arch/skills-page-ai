import { describe, expect, it } from "vitest";
import {
  BUILTIN_SLIDE_TEMPLATES,
  templatesForSubject,
  TEMPLATE_COMPONENT_LABELS,
} from "@contracts/slide-templates";

describe("slide-template catalog", () => {
  it("every built-in has a name, at least one component and valid labels", () => {
    for (const t of BUILTIN_SLIDE_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.components.length).toBeGreaterThan(0);
      for (const c of t.components) {
        expect(TEMPLATE_COMPONENT_LABELS[c]).toBeTruthy();
      }
    }
  });

  it("STEM subjects get formula/code layouts; humanities-only ones are dropped", () => {
    const stem = templatesForSubject(BUILTIN_SLIDE_TEMPLATES, true);
    const names = stem.map((t) => t.name);
    expect(names).toContain("Worked solution");
    expect(names).toContain("Code walkthrough");
    // a humanities-only template must not be offered to a STEM topic
    expect(names).not.toContain("Scholar reading (dense)");
    expect(names).not.toContain("Close reading");
    // general (untagged) templates always apply
    expect(names).toContain("Key takeaway");
  });

  it("humanities subjects get reading layouts; STEM-only ones are dropped", () => {
    const hum = templatesForSubject(BUILTIN_SLIDE_TEMPLATES, false);
    const names = hum.map((t) => t.name);
    expect(names).toContain("Scholar reading (dense)");
    expect(names).toContain("Close reading");
    expect(names).not.toContain("Code walkthrough");
    expect(names).not.toContain("Worked solution");
    expect(names).toContain("Key takeaway");
  });

  it("the dense reading layout carries several distinct text steps", () => {
    const dense = BUILTIN_SLIDE_TEMPLATES.find((t) => t.name === "Scholar reading (dense)")!;
    const textSteps = dense.components.filter((c) => c === "prose").length;
    expect(textSteps).toBeGreaterThanOrEqual(3);
  });
});
