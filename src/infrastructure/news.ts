import { dailyNewsFeedSchema, type DailyNewsFeed, type DailyNewsItem } from "../domain/schemas";
import { db } from "./db";

const FEED_URLS = [
  "https://byokey-lab.com/news/daily.json",
  "https://raw.githubusercontent.com/shunya-0310/byokey-lab-site/main/public/news/daily.json",
  "/data/fallback_daily_news.json"
];

export async function loadDailyNews(): Promise<{ feed: DailyNewsFeed; usingCache: boolean; notice?: string }> {
  for (const url of FEED_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      const raw = await response.text();
      const feed = dailyNewsFeedSchema.parse(JSON.parse(raw));
      await db.newsCache.put({ id: "daily", raw, fetchedAt: Date.now() });
      return { feed, usingCache: url.startsWith("/"), notice: url.startsWith("/") ? "同梱ニュースを表示しています。" : undefined };
    } catch {
      continue;
    }
  }
  const cached = await db.newsCache.get("daily");
  if (!cached) throw new Error("Daily Newsを読み込めませんでした。");
  return { feed: dailyNewsFeedSchema.parse(JSON.parse(cached.raw)), usingCache: true, notice: "保存済みニュースを表示しています。" };
}

export function newsHiddenContext(item: DailyNewsItem) {
  const sources = item.sources.map((source) => `${source.title}: ${source.url}`).join("\n");
  return `__BYOKEY_NEWS_CONTEXT__
This chat started from a current-news story.
Category: ${item.category}
Headline: ${item.headline}
Summary: ${item.summary}
Suggested discussion question: ${item.question}
Sources:
${sources}
Treat these sources as the initial factual context. Search again when the learner asks for newer facts or details not supported above.`;
}

export function newsVisibleOpener(item: DailyNewsItem, coachSkills: string) {
  const lower = coachSkills.toLowerCase();
  const lead = lower.includes("calm") || lower.includes("穏やか") || lower.includes("丁寧")
    ? item.coachLeads.calm
    : lower.includes("direct") || lower.includes("率直") || lower.includes("端的")
      ? item.coachLeads.direct
      : lower.includes("元気") || lower.includes("energetic")
        ? item.coachLeads.energetic
        : item.coachLeads.friendly;
  const sources = item.sources.map((source) => source.title || new URL(source.url).hostname).join(" / ");
  return `${lead}\n\n${item.summary}\n\n${item.question}\n\nSources: ${sources}`;
}
