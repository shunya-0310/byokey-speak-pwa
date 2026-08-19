import { naturalReplyOf } from "../domain/stats";
import type { VoiceGender } from "../domain/models";

type RecognitionCtor = new () => SpeechRecognition;
type WebKitNavigator = Navigator & { standalone?: boolean };
let currentGeneratedAudio: HTMLAudioElement | null = null;
let currentGeneratedAudioUrl = "";

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex?: number }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export type MicLanguage = "ja-JP" | "en-US";

export type WavRecorder = {
  stop: () => Promise<Blob>;
};

export type SpeechRecognitionSession = {
  stop: () => Promise<string>;
};

export function canRecognizeSpeech() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

export function canRecordAudio() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
}

export function isAppleMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function isStandaloneWebApp() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as WebKitNavigator).standalone === true;
}

export function isIosNonSafariBrowser() {
  if (!isAppleMobileBrowser()) return false;
  return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
}

export function shouldUseGeminiMicFallback() {
  return canRecordAudio() && (!canRecognizeSpeech() || (isAppleMobileBrowser() && (isStandaloneWebApp() || isIosNonSafariBrowser())));
}

export function listenOnce(lang: MicLanguage) {
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
    recognition.onerror = (event) => {
      const suffix = event.error ? ` (${event.error})` : "";
      reject(new Error(`音声入力に失敗しました${suffix}。`));
    };
    recognition.onend = () => undefined;
    try {
      recognition.start();
    } catch {
      reject(new Error("音声入力を開始できませんでした。"));
    }
  });
}

export function startSpeechRecognitionSession(lang: MicLanguage, onTranscript?: (text: string) => void, onError?: (error: Error) => void): SpeechRecognitionSession {
  const Ctor = ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);
  if (!Ctor) throw new Error("このブラウザは音声入力APIに対応していません。OSキーボードの音声入力を利用してください。");

  let recognition: SpeechRecognition | null = null;
  let stoppedByUser = false;
  let running = false;
  let transcript = "";
  let stopResolve: ((text: string) => void) | null = null;
  let stopReject: ((error: Error) => void) | null = null;

  const start = () => {
    if (stoppedByUser || running) return;
    recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const startIndex = event.resultIndex ?? 0;
      const additions: string[] = [];
      for (let index = startIndex; index < event.results.length; index += 1) {
        const text = event.results[index]?.[0]?.transcript?.trim();
        if (text) additions.push(text);
      }
      if (!additions.length) return;
      transcript = `${transcript}${transcript ? " " : ""}${additions.join(" ")}`.trim();
      onTranscript?.(transcript);
    };
    recognition.onerror = (event) => {
      const recoverable = event.error === "no-speech" || event.error === "audio-capture" || event.error === "network";
      if (!recoverable) {
        const suffix = event.error ? ` (${event.error})` : "";
        const error = new Error(`音声入力に失敗しました${suffix}。`);
        stoppedByUser = true;
        onError?.(error);
        stopReject?.(error);
      }
    };
    recognition.onend = () => {
      running = false;
      if (stoppedByUser) {
        stopResolve?.(transcript);
        return;
      }
      window.setTimeout(start, 250);
    };
    try {
      recognition.start();
      running = true;
    } catch {
      const error = new Error("音声入力を開始できませんでした。");
      stopReject?.(error);
      throw error;
    }
  };

  start();

  return {
    stop: () => new Promise<string>((resolve, reject) => {
      stopResolve = resolve;
      stopReject = reject;
      stoppedByUser = true;
      if (!recognition || !running) {
        resolve(transcript);
        return;
      }
      try {
        recognition.stop();
      } catch {
        resolve(transcript);
      }
      window.setTimeout(() => resolve(transcript), 1200);
    })
  };
}

export async function startWavRecorder(): Promise<WavRecorder> {
  if (!canRecordAudio()) throw new Error("このブラウザはマイク録音に対応していません。");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    event.outputBuffer.getChannelData(0).fill(0);
  };
  source.connect(processor);
  processor.connect(context.destination);

  return {
    stop: async () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      const sampleRate = context.sampleRate;
      await context.close();
      return encodeWav(chunks, sampleRate);
    }
  };
}

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const samples = mergeAudioChunks(chunks);
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mergeAudioChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
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

export function playGeneratedSpeech(input: { base64Audio: string; mimeType: string; onEnd?: () => void; rate?: number }) {
  stopSpeaking();
  const audioBytes = base64ToBytes(input.base64Audio);
  const blob = input.mimeType.startsWith("audio/pcm")
    ? new Blob([wrapPcmAsWav(audioBytes, sampleRateFromMime(input.mimeType) ?? 24000)], { type: "audio/wav" })
    : new Blob([audioBytes], { type: input.mimeType || "audio/wav" });
  currentGeneratedAudioUrl = URL.createObjectURL(blob);
  currentGeneratedAudio = new Audio(currentGeneratedAudioUrl);
  currentGeneratedAudio.playbackRate = Math.min(1.5, Math.max(0.6, input.rate ?? 1));
  currentGeneratedAudio.onended = () => {
    cleanupGeneratedAudio();
    input.onEnd?.();
  };
  currentGeneratedAudio.onerror = () => {
    cleanupGeneratedAudio();
    input.onEnd?.();
  };
  void currentGeneratedAudio.play();
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (currentGeneratedAudio) {
    currentGeneratedAudio.pause();
    currentGeneratedAudio.currentTime = 0;
    cleanupGeneratedAudio();
  }
}

function cleanupGeneratedAudio() {
  currentGeneratedAudio = null;
  if (currentGeneratedAudioUrl) {
    URL.revokeObjectURL(currentGeneratedAudioUrl);
    currentGeneratedAudioUrl = "";
  }
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function sampleRateFromMime(mimeType: string) {
  const match = mimeType.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function wrapPcmAsWav(pcmBytes: Uint8Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + pcmBytes.byteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBytes.byteLength, true);
  new Uint8Array(buffer, 44).set(pcmBytes);
  return buffer;
}
