import type { ChatMessage, DailyStat, VocabCard } from "./models";

export function todayEpochDay(now = Date.now()) {
  return Math.floor(now / 86_400_000);
}

export function streak(studyDays: Set<number>, today = todayEpochDay()) {
  let anchor = studyDays.has(today) ? today : studyDays.has(today - 1) ? today - 1 : undefined;
  if (anchor === undefined) return 0;
  let count = 0;
  while (studyDays.has(anchor)) {
    count += 1;
    anchor -= 1;
  }
  return count;
}

export function deriveChatTitle(firstUserMessage: string, maxLength = 24) {
  const singleLine = firstUserMessage.replace(/\s+/g, " ").trim();
  if (!singleLine) return "New chat";
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength).trimEnd()}…`;
}

export function naturalReplyOf(text: string) {
  const lower = text.toLowerCase();
  const label = "natural reply:";
  const from = lower.indexOf(label) >= 0 ? lower.indexOf(label) + label.length : 0;
  const end = ["coach notes:", "japanese explanation:", "better options:", "native note:"]
    .map((candidate) => lower.indexOf(candidate, from))
    .filter((index) => index > from)
    .sort((a, b) => a - b)[0] ?? text.length;
  return text.slice(from, end).trim() || text;
}

export function localProgress(stats: DailyStat[], messages: ChatMessage[], vocab: VocabCard[]) {
  const studyDays = new Set(stats.filter((item) => item.turns > 0 || item.assistUses > 0 || item.reviewsDone > 0).map((item) => item.epochDay));
  const userMessages = messages.filter((message) => message.role === "user");
  return {
    streak: streak(studyDays),
    studyDays: studyDays.size,
    userTurns: userMessages.length,
    assistUses: stats.reduce((sum, item) => sum + item.assistUses, 0),
    savedExpressions: vocab.length,
    reviewedCount: vocab.filter((item) => item.reviewed).length,
    averageUserLength: userMessages.length ? Math.round(userMessages.reduce((sum, item) => sum + item.text.length, 0) / userMessages.length) : 0
  };
}

export function countActiveVocabularyUse(messages: ChatMessage[], vocab: VocabCard[]) {
  return vocab.map((card) => {
    const needle = card.expression.toLowerCase().trim();
    const usageCount = messages.filter((message) => message.role === "user" && message.text.toLowerCase().includes(needle)).length;
    return { ...card, usageCount };
  });
}
