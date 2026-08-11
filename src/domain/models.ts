export type ThemeMode = "dark" | "light";
export type EnglishLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type VoiceMode = "off" | "manual" | "fullAuto";
export type VoiceGender = "female" | "male";
export type MessageRole = "user" | "coach" | "system";
export type MessageInputSource = "TYPED" | "VOICE" | "QUICK_ASSIST" | "MIXED" | "NONE" | "UNKNOWN";
export type ConversationOrigin = "FREE_CHAT" | "TOPIC" | "DAILY_NEWS" | "MIGRATED_COACH";
export type VocabSource = "Coach" | "Chats" | "QuickAssist" | "Manual";

export const GEMINI_MODELS = [
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", recommended: true },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", recommended: false },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", recommended: false }
] as const;

export const DEFAULT_COACH_SKILLS = `# Coach Skills

## 目的
- ビジネスではなく日常会話を強化したい。

## 性格・口調
- かしこまった話し方ではなく、フランクに話す。
- スラングや気の利いた言い回しをよく使う。

## 添削方針
- 通じるけどネイティブは使わない表現も、「ネイティブではこうだよ」と細かく指摘する。

## 解説の言語
- 解説部分だけは英語だけでなく日本語も併記する。`;

export interface AppSettings {
  model: string;
  apiKeyMode: "persistent" | "session";
  hasApiKey: boolean;
  englishLevel: EnglishLevel;
  coachSkills: string;
  theme: ThemeMode;
  voiceMode: VoiceMode;
  voiceGender: VoiceGender;
  voiceRate: number;
  soundEffectsEnabled: boolean;
  onboardingDone: boolean;
  consentVersion: number;
  consentAt?: string;
  analysisConsentDone: boolean;
  lastOpenedChatId?: string;
  persistentStorageGranted?: boolean;
}

export interface Chat {
  id: string;
  title: string;
  origin: ConversationOrigin;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  newsContext?: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: MessageRole;
  text: string;
  inputSource: MessageInputSource;
  usedQuickAssist: boolean;
  sources?: LlmSource[];
  createdAt: number;
}

export interface VocabCard {
  id: string;
  expression: string;
  meaning: string;
  source: VocabSource;
  chatId?: string;
  favorite: boolean;
  usageCount: number;
  reviewed: boolean;
  createdAt: number;
}

export interface LearningNote {
  id: string;
  chatId?: string;
  sourceMessage: string;
  coachNotes: string;
  betterOptions: string;
  japaneseNote: string;
  reviewed: boolean;
  createdAt: number;
}

export interface DailyStat {
  epochDay: number;
  turns: number;
  assistUses: number;
  notesSaved: number;
  reviewsDone: number;
}

export interface AnalysisPoint {
  title: string;
  evidence?: string[];
  comment: string;
}

export interface RecurringPattern {
  category: "grammar" | "naturalness" | "vocabulary" | "conversation";
  title: string;
  occurrences: number;
  examples: Array<{ original: string; suggestion: string; explanationJa: string }>;
  nextAction: string;
}

export interface ConversationAnalysisResult {
  summary: string;
  estimatedCefr: EnglishLevel | "判定保留";
  cefrRationale: string;
  strengths: AnalysisPoint[];
  recurringPatterns: RecurringPattern[];
  improvements: AnalysisPoint[];
  nextFocus: string[];
  levelUpPlan: string[];
  practicePrompts: string[];
}

export interface ConversationAnalysis {
  id: string;
  createdAt: number;
  periodStart: number;
  periodEnd: number;
  userMessageCount: number;
  provider: "Gemini";
  model: string;
  result: ConversationAnalysisResult;
}

export interface LlmSource {
  title: string;
  url: string;
}

export interface CoachReply {
  reply: string;
  coachNote?: string;
  japaneseExplanation?: string;
  betterOptions: string[];
  vocabulary: Array<{ expression: string; meaning: string }>;
  sources: LlmSource[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  model: GEMINI_MODELS[0].id,
  apiKeyMode: "persistent",
  hasApiKey: false,
  englishLevel: "A1",
  coachSkills: DEFAULT_COACH_SKILLS,
  theme: "dark",
  voiceMode: "manual",
  voiceGender: "female",
  voiceRate: 1,
  soundEffectsEnabled: true,
  onboardingDone: false,
  consentVersion: 0,
  analysisConsentDone: false
};
