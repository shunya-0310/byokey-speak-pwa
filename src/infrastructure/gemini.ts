import { conversationAnalysisSchema } from "../domain/schemas";
import type { CoachReply, ConversationAnalysisResult, LlmSource } from "../domain/models";
import { DEFAULT_GEMINI_TTS_MODEL } from "../domain/models";
import ttsConfig from "../domain/tts-config.json";

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

export async function transcribeAudioWithGemini(input: {
  apiKey: string;
  model: string;
  audio: Blob;
  language: "ja-JP" | "en-US";
}) {
  if (!input.apiKey.trim()) throw new LlmError("missing_api_key", userMessageForError("missing_api_key"));
  const model = input.model.trim().replace(/^models\//, "") || "gemini-3.1-flash-lite";
  const languageLabel = input.language === "ja-JP" ? "Japanese" : "English";
  const body = {
    contents: [{
      parts: [
        {
          text: [
            `Transcribe the spoken ${languageLabel} in this audio.`,
            "Return only the transcript text.",
            "Do not translate, explain, summarize, add punctuation unless it is clearly spoken, or wrap the answer in quotes.",
            "If no speech is audible, return an empty string."
          ].join("\n")
        },
        {
          inlineData: {
            mimeType: input.audio.type || "audio/wav",
            data: await blobToBase64(input.audio)
          }
        }
      ]
    }]
  };

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
  return collectTexts(JSON.parse(raw)).trim().replace(/^["「]|["」]$/g, "");
}

export type GeneratedSpeech = {
  data: string;
  mimeType: string;
  sampleRate?: number;
  channels?: number;
};

type SpeechChunk = GeneratedSpeech;

const TTS_STYLE = ttsConfig.style;

function speechRequestBody(input: { model: string; text: string; voice: string }, stream = false) {
  return {
    model: input.model.trim().replace(/^models\//, "") || DEFAULT_GEMINI_TTS_MODEL,
    input: [{ type: "user_input", content: [{ type: "text", text: input.text.trim(), annotations: [{ type: "speech_metadata", style: TTS_STYLE }] }] }],
    response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24000 },
    generation_config: { speech_config: [{ voice: input.voice || "Kore" }] },
    ...(stream ? { stream: true } : {})
  };
}

function validatePcmFormat(audio: GeneratedSpeech) {
  const mime = audio.mimeType.toLowerCase();
  const rate = /(?:^|;)\s*rate=(\d+)/.exec(mime);
  const channels = /(?:^|;)\s*channels=(\d+)/.exec(mime);
  if (!/^audio\/l16(?:;|$)/.test(mime) || (rate && Number(rate[1]) !== 24000) || (channels && Number(channels[1]) !== 1) || (audio.sampleRate != null && audio.sampleRate !== 24000) || (audio.channels != null && audio.channels !== 1)) {
    throw new LlmError("provider", "Gemini TTSの音声形式が想定と異なります。再生を停止しました。");
  }
}

export function validatePcmSpeech(audio: GeneratedSpeech): GeneratedSpeech {
  validatePcmFormat(audio);
  const bytes = base64ToBytes(audio.data);
  if (!bytes.length || bytes.length % 2 || (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF")) {
    throw new LlmError("provider", "Gemini TTSの音声データがPCM形式ではありません。再生を停止しました。");
  }
  return audio;
}

export async function generateSpeechWithGemini(input: {
  apiKey: string;
  model: string;
  text: string;
  voice: string;
  signal?: AbortSignal;
}): Promise<GeneratedSpeech> {
  if (!input.apiKey.trim()) throw new LlmError("missing_api_key", userMessageForError("missing_api_key"));
  const text = input.text.trim();
  if (!text) throw new LlmError("unknown", "読み上げるテキストがありません。");
  const body = speechRequestBody({ ...input, text });

  let response: Response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: input.signal
    });
  } catch (caught) {
    if (input.signal?.aborted) throw caught;
    throw new LlmError("network", userMessageForError("network"));
  }

  const raw = await response.text();
  if (!response.ok) {
    const kind = classifyGeminiError(response.status, raw);
    throw new LlmError(kind, userMessageForError(kind));
  }
  const audio = collectAudio(JSON.parse(raw));
  if (!audio?.data) throw new LlmError("provider", "Gemini TTSの音声データを取得できませんでした。");
  return validatePcmSpeech({
    data: audio.data,
    mimeType: audio.mimeType || "audio/l16;rate=24000",
    sampleRate: audio.sampleRate,
    channels: audio.channels
  });
}

