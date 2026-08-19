import Dexie, { type Table } from "dexie";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Chat,
  type ChatMessage,
  type ConversationAnalysis,
  type DailyStat,
  type LearningNote,
  type VocabCard
} from "../domain/models";
import { localEpochDay, normalizeVocabDisplayExpression, normalizeVocabExpression } from "../domain/stats";

export class ByokeyDb extends Dexie {
  settings!: Table<{ id: "settings"; value: AppSettings }, "settings">;
  chats!: Table<Chat, string>;
  messages!: Table<ChatMessage, string>;
  vocabCards!: Table<VocabCard, string>;
  learningNotes!: Table<LearningNote, string>;
  dailyStats!: Table<DailyStat, number>;
  analyses!: Table<ConversationAnalysis, string>;
  secrets!: Table<{ id: string; value: unknown }, string>;
  newsCache!: Table<{ id: string; raw: string; fetchedAt: number }, string>;
  generatedSpeechCache!: Table<CachedGeneratedSpeech, string>;

  constructor() {
    super("byokey-speak-pwa");
    this.version(1).stores({
      settings: "id",
      chats: "id, updatedAt, pinned, origin",
      messages: "id, chatId, createdAt, role",
      vocabCards: "id, expression, source, favorite, reviewed, createdAt",
      learningNotes: "id, chatId, reviewed, createdAt",
      dailyStats: "epochDay",
      analyses: "id, createdAt",
      secrets: "id",
      newsCache: "id, fetchedAt"
    });
    this.version(2).stores({
      settings: "id",
      chats: "id, updatedAt, pinned, origin",
      messages: "id, chatId, createdAt, role",
      vocabCards: "id, expression, source, favorite, reviewed, createdAt",
      learningNotes: "id, chatId, reviewed, createdAt",
      dailyStats: "epochDay",
      analyses: "id, createdAt",
      secrets: "id",
      newsCache: "id, fetchedAt",
      generatedSpeechCache: "id, lastUsedAt, createdAt"
    });
  }
}

export const db = new ByokeyDb();

export type CachedGeneratedSpeech = {
  id: string;
  messageId: string;
  model: string;
  voice: string;
  data: string;
  mimeType: string;
  sampleRate?: number;
  channels?: number;
  sizeBytes: number;
  createdAt: number;
  lastUsedAt: number;
};

const MAX_GENERATED_SPEECH_CACHE_BYTES = 25 * 1024 * 1024;
const MAX_GENERATED_SPEECH_CACHE_ENTRIES = 60;

export function generatedSpeechCacheId(messageId: string, model: string, voice: string) {
  return `gemini-tts-v1:${messageId}:${model.trim().replace(/^models\//, "")}:${voice.trim() || "Kore"}`;
}

export async function getCachedGeneratedSpeech(id: string) {
  const cached = await db.generatedSpeechCache.get(id);
  if (!cached) return undefined;
  const lastUsedAt = Date.now();
  await db.generatedSpeechCache.update(id, { lastUsedAt });
  return { ...cached, lastUsedAt };
}

export async function saveGeneratedSpeechCache(input: Omit<CachedGeneratedSpeech, "sizeBytes" | "createdAt" | "lastUsedAt">) {
  const now = Date.now();
  const record: CachedGeneratedSpeech = {
    ...input,
    // Base64 occupies 4 bytes for each 3 audio bytes. The original byte size
    // is used so the local cache cap remains meaningful across browsers.
    sizeBytes: Math.floor(input.data.length * 0.75),
    createdAt: now,
    lastUsedAt: now
  };
  await db.transaction("rw", db.generatedSpeechCache, async () => {
    await db.generatedSpeechCache.put(record);
    const cached = await db.generatedSpeechCache.toArray();
    let totalBytes = cached.reduce((total, item) => total + item.sizeBytes, 0);
    const oldestFirst = cached.sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.createdAt - b.createdAt);
    while (oldestFirst.length > MAX_GENERATED_SPEECH_CACHE_ENTRIES || totalBytes > MAX_GENERATED_SPEECH_CACHE_BYTES) {
      const oldest = oldestFirst.shift();
      if (!oldest) break;
      await db.generatedSpeechCache.delete(oldest.id);
      totalBytes -= oldest.sizeBytes;
    }
  });
}

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function loadSettings() {
  const row = await db.settings.get("settings");
  return { ...DEFAULT_SETTINGS, ...row?.value };
}

