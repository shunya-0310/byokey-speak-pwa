import type { ChatMessage, DailyStat, VocabCard } from "./models";

export const MS_PER_DAY = 86_400_000;

export interface VocabularyHistoryPoint {
  epochDay: number;
  count: number;
}

export interface CalendarCell {
  day: number | null;
  epochDay: number | null;
}

export function localEpochDay(input: Date | number = new Date()) {
  const date = typeof input === "number" ? new Date(input) : input;
  return epochDayFromYmd(date.getFullYear(), date.getMonth(), date.getDate());
}

export function todayEpochDay(now: Date | number = new Date()) {
  return localEpochDay(now);
}

export function epochDayFromYmd(year: number, monthIndex: number, day: number) {
  return Math.floor(Date.UTC(year, monthIndex, day) / MS_PER_DAY);
}

export function ymdFromEpochDay(epochDay: number) {
  const date = new Date(epochDay * MS_PER_DAY);
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate()
  };
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
  const studyDays = new Set(stats.filter((item) => item.turns > 0).map((item) => item.epochDay));
  const userMessages = messages.filter((message) => message.role === "user");
  return {
    streak: streak(studyDays),
    studyDays: studyDays.size,
    userTurns: userMessages.length,
    assistUses: stats.reduce((sum, item) => sum + item.assistUses, 0),
    savedExpressions: vocab.length,
    favoriteCount: vocab.filter((item) => item.favorite).length,
    reviewedCount: vocab.filter((item) => item.reviewed).length,
    averageUserLength: userMessages.length ? Math.round(userMessages.reduce((sum, item) => sum + item.text.length, 0) / userMessages.length) : 0
  };
}

export function studyDaySet(stats: DailyStat[]) {
  return new Set(stats.filter((item) => item.turns > 0).map((item) => item.epochDay));
}

export function buildMonthCalendar(year: number, monthIndex: number): CalendarCell[] {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [
    ...Array.from({ length: firstWeekday }, () => ({ day: null, epochDay: null }))
  ];
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, epochDay: epochDayFromYmd(year, monthIndex, day) });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  cells.push(...Array.from({ length: trailing }, () => ({ day: null, epochDay: null })));
  return cells;
}

export function canMoveToNextMonth(year: number, monthIndex: number, today = new Date()) {
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonthIndex = monthIndex === 11 ? 0 : monthIndex + 1;
  return nextYear < today.getFullYear() || (nextYear === today.getFullYear() && nextMonthIndex <= today.getMonth());
}

export function buildVocabularyHistory(vocab: VocabCard[], today = todayEpochDay()): VocabularyHistoryPoint[] {
  if (!vocab.length) return [];
  const additions = new Map<number, number>();
  for (const card of vocab) {
    const day = localEpochDay(card.createdAt);
    additions.set(day, (additions.get(day) ?? 0) + 1);
  }
  const firstDay = Math.min(...additions.keys());
  const lastDay = Math.max(firstDay, today);
  let cumulative = 0;
  const points: VocabularyHistoryPoint[] = [];
  for (let day = firstDay; day <= lastDay; day += 1) {
    cumulative += additions.get(day) ?? 0;
    points.push({ epochDay: day, count: cumulative });
  }
  return points;
}

export function niceVocabularyAxisMax(maxCount: number) {
  if (maxCount <= 0) return 4;
  const unit = maxCount <= 20 ? 4 : maxCount <= 100 ? 20 : maxCount <= 250 ? 40 : maxCount <= 500 ? 100 : 200;
  return Math.max(unit, Math.ceil(maxCount / unit) * unit);
}

export function vocabularyChartXIndexes(length: number) {
  if (length <= 0) return [];
  if (length <= 5) return Array.from({ length }, (_, index) => index);
  const last = length - 1;
  return Array.from(new Set([0, Math.floor(last * 0.25), Math.floor(last * 0.5), Math.floor(last * 0.75), last]));
}

export function formatVocabularyGraphDate(epochDay: number, firstEpochDay: number, lastEpochDay: number) {
  const current = ymdFromEpochDay(epochDay);
  const first = ymdFromEpochDay(firstEpochDay);
  const last = ymdFromEpochDay(lastEpochDay);
  if (first.year !== last.year) return `${String(current.year % 100).padStart(2, "0")}/${String(current.monthIndex + 1).padStart(2, "0")}`;
  if (lastEpochDay - firstEpochDay > 120) return `${current.monthIndex + 1}月`;
  return `${current.monthIndex + 1}/${current.day}`;
}

export function normalizeVocabExpression(expression: string) {
  return expression
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeVocabDisplayExpression(expression: string) {
  return expression.trim().replace(/\s+/g, " ");
}

export function countExpressionOccurrences(expression: string, messages: string[]) {
  const target = normalizeVocabDisplayExpression(expression);
  if (!target) return 0;
  const wordCharacter = "[\\p{L}\\p{N}']";
  const pattern = new RegExp(`(?<!${wordCharacter})${escapeRegex(target)}(?!${wordCharacter})`, "giu");
  return messages.reduce((sum, message) => sum + [...message.matchAll(pattern)].length, 0);
}

export function countActiveVocabularyUse(messages: ChatMessage[], vocab: VocabCard[]) {
  const userTexts = messages.filter((message) => message.role === "user").map((message) => message.text);
  return vocab.map((card) => {
    const usageCount = countExpressionOccurrences(card.expression, userTexts);
    return { ...card, usageCount };
  });
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
