import { z } from "zod";

export const cefrSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

export const sourceSchema = z.object({
  title: z.string().default(""),
  url: z.string().url().refine((url) => url.startsWith("https://"), "source must be https")
});

export const conversationAnalysisSchema = z.object({
  summary: z.string().default(""),
  estimatedCefr: z.union([cefrSchema, z.literal("判定保留")]).default("判定保留"),
  cefrRationale: z.string().default(""),
  strengths: z.array(z.object({
    title: z.string().default(""),
    evidence: z.array(z.string()).optional().default([]),
    comment: z.string().default("")
  })).default([]),
  recurringPatterns: z.array(z.object({
    category: z.enum(["grammar", "naturalness", "vocabulary", "conversation"]),
    title: z.string(),
    occurrences: z.number().int().min(0),
    examples: z.array(z.object({
      original: z.string(),
      suggestion: z.string(),
      explanationJa: z.string()
    })).default([]),
    nextAction: z.string().default("")
  })).default([]),
  improvements: z.array(z.object({
    title: z.string().default(""),
    evidence: z.array(z.string()).optional().default([]),
    comment: z.string().default("")
  })).default([]),
  nextFocus: z.array(z.string()).default([]),
  levelUpPlan: z.array(z.string()).default([]),
  practicePrompts: z.array(z.string()).default([])
});

export const dailyNewsFeedSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.string().optional(),
  date: z.string(),
  generatedAt: z.string(),
  items: z.array(z.object({
    id: z.string(),
    category: z.enum(["politics_economy", "technology", "sports", "entertainment"]),
    categoryLabel: z.string().optional(),
    headline: z.string().min(1),
    summary: z.string().min(1),
    question: z.string().min(1),
    coachLeads: z.object({
      friendly: z.string(),
      energetic: z.string(),
      calm: z.string(),
      direct: z.string()
    }),
    sources: z.array(sourceSchema).min(1),
    fallbackKind: z.string().optional(),
    fallback: z.boolean().optional()
  }))
});

export type DailyNewsFeed = z.infer<typeof dailyNewsFeedSchema>;
export type DailyNewsItem = DailyNewsFeed["items"][number];
