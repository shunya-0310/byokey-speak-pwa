import { describe, expect, it } from "vitest";
import { deriveChatTitle, naturalReplyOf, streak } from "./stats";

describe("stats", () => {
  it("calculates streak including yesterday", () => {
    expect(streak(new Set([99, 98, 97]), 100)).toBe(3);
  });

  it("derives compact chat titles", () => {
    expect(deriveChatTitle("hello\nworld", 20)).toBe("hello world");
    expect(deriveChatTitle("a".repeat(30), 10)).toBe("aaaaaaaaaa…");
  });

  it("extracts natural reply for TTS", () => {
    expect(naturalReplyOf("Natural reply: Hi!\nCoach notes: None")).toBe("Hi!");
  });
});
