import { describe, expect, it } from "vitest";
import { createGeminiLiveSetup } from "./live";

describe("createGeminiLiveSetup", () => {
  it("uses the current Live API generationConfig envelope", () => {
    expect(createGeminiLiveSetup({
      model: "models/gemini-3.1-flash-live-preview",
      voice: "Kore",
      systemInstruction: "Be a helpful coach."
    })).toEqual({
      setup: {
        model: "models/gemini-3.1-flash-live-preview",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          thinkingConfig: { thinkingLevel: "minimal" }
        },
        systemInstruction: { parts: [{ text: "Be a helpful coach." }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      }
    });
  });
});
