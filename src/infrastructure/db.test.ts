import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLearningData,
  db,
  generatedSpeechCacheId,
  getCachedGeneratedSpeech,
  saveGeneratedSpeechCache
} from "./db";

beforeEach(async () => {
  await db.generatedSpeechCache.clear();
});

describe("generated speech cache", () => {
  it("returns the locally stored audio for the same message, model, and voice", async () => {
    const id = generatedSpeechCacheId("message_1", "models/gemini-3.1-flash-tts-preview", "Kore");
    await saveGeneratedSpeechCache({
      id,
      messageId: "message_1",
      model: "gemini-3.1-flash-tts-preview",
      voice: "Kore",
      data: "cGNt",
      mimeType: "audio/l16",
      sampleRate: 24000,
      channels: 1
    });

    await expect(getCachedGeneratedSpeech(id)).resolves.toMatchObject({
      id,
      data: "cGNt",
      sampleRate: 24000,
      channels: 1
    });
  });

  it("removes generated speech together with learning data", async () => {
    await saveGeneratedSpeechCache({
      id: generatedSpeechCacheId("message_2", "gemini-3.1-flash-tts-preview", "Kore"),
      messageId: "message_2",
      model: "gemini-3.1-flash-tts-preview",
      voice: "Kore",
      data: "cGNt",
      mimeType: "audio/l16"
    });

    await clearLearningData();

    await expect(db.generatedSpeechCache.count()).resolves.toBe(0);
  });
});
