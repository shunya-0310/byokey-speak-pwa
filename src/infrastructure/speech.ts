import { naturalReplyOf } from "../domain/stats";
import type { VoiceGender } from "../domain/models";

type RecognitionCtor = new () => SpeechRecognition;

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export function canRecognizeSpeech() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

export function listenOnce(lang: "ja-JP" | "en-US") {
  return new Promise<string>((resolve, reject) => {
    const Ctor = ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);
    if (!Ctor) {
      reject(new Error("このブラウザは音声入力APIに対応していません。OSキーボードの音声入力を利用してください。"));
      return;
    }
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => resolve(event.results[0]?.[0]?.transcript ?? "");
    recognition.onerror = () => reject(new Error("音声入力に失敗しました。"));
    recognition.onend = () => undefined;
    recognition.start();
  });
}

export function speakCoachText(text: string, gender: VoiceGender, onEnd?: () => void, rate = 1) {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(naturalReplyOf(text));
  utterance.lang = "en-US";
  utterance.rate = Math.min(1.5, Math.max(0.6, rate));
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((voice) => voice.lang.startsWith("en") && voice.name.toLowerCase().includes(gender === "female" ? "female" : "male"))
    ?? voices.find((voice) => voice.lang.startsWith("en"));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
