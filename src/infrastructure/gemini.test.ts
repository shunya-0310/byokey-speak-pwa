import { describe, expect, it } from "vitest";
import { classifyGeminiError, parseCoachReply } from "./gemini";

describe("gemini", () => {
  it("classifies errors without exposing raw body", () => {
    expect(classifyGeminiError(403, "API key not valid")).toBe("invalid_api_key");
    expect(classifyGeminiError(429, "quota exceeded")).toBe("billing");
    expect(classifyGeminiError(500, "server")).toBe("provider");
  });

  it("parses coach reply sections and vocabulary", () => {
    const parsed = parseCoachReply("Natural reply: Hi there.\nCoach notes: Nice.\nJapanese explanation: こんにちは。\nBetter options: Sounds good.\nVocab: phrase | 表現");
    expect(parsed.reply).toBe("Hi there.");
    expect(parsed.vocabulary).toEqual([{ expression: "phrase", meaning: "表現" }]);
  });
});