/** Streams validated raw PCM chunks directly from Gemini TTS. */
export async function streamSpeechWithGemini(input: {
  apiKey: string;
  model: string;
  text: string;
  voice: string;
  signal?: AbortSignal;
  onAudio: (chunk: SpeechChunk) => void;
}): Promise<GeneratedSpeech> {
  if (!input.apiKey.trim()) throw new LlmError("missing_api_key", userMessageForError("missing_api_key"));
  const text = input.text.trim();
  if (!text) throw new LlmError("unknown", "読み上げるテキストがありません。");
  const body = speechRequestBody({ ...input, text }, true);
  let response: Response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: input.signal
    });
  } catch (caught) {
    if (input.signal?.aborted) throw caught;
    throw new LlmError("network", userMessageForError("network"));
  }
  if (!response.ok) {
    const raw = await response.text();
    const kind = classifyGeminiError(response.status, raw);
    throw new LlmError(kind, userMessageForError(kind));
  }
  if (!response.body) throw new LlmError("provider", "Gemini TTSのストリームを開始できませんでした。");

  const chunks: SpeechChunk[] = [];
  let completed = false;
  let pendingByte: number | undefined;
  let initialBytes = new Uint8Array(0);
  await readSseJson(response.body, (payload) => {
    const event = payload as { event_type?: string; interaction?: { status?: string } };
    if (event.event_type === "error" || event.event_type === "interaction.failed") throw new LlmError("provider", "Gemini TTSのストリームが失敗しました。");
    if (event.event_type === "interaction.completed") {
      if (event.interaction?.status !== "completed") throw new LlmError("provider", "Gemini TTSが正常終了しませんでした。");
      completed = true;
      return;
    }
    if (event.event_type !== "step.delta") return;
    if (completed) throw new LlmError("provider", "Gemini TTSの完了後に音声を受信しました。");
    const audio = collectAudio(payload);
    if (!audio?.data) return;
    const metadata: SpeechChunk = {
      data: audio.data,
      mimeType: audio.mimeType || "audio/l16;rate=24000",
      sampleRate: audio.sampleRate,
      channels: audio.channels
    };
    validatePcmFormat(metadata);
    const incoming = base64ToBytes(metadata.data);
    const bytes = new Uint8Array(incoming.length + (pendingByte == null ? 0 : 1));
    if (pendingByte != null) bytes[0] = pendingByte;
    bytes.set(incoming, pendingByte == null ? 0 : 1);
    pendingByte = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
    let complete = bytes.subarray(0, bytes.length - (pendingByte == null ? 0 : 1));
    if (!complete.length) return;
    if (!chunks.length) {
      const first = new Uint8Array(initialBytes.length + complete.length);
      first.set(initialBytes);
      first.set(complete, initialBytes.length);
      if (first.length < 4) {
        initialBytes = first;
        return;
      }
      complete = first;
      initialBytes = new Uint8Array(0);
    }
    const chunk = validatePcmSpeech({ ...metadata, data: bytesToBase64(complete) });
    chunks.push(chunk);
    input.onAudio(chunk);
  }, input.signal);
  if (!completed || !chunks.length || pendingByte != null || input.signal?.aborted) throw new LlmError("provider", "Gemini TTSの音声ストリームが正常終了しませんでした。");
  const first = chunks[0];
  return {
    data: concatBase64Pcm(chunks.map((chunk) => chunk.data)),
    mimeType: first.mimeType,
    sampleRate: first.sampleRate,
    channels: first.channels
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

type AudioPayload = {
  data: string;
  mimeType?: string;
  sampleRate?: number;
  channels?: number;
};

function collectAudio(value: unknown): AudioPayload | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = collectAudio(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const outputAudio = (record.output_audio ?? record.outputAudio) as Record<string, unknown> | undefined;
  const outputAudioPayload = audioPayload(outputAudio);
  if (outputAudioPayload) return outputAudioPayload;
  // Interactions REST responses return audio in a model_output step's content
  // array. output_audio is a convenience property added by the SDK, so it is
  // absent when this browser app calls the REST endpoint directly.
  if (record.type === "audio") {
    const contentAudioPayload = audioPayload(record);
    if (contentAudioPayload) return contentAudioPayload;
  }
  const inlineData = (record.inlineData ?? record.inline_data) as Record<string, unknown> | undefined;
  const inlineAudioPayload = audioPayload(inlineData);
  if (inlineAudioPayload) return inlineAudioPayload;
  for (const child of Object.values(record)) {
    const found = collectAudio(child);
    if (found) return found;
  }
  return null;
}

function audioPayload(value: Record<string, unknown> | undefined): AudioPayload | null {
  if (!value || typeof value.data !== "string" || !value.data) return null;
  const mimeType = typeof value.mimeType === "string"
    ? value.mimeType
    : typeof value.mime_type === "string"
      ? value.mime_type
      : undefined;
  const sampleRate = typeof value.sampleRate === "number"
    ? value.sampleRate
    : typeof value.sample_rate === "number"
      ? value.sample_rate
      : undefined;
  return {
    data: value.data,
    mimeType,
    sampleRate,
    channels: typeof value.channels === "number" ? value.channels : undefined
  };
}

async function readSseJson(stream: ReadableStream<Uint8Array>, onEvent: (payload: unknown) => void, signal?: AbortSignal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() ?? "";
      for (const event of events) parseSseEvent(event, onEvent);
      if (done) break;
    }
    pending += decoder.decode();
    if (pending.trim()) parseSseEvent(pending, onEvent);
  } finally {
    reader.releaseLock();
  }
}

function parseSseEvent(event: string, onEvent: (payload: unknown) => void) {
  const data = event.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return;
  let payload: unknown;
  try { payload = JSON.parse(data); }
  catch { throw new LlmError("provider", "Gemini TTSの応答を解析できませんでした。"); }
  onEvent(payload);
}

function concatBase64Pcm(parts: string[]) {
  const bytes = parts.map(base64ToBytes);
  const totalLength = bytes.reduce((total, part) => total + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of bytes) {
    merged.set(part, offset);
    offset += part.length;
  }
  return bytesToBase64(merged);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("音声データの変換に失敗しました。"));
    reader.readAsDataURL(blob);
  });
}
