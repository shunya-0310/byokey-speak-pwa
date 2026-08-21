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
      model: "",
      text: "Hello!",
      voice: "Kore"
    })).resolves.toEqual({ data: "cGNt", mimeType: "audio/l16", sampleRate: 24000, channels: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body.model).toBe("gemini-3.1-flash-tts-preview");
    expect(body.response_format).toEqual({ type: "audio" });
  });

  it("plays TTS chunks as Gemini sends its SSE stream and combines them for the local cache", async () => {
    const payload = [
      'data: {"event_type":"step.delta","delta":{"type":"audio","data":"YQ==","mime_type":"audio/l16;rate=24000","sample_rate":24000}}',
      'data: {"event_type":"step.delta","delta":{"type":"audio","data":"Yg==","mime_type":"audio/l16;rate=24000","sample_rate":24000}}',
      "data: [DONE]"
    ].join("\n\n");
    const fetchMock = vi.fn().mockResolvedValue(new Response(payload, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const received: string[] = [];

    await expect(streamSpeechWithGemini({
      apiKey: "test-key",
      model: "gemini-3.1-flash-tts-preview",
      text: "Hello!",
      voice: "Kore",
      onAudio: (chunk) => received.push(chunk.data)
    })).resolves.toEqual({ data: "YWI=", mimeType: "audio/l16;rate=24000", sampleRate: 24000, channels: undefined });

    expect(received).toEqual(["YQ==", "Yg=="]);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(request.body).stream).toBe(true);
    expect(request.headers["Api-Revision"]).toBe("2026-05-20");
  });
});
