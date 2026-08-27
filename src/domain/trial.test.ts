import { describe, expect, it } from "vitest";
import { isTrialEnglishLevel, normalizeTrialEnglishLevel, normalizeTrialSpeechOutputProvider } from "./trial";

describe("PWA trial edition limits", () => {
  it("keeps only A1 and A2, and safely downgrades an existing higher level to A2", () => {
    expect(isTrialEnglishLevel("A1")).toBe(true);
    expect(isTrialEnglishLevel("A2")).toBe(true);
    expect(isTrialEnglishLevel("B1")).toBe(false);
    expect(normalizeTrialEnglishLevel("C2")).toBe("A2");
  });

  it("always uses device speech", () => {
    expect(normalizeTrialSpeechOutputProvider()).toBe("device");
  });
});
