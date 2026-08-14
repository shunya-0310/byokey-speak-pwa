import { describe, expect, it } from "vitest";
import type { DailyStat, VocabCard } from "./models";
import {
  buildMonthCalendar,
  buildVocabularyHistory,
  canMoveToNextMonth,
  countExpressionOccurrences,
  deriveChatTitle,
  epochDayFromYmd,
  formatVocabularyGraphDate,
  localEpochDay,
  localProgress,
  naturalReplyOf,
  niceVocabularyAxisMax,
  streak,
  vocabularyChartXIndexes
} from "./stats";

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

  it("counts active vocabulary use with word boundaries", () => {
    expect(countExpressionOccurrences("Quick Assist", [
      "I use Quick Assist when I need help.",
      "quick assist is useful. Quick Assistant is a different phrase."
    ])).toBe(2);
  });

  it("counts study days only when turns are greater than zero", () => {
    const stats: DailyStat[] = [
      { epochDay: 1, turns: 1, assistUses: 0, notesSaved: 0, reviewsDone: 0 },
      { epochDay: 2, turns: 0, assistUses: 3, notesSaved: 0, reviewsDone: 0 },
      { epochDay: 3, turns: 0, assistUses: 0, notesSaved: 0, reviewsDone: 2 }
    ];
    expect(localProgress(stats, [], []).studyDays).toBe(1);
  });

  it("uses local calendar dates for epochDay", () => {
    expect(localEpochDay(new Date(2026, 7, 14, 23, 59))).toBe(epochDayFromYmd(2026, 7, 14));
  });

  it("builds cumulative vocabulary history and carries days without additions", () => {
    const vocab = [
      vocabCard("a", new Date(2026, 7, 1).getTime()),
      vocabCard("b", new Date(2026, 7, 1).getTime()),
      vocabCard("c", new Date(2026, 7, 3).getTime())
    ];
    expect(buildVocabularyHistory(vocab, epochDayFromYmd(2026, 7, 4))).toEqual([
      { epochDay: epochDayFromYmd(2026, 7, 1), count: 2 },
      { epochDay: epochDayFromYmd(2026, 7, 2), count: 2 },
      { epochDay: epochDayFromYmd(2026, 7, 3), count: 3 },
      { epochDay: epochDayFromYmd(2026, 7, 4), count: 3 }
    ]);
  });

  it("calculates nice vocabulary chart axes", () => {
    expect(niceVocabularyAxisMax(0)).toBe(4);
    expect(niceVocabularyAxisMax(17)).toBe(20);
    expect(niceVocabularyAxisMax(101)).toBe(120);
    expect(niceVocabularyAxisMax(501)).toBe(600);
  });

  it("limits x-axis labels and formats the date range", () => {
    expect(vocabularyChartXIndexes(8)).toEqual([0, 1, 3, 5, 7]);
    expect(formatVocabularyGraphDate(epochDayFromYmd(2026, 7, 14), epochDayFromYmd(2026, 7, 1), epochDayFromYmd(2026, 7, 30))).toBe("8/14");
    expect(formatVocabularyGraphDate(epochDayFromYmd(2026, 5, 1), epochDayFromYmd(2026, 0, 1), epochDayFromYmd(2026, 7, 30))).toBe("6月");
    expect(formatVocabularyGraphDate(epochDayFromYmd(2027, 1, 1), epochDayFromYmd(2026, 10, 1), epochDayFromYmd(2027, 1, 1))).toBe("27/02");
  });

  it("builds month calendars for leap years and six-week months", () => {
    const feb2024 = buildMonthCalendar(2024, 1).filter((cell) => cell.day !== null);
    expect(feb2024).toHaveLength(29);
    expect(buildMonthCalendar(2026, 7)).toHaveLength(42);
  });

  it("prevents moving the calendar into a future month", () => {
    expect(canMoveToNextMonth(2026, 6, new Date(2026, 7, 14))).toBe(true);
    expect(canMoveToNextMonth(2026, 7, new Date(2026, 7, 14))).toBe(false);
  });
});

function vocabCard(expression: string, createdAt: number): VocabCard {
  return {
    id: expression,
    expression,
    meaning: "",
    source: "Chats",
    favorite: false,
    usageCount: 0,
    reviewed: false,
    createdAt
  };
}
