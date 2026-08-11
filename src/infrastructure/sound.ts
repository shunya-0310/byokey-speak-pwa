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

const activeStreams = new Map<AppSound, HTMLAudioElement>();

export function playAppSound(sound: AppSound, enabled = true) {
  if (!enabled || typeof Audio === "undefined") return;
  const previous = activeStreams.get(sound);
  if (previous) {
    previous.pause();
    previous.currentTime = 0;
  }
  const audio = new Audio(soundFiles[sound]);
  audio.volume = soundVolumes[sound];
  activeStreams.set(sound, audio);
  void audio.play().catch(() => {
    // Browser autoplay rules can block sounds until the first user gesture.
  });
}