export async function saveSettings(settings: AppSettings) {
  await db.settings.put({ id: "settings", value: settings });
}

export async function ensureFirstChat() {
  const settings = await loadSettings();
  if (settings.lastOpenedChatId && await db.chats.get(settings.lastOpenedChatId)) return settings.lastOpenedChatId;
  const existing = await db.chats.orderBy("updatedAt").reverse().first();
  if (existing) {
    await saveSettings({ ...settings, lastOpenedChatId: existing.id });
    return existing.id;
  }
  const chat = createChat("New chat", "FREE_CHAT");
  await db.chats.put(chat);
  await saveSettings({ ...settings, lastOpenedChatId: chat.id });
  return chat.id;
}

export function createChat(title = "New chat", origin: Chat["origin"] = "FREE_CHAT", newsContext?: string): Chat {
  const now = Date.now();
  return { id: id("chat"), title, origin, pinned: false, createdAt: now, updatedAt: now, newsContext };
}

export async function recordDailyStat(patch: Partial<Omit<DailyStat, "epochDay">>) {
  const epochDay = localEpochDay();
  const current = await db.dailyStats.get(epochDay) ?? { epochDay, turns: 0, assistUses: 0, notesSaved: 0, reviewsDone: 0 };
  await db.dailyStats.put({
    ...current,
    turns: current.turns + (patch.turns ?? 0),
    assistUses: current.assistUses + (patch.assistUses ?? 0),
    notesSaved: current.notesSaved + (patch.notesSaved ?? 0),
    reviewsDone: current.reviewsDone + (patch.reviewsDone ?? 0)
  });
}

export async function saveVocabCard(input: { expression: string; meaning: string; source: VocabCard["source"]; chatId?: string }) {
  const expression = normalizeVocabDisplayExpression(input.expression);
  if (!expression) return;
  const meaning = input.meaning.trim();
  const normalized = normalizeVocabExpression(expression);
  const quickAssist = input.source === "QuickAssist";
  const cards = await db.vocabCards.toArray();
  const existing = cards.find((card) => normalizeVocabExpression(card.expression) === normalized && (card.source === "QuickAssist") === quickAssist);
  if (!existing) {
    await db.vocabCards.put({
      id: id("vocab"),
      expression,
      meaning,
      source: input.source,
      chatId: input.chatId,
      favorite: false,
      usageCount: 0,
      reviewed: false,
      createdAt: Date.now()
    });
    await recordDailyStat({ notesSaved: 1 });
    return;
  }
  const patch: Partial<VocabCard> = {
    expression,
    source: existing.source === "QuickAssist" ? "QuickAssist" : input.source,
    chatId: existing.chatId ?? input.chatId
  };
  if (!existing.meaning && meaning) patch.meaning = meaning;
  await db.vocabCards.update(existing.id, patch);
}

