import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyGeminiError, generateSpeechWithGemini, parseCoachReply, streamSpeechWithGemini } from "./gemini";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("reads audio from the standard Interactions REST model_output content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      steps: [{
        type: "model_output",
        content: [{ type: "audio", data: "cGNt", mime_type: "audio/l16", sample_rate: 24000, channels: 1 }]
      }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSpeechWithGemini({
      apiKey: "test-key",
      model: "gemini-3.1-flash-tts-preview",
      text: "Hello!",
      voice: "Kore"
    })).resolves.toEqual({ data: "cGNt", mimeType: "audio/l16", sampleRate: 24000, channels: 1 });
  });

  it("reads audio chunks from an Interactions stream before completion", async () => {
    const streamEvent = JSON.stringify({ event_type: "step.delta", delta: { type: "audio", data: "Y2h1bms=", mime_type: "audio/l16", sample_rate: 24000, channels: 1 } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(`data: ${streamEvent}\n\ndata: {"event_type":"interaction.completed"}\n\n`, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const chunks: Array<{ data: string; mimeType: string }> = [];

    await streamSpeechWithGemini({
      apiKey: "test-key",
      model: "gemini-3.1-flash-tts-preview",
      text: "Hello!",
      voice: "Kore",
      onAudio: (chunk) => chunks.push({ data: chunk.data, mimeType: chunk.mimeType })
    });

    expect(chunks).toEqual([{ data: "Y2h1bms=", mimeType: "audio/l16" }]);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body).stream).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse");
  });
});
