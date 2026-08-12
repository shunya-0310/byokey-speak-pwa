export type AppSound = "decision" | "select" | "pages" | "messageSend" | "messageReceive";

const soundFiles: Record<AppSound, string> = {
  decision: "/sounds/decision.mp3",
  select: "/sounds/select.mp3",
  pages: "/sounds/pages.mp3",
  messageSend: "/sounds/message_send.mp3",
  messageReceive: "/sounds/message_receive.mp3"
};

const soundVolumes: Record<AppSound, number> = {
  decision: 0.58,
  select: 0.62,
  pages: 0.98,
  messageSend: 0.52,
  messageReceive: 0.52
};

type BrowserAudioContext = typeof AudioContext;

const soundBuffers = new Map<AppSound, AudioBuffer>();
const soundLoads = new Map<AppSound, Promise<AudioBuffer>>();
let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: BrowserAudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  audioContext ??= new AudioContextClass({ latencyHint: "interactive" });
  return audioContext;
}

async function loadSound(sound: AppSound) {
  const cached = soundBuffers.get(sound);
  if (cached) return cached;
  const existing = soundLoads.get(sound);
  if (existing) return existing;
  const context = getAudioContext();
  if (!context) throw new Error("AudioContext is not available.");
  const loading = fetch(soundFiles[sound])
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load sound: ${sound}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
    .then((buffer) => {
      soundBuffers.set(sound, buffer);
      return buffer;
    })
    .finally(() => {
      soundLoads.delete(sound);
    });
  soundLoads.set(sound, loading);
  return loading;
}

export function primeAppSounds(enabled = true) {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;
  void context.resume().catch(() => {
    // Some browsers keep the context suspended until a stronger user gesture.
  });
  (Object.keys(soundFiles) as AppSound[]).forEach((sound) => {
    void loadSound(sound).catch(() => {
      // Missing sound assets should not block the app UI.
    });
  });
}

function playDecodedBuffer(sound: AppSound, buffer: AudioBuffer, context: AudioContext) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = soundVolumes[sound];
  source.connect(gain).connect(context.destination);
  source.start();
}

export function playAppSound(sound: AppSound, enabled = true) {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;
  void context.resume().catch(() => {
    // Browser autoplay rules can block sounds until the first user gesture.
  });
  const cached = soundBuffers.get(sound);
  if (cached) {
    playDecodedBuffer(sound, cached, context);
    return;
  }
  void loadSound(sound).then((buffer) => {
    playDecodedBuffer(sound, buffer, context);
  }).catch(() => {
    // Sound effects are decorative; keep interaction responsive even when blocked.
  });
}
