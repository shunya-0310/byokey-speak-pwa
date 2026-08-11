import { conversationAnalysisSchema } from "../domain/schemas";
import type { CoachReply, ConversationAnalysisResult, LlmSource } from "../domain/models";

export type LlmErrorKind = "missing_api_key" | "invalid_api_key" | "invalid_model" | "billing" | "rate_limit" | "network" | "provider" | "unknown";

export class LlmError extends Error {
  constructor(public readonly kind: LlmErrorKind, message: string) {
    super(message);
  }
}

export function classifyGeminiError(status: number, body: string): LlmErrorKind {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 404) return "invalid_model";
  if (status === 402) return "billing";
  if (status === 429 && (lower.includes("quota") || lower.includes("billing"))) return "billing";
  if (status === 429) return "rate_limit";
  if (status === 400 && lower.includes("model")) return "invalid_model";
  if (status === 400 && (lower.includes("api key") || lower.includes("api_key"))) return "invalid_api_key";
  if (status >= 500) return "provider";
  return "unknown";
}

export function userMessageForError(kind: LlmErrorKind) {
  return {
    missing_api_key: "Gemini APIキーを設定してください。",
    invalid_api_key: "APIキーが無効、または権限がありません。",
    invalid_model: "モデルIDが無効、または利用できません。",
    billing: "利用枠、課金、クォータをGoogle側で確認してください。",
    rate_limit: "リクエストが多すぎます。少し時間を置いてください。",
    network: "通信に失敗しました。接続状況を確認してください。",
    provider: "Gemini側で一時的な問題が発生しました。",
    unknown: "Gemini呼び出しに失敗しました。"
  }[kind];
}

export async function generateWithGemini(input: {
  apiKey: string;
  model: string;
  prompt: string;
  webSearchEnabled?: boolean;
}) {
  if (!input.apiKey.trim()) throw new LlmError("missing_api_key", userMessageForError("missing_api_key"));
  const model = input.model.trim().replace(/^models\//, "") || "gemini-3.1-flash-lite";
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: input.prompt }] }]
  };
  if (input.webSearchEnabled) body.tools = [{ google_search: {} }];

  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: JSON.stringify(body),
      cache: "no-store"
    });
  } catch {
    throw new LlmError("network", userMessageForError("network"));
  }

  const raw = await response.text();
  if (!response.ok) {
    const kind = classifyGeminiError(response.status, raw);
    throw new LlmError(kind, userMessageForError(kind));
  }
  const json = JSON.parse(raw);
  return {
    text: collectTexts(json).trim(),
    sources: collectSources(json)
  };
}

export async function testGeminiConnection(apiKey: string, model: string) {
  const result = await generateWithGemini({ apiKey, model, prompt: "Reply with exactly: OK" });
  return result.text.toLowerCase().includes("ok");
}

export function parseCoachReply(raw: string, sources: LlmSource[] = []): CoachReply {
  const section = (label: string, nextLabels: string[]) => {
    const lower = raw.toLowerCase();
    const startLabel = `${label.toLowerCase()}:`;
    const start = lower.indexOf(startLabel);
    if (start < 0) return "";
    const from = start + startLabel.length;
    const end = nextLabels
      .map((next) => lower.indexOf(`${next.toLowerCase()}:`, from))
      .filter((index) => index > from)
      .sort((a, b) => a - b)[0] ?? raw.length;
    return raw.slice(from, end).trim();
  };
  const better = section("Better options", ["Vocab"]).split(/\r?\n/).map((line) => line.replace(/^[-*\d.\s]+/, "").trim()).filter((line) => line && !/^none$/i.test(line));
  const vocab = [...raw.matchAll(/^Vocab:\s*(.+?)\s*\|\s*(.+)$/gim)].map((match) => ({ expression: match[1].trim(), meaning: match[2].trim() }));
  const reply = section("Natural reply", ["Coach notes", "Japanese explanation", "Better options", "Vocab"]) || raw.trim();
  const note = section("Coach notes", ["Japanese explanation", "Better options", "Vocab"]);
  const explanation = section("Japanese explanation", ["Better options", "Vocab"]);
  return {
    reply,
    coachNote: /^none$/i.test(note) ? "" : note,
    japaneseExplanation: /^none$/i.test(explanation) ? "" : explanation,
    betterOptions: better,
    vocabulary: vocab,
    sources
  };
}

export function parseAnalysis(raw: string): ConversationAnalysisResult {
  const parsed = conversationAnalysisSchema.parse(JSON.parse(raw));
  return parsed;
}

function collectTexts(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return "";
  if (Array.isArray(value)) return value.map(collectTexts).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ownText = typeof record.text === "string" ? record.text : "";
    return [ownText, ...Object.entries(record).filter(([key]) => key !== "text").map(([, child]) => collectTexts(child))].filter(Boolean).join("\n");
  }
  return "";
}

function collectSources(value: unknown, output = new Map<string, LlmSource>()): LlmSource[] {
  if (!value) return [...output.values()].slice(0, 6);
  if (Array.isArray(value)) {
    value.forEach((item) => collectSources(item, output));
    return [...output.values()].slice(0, 6);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const url = [record.url, record.uri].find((item): item is string => typeof item === "string" && item.startsWith("https://"));
    if (url && !output.has(url)) {
      const title = [record.title, record.name].find((item): item is string => typeof item === "string" && item.trim().length > 0) ?? url;
      output.set(url, { title, url });
    }
    Object.values(record).forEach((child) => collectSources(child, output));
  }
  return [...output.values()].slice(0, 6);
}