export function mergeEquivalentVocabCards(cards: VocabCard[]) {
  const groups = new Map<string, VocabCard[]>();
  for (const card of cards) {
    const key = `${card.source === "QuickAssist" ? "assist" : "vocab"}:${normalizeVocabExpression(card.expression)}`;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return [...groups.values()]
    .map((group) => {
      const favorite = group.some((card) => card.favorite);
      const reviewed = group.some((card) => card.reviewed);
      const latest = group.reduce((best, card) => card.createdAt > best.createdAt ? card : best, group[0]);
      const newestMeaning = [...group].sort((a, b) => b.createdAt - a.createdAt).find((card) => card.meaning.trim());
      const representative = group.reduce((best, card) => {
        if (card.favorite !== best.favorite) return card.favorite ? card : best;
        return card.createdAt > best.createdAt ? card : best;
      }, group[0]);
      return {
        ...representative,
        expression: normalizeVocabDisplayExpression(latest.expression),
        meaning: newestMeaning?.meaning ?? representative.meaning,
        source: group.some((card) => card.source === "QuickAssist") ? "QuickAssist" as const : representative.source,
        favorite,
        reviewed,
        createdAt: Math.max(...group.map((card) => card.createdAt))
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function setEquivalentVocabFavorite(card: VocabCard, favorite: boolean) {
  const normalized = normalizeVocabExpression(card.expression);
  const quickAssist = card.source === "QuickAssist";
  const cards = await db.vocabCards.toArray();
  await Promise.all(cards
    .filter((candidate) => normalizeVocabExpression(candidate.expression) === normalized && (candidate.source === "QuickAssist") === quickAssist)
    .map((candidate) => db.vocabCards.update(candidate.id, { favorite })));
}

export async function deleteEquivalentVocabCard(card: VocabCard) {
  const normalized = normalizeVocabExpression(card.expression);
  const quickAssist = card.source === "QuickAssist";
  const cards = await db.vocabCards.toArray();
  await db.vocabCards.bulkDelete(cards
    .filter((candidate) => normalizeVocabExpression(candidate.expression) === normalized && (candidate.source === "QuickAssist") === quickAssist)
    .map((candidate) => candidate.id));
}

export async function clearLearningData() {
  await db.transaction("rw", [db.chats, db.messages, db.vocabCards, db.learningNotes, db.dailyStats, db.analyses, db.generatedSpeechCache], async () => {
    await Promise.all([
      db.chats.clear(),
      db.messages.clear(),
      db.vocabCards.clear(),
      db.learningNotes.clear(),
      db.dailyStats.clear(),
      db.analyses.clear(),
      db.generatedSpeechCache.clear()
    ]);
  });
}

export async function clearAllLocalData() {
  await db.transaction("rw", [db.settings, db.chats, db.messages, db.vocabCards, db.learningNotes, db.dailyStats, db.analyses, db.secrets, db.newsCache, db.generatedSpeechCache], async () => {
    await Promise.all([
      db.settings.clear(),
      db.chats.clear(),
      db.messages.clear(),
      db.vocabCards.clear(),
      db.learningNotes.clear(),
      db.dailyStats.clear(),
      db.analyses.clear(),
      db.secrets.clear(),
      db.newsCache.clear(),
      db.generatedSpeechCache.clear()
    ]);
  });
}

export async function exportSnapshot() {
  const [settings, chats, messages, vocabCards, learningNotes, dailyStats, analyses] = await Promise.all([
    loadSettings(),
    db.chats.toArray(),
    db.messages.toArray(),
    db.vocabCards.toArray(),
    db.learningNotes.toArray(),
    db.dailyStats.toArray(),
    db.analyses.toArray()
  ]);
  return {
    contentVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    settings: {
      model: settings.model,
      englishLevel: settings.englishLevel,
      coachSkills: settings.coachSkills,
      theme: settings.theme,
      voiceMode: settings.voiceMode,
      voiceGender: settings.voiceGender,
      voiceRate: settings.voiceRate,
      speechOutputProvider: settings.speechOutputProvider,
      geminiTtsModel: settings.geminiTtsModel,
      geminiTtsVoice: settings.geminiTtsVoice,
      liveModel: settings.liveModel,
      liveVoice: settings.liveVoice,
      soundEffectsEnabled: settings.soundEffectsEnabled,
      dailyNewsNotificationsEnabled: settings.dailyNewsNotificationsEnabled
    },
    chats,
    messages,
    vocabCards,
    learningNotes,
    dailyStats,
    analyses
  };
}

export async function restoreSnapshot(snapshot: Awaited<ReturnType<typeof exportSnapshot>>) {
  if (snapshot.contentVersion !== 1) throw new Error("このバックアップ形式には対応していません。");
  const current = await loadSettings();
  await db.transaction("rw", [db.settings, db.chats, db.messages, db.vocabCards, db.learningNotes, db.dailyStats, db.analyses, db.generatedSpeechCache], async () => {
    await Promise.all([
      db.chats.clear(),
      db.messages.clear(),
      db.vocabCards.clear(),
      db.learningNotes.clear(),
      db.dailyStats.clear(),
      db.analyses.clear(),
      db.generatedSpeechCache.clear()
    ]);
    await Promise.all([
      db.chats.bulkPut(snapshot.chats),
      db.messages.bulkPut(snapshot.messages),
      db.vocabCards.bulkPut(snapshot.vocabCards),
      db.learningNotes.bulkPut(snapshot.learningNotes),
      db.dailyStats.bulkPut(snapshot.dailyStats),
      db.analyses.bulkPut(snapshot.analyses),
      saveSettings({ ...current, ...snapshot.settings, hasApiKey: current.hasApiKey })
    ]);
  });
}
