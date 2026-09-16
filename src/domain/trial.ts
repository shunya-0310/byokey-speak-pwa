import type { EnglishLevel, SpeechOutputProvider } from "./models";

/** PWA は無償の体験版として提供する。API 利用料は利用者と Google の間で発生する。 */
export const TRIAL_EDITION = {
  name: "PWA体験版",
  playStoreUrl: "https://play.google.com/store/apps/details?id=com.byokeylab.speak",
  allowedEnglishLevels: ["A1", "A2"] as const,
  analysisEnabled: false,
  geminiTtsEnabled: true
} as const;

export function canUseTrialGeminiTts() {
  return TRIAL_EDITION.geminiTtsEnabled;
}

export function isTrialEnglishLevel(level: EnglishLevel): level is (typeof TRIAL_EDITION.allowedEnglishLevels)[number] {
  return (TRIAL_EDITION.allowedEnglishLevels as readonly EnglishLevel[]).includes(level);
}

export function normalizeTrialEnglishLevel(level: EnglishLevel): EnglishLevel {
  return isTrialEnglishLevel(level) ? level : "A2";
}

/** Gemini TTS is available in the trial; keep the visitor's selected output method. */
export function normalizeTrialSpeechOutputProvider(provider: SpeechOutputProvider): SpeechOutputProvider {
  return provider;
}
