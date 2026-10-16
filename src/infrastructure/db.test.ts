import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLearningData,
  db,
  generatedSpeechCacheId,
  getCachedGeneratedSpeech,
  loadSettings,
  normalizeSettings,
  restoreSnapshot,
  saveGeneratedSpeechCache
} from "./db";

beforeEach(async () => {
  await db.generatedSpeechCache.clear();
});

describe("generated speech cache", () => {
  it("separates old and new model audio while retaining the selected voice", () => {
    expect(generatedSpeechCacheId("m", "gemini-3.1-flash-tts-preview", "Kore"))
      .not.toBe(generatedSpeechCacheId("m", "gemini-3.8-flash-lite-tts", "Kore"));
    expect(generatedSpeechCacheId("m", "gemini-3.8-flash-lite-tts", "Kore"))
      .not.toBe(generatedSpeechCacheId("m", "gemini-3.8-flash-lite-tts", "Puck"));
  });

  it.each(["gemini-3.1-flash-tts-preview", " models/gemini-3.1-flash-tts-preview ", "", "  "])("migrates old or blank TTS model %s", (model) => {
    const settings = normalizeSettings({ geminiTtsModel: model, geminiTtsVoice: "Puck", speechOutputProvider: "device", theme: "light" });
    expect(settings).toMatchObject({ geminiTtsModel: "gemini-3.8-flash-lite-tts", geminiTtsVoice: "Puck", speechOutputProvider: "device", theme: "light" });
    expect(normalizeSettings(settings)).toEqual(settings);
  });

  it("preserves a custom model and migrates stored and restored settings", async () => {
    expect(normalizeSettings({ geminiTtsModel: "models/custom-tts" }).geminiTtsModel).toBe("custom-tts");
    await db.settings.put({ id: "settings", value: { ...normalizeSettings({}), geminiTtsModel: "gemini-3.1-flash-tts-preview", geminiTtsVoice: "Puck" } });
    expect((await loadSettings()).geminiTtsModel).toBe("gemini-3.8-flash-lite-tts");
    const snapshot: Parameters<typeof restoreSnapshot>[0] = {
      contentVersion: 1, createdAt: new Date().toISOString(), appVersion: "test",
      settings: normalizeSettings({}), chats: [], messages: [], vocabCards: [], learningNotes: [], dailyStats: [], analyses: []
    };
    await restoreSnapshot({ ...snapshot, settings: { ...snapshot.settings, geminiTtsModel: "gemini-3.1-flash-tts-preview", geminiTtsVoice: "Puck" } });
    expect(await loadSettings()).toMatchObject({ geminiTtsModel: "gemini-3.8-flash-lite-tts", geminiTtsVoice: "Puck" });
  });
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
