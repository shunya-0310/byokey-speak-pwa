import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyGeminiError, generateWithGemini, generateSpeechWithGemini, parseCoachReply, streamSpeechWithGemini } from "./gemini";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gemini", () => {
  it.each(["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash", "models/gemini-3.6-flash"])(
    "omits sampling and thinking overrides for %s while preserving the conversation prompt and search", async (model) => {
      const prompt = "Coach Skill: calm\nHistory: Hello / Hi\n今回の発言: 日本語で説明して。";
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Hello! こんにちは。" }] } }]
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const result = await generateWithGemini({ apiKey: "test-key", model, prompt, webSearchEnabled: true });
      expect(result.text).toBe("Hello! こんにちは。");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).not.toContain("test-key");
      expect(options.headers["x-goog-api-key"]).toBe("test-key");
      expect(JSON.parse(options.body)).toEqual({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] });
    }
  );

  it("keeps HTTP errors sanitized and does not retry a rejected config", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"INVALID_ARGUMENT test-key"}}', { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateWithGemini({ apiKey: "test-key", model: "gemini-3.6-flash", prompt: "Hello" }))
      .rejects.toThrow("Gemini呼び出しに失敗しました。");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
      content: [{ type: "audio", data: "AAEAAg==", mime_type: "audio/l16", sample_rate: 24000, channels: 1 }]
      }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSpeechWithGemini({
      apiKey: "test-key",
      model: "",
      text: "Hello!",
      voice: "Kore"
    })).resolves.toEqual({ data: "AAEAAg==", mimeType: "audio/l16", sampleRate: 24000, channels: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body.model).toBe("gemini-3.8-flash-lite-tts");
    expect(body.input[0].content[0].text).toBe("Hello!");
    expect(body.input[0].content[0].annotations[0]).toMatchObject({ type: "speech_metadata" });
    expect(body.response_format).toEqual({ type: "audio", mime_type: "audio/l16", sample_rate: 24000 });
    expect(body.generation_config.speech_config).toEqual([{ voice: "Kore" }]);
    expect(body.stream).toBeUndefined();
  });

  it("plays TTS chunks as Gemini sends its SSE stream and combines them for the local cache", async () => {
    const payload = [
      'data: {"event_type":"step.delta","delta":{"type":"audio","data":"YWI=","mime_type":"audio/l16;rate=24000","sample_rate":24000}}',
      'data: {"event_type":"step.delta","delta":{"type":"audio","data":"Y2Q=","mime_type":"audio/l16;rate=24000","sample_rate":24000}}',
      'data: {"event_type":"interaction.completed","interaction":{"status":"completed"}}',
      "data: [DONE]"
    ].join("\n\n");
    const fetchMock = vi.fn().mockResolvedValue(new Response(payload, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const received: string[] = [];

    await expect(streamSpeechWithGemini({
      apiKey: "test-key",
      model: "gemini-3.8-flash-lite-tts",
      text: "Hello!",
      voice: "Kore",
      onAudio: (chunk) => received.push(chunk.data)
    })).resolves.toEqual({ data: "YWJjZA==", mimeType: "audio/l16;rate=24000", sampleRate: 24000, channels: undefined });

    expect(received).toEqual(["YWJjZA=="]);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(request.body).stream).toBe(true);
    expect(JSON.parse(request.body).input[0].content[0].text).toBe("Hello!");
    expect(JSON.parse(request.body).response_format.mime_type).toBe("audio/l16");
    expect(request.headers["Api-Revision"]).toBeUndefined();
    expect(request.headers["x-goog-api-key"]).toBe("test-key");
  });

  it.each([
    ['data: {"event_type":"step.delta","delta":{"type":"audio","data":"AAE=","mime_type":"audio/wav"}}\n\ndata: {"event_type":"interaction.completed","interaction":{"status":"completed"}}', "形式"],
    ['data: {"event_type":"step.delta","delta":{"type":"audio","data":"AAE=","mime_type":"audio/l16"}}', "正常終了"],
    ['data: {"event_type":"step.delta","delta":{"type":"audio","data":"AAE=","mime_type":"audio/l16"}}\n\ndata: {"event_type":"error","error":{"message":"secret"}}', "失敗"]
  ])("rejects bad or incomplete streams without returning cacheable audio", async (payload, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payload, { status: 200 })));
    await expect(streamSpeechWithGemini({ apiKey: "test-key", model: "", text: "Hi", voice: "Puck", onAudio: () => {} })).rejects.toThrow(message);
  });

  it("rejects a WAV header split across PCM deltas before playback", async () => {
    const payload = [
      'data: {"event_type":"step.delta","delta":{"type":"audio","data":"Ukk=","mime_type":"audio/l16"}}',
      'data: {"event_type":"step.delta","delta":{"type":"audio","data":"RkY=","mime_type":"audio/l16"}}',
      'data: {"event_type":"interaction.completed","interaction":{"status":"completed"}}'
    ].join("\n\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payload, { status: 200 })));
    const onAudio = vi.fn();
    await expect(streamSpeechWithGemini({ apiKey: "test-key", model: "", text: "Hi", voice: "Kore", onAudio })).rejects.toThrow("PCM形式");
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("rejects audio with no declared MIME type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed", steps: [{ type: "model_output", content: [{ type: "audio", data: "AAEAAg==" }] }]
    }), { status: 200 })));
    await expect(generateSpeechWithGemini({ apiKey: "test-key", model: "", text: "Hi", voice: "Kore" })).rejects.toThrow("形式");
  });
});
