export type GeminiLiveSession = {
  stop: () => void;
};

export type GeminiLiveStatus = "connecting" | "connected" | "listening" | "closed";

type LiveInput = {
  apiKey: string;
  model: string;
  voice: string;
  systemInstruction: string;
  onStatus: (status: GeminiLiveStatus) => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscript: (text: string) => void;
  onTurnComplete: () => void;
  onError: (error: Error) => void;
};

type LiveServerMessage = {
  error?: { message?: string };
  serverContent?: {
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
    modelTurn?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
        inline_data?: { data?: string; mime_type?: string };
      }>;
    };
  };
  setupComplete?: unknown;
};

const LIVE_INPUT_SAMPLE_RATE = 16000;

export async function startGeminiLiveSession(input: LiveInput): Promise<GeminiLiveSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new Error("このブラウザはリアルタイム音声会話に対応していません。");
  }
  const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(input.apiKey)}`;
  input.onStatus("connecting");
  const websocket = new WebSocket(endpoint);
  const player = new LivePcmPlayer();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(2048, 1, 1);
  let captureStarted = false;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      processor.disconnect();
      source.disconnect();
    } catch {
      // Already disconnected.
    }
    stream.getTracks().forEach((track) => track.stop());
    void audioContext.close();
    player.stop();
    input.onStatus("closed");
  };

  processor.onaudioprocess = (event) => {
    event.outputBuffer.getChannelData(0).fill(0);
    if (websocket.readyState !== WebSocket.OPEN) return;
    const samples = downsampleFloat32(event.inputBuffer.getChannelData(0), audioContext.sampleRate, LIVE_INPUT_SAMPLE_RATE);
    const pcm = floatToPcm16(samples);
    websocket.send(JSON.stringify({
      realtimeInput: {
        audio: {
          data: bytesToBase64(pcm),
          mimeType: `audio/pcm;rate=${LIVE_INPUT_SAMPLE_RATE}`
        }
      }
    }));
  };

  websocket.onopen = () => {
    websocket.send(JSON.stringify({
      setup: {
        model: `models/${input.model.replace(/^models\//, "")}`,
        responseModalities: ["AUDIO"],
        systemInstruction: { parts: [{ text: input.systemInstruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice || "Kore" } }
        },
        thinkingConfig: { thinkingLevel: "low" }
      }
    }));
  };

  const startCapture = () => {
    if (captureStarted || cleanedUp) return;
    captureStarted = true;
    source.connect(processor);
    processor.connect(audioContext.destination);
    void audioContext.resume();
    input.onStatus("listening");
  };

  websocket.onmessage = (event) => {
    let message: LiveServerMessage;
    try {
      message = JSON.parse(String(event.data)) as LiveServerMessage;
    } catch {
      return;
    }
    if (message.error?.message) {
      input.onError(new Error(`Gemini Live API: ${message.error.message}`));
      websocket.close();
      return;
    }
    if (message.setupComplete) {
      input.onStatus("connected");
      startCapture();
    }
    const content = message.serverContent;
    const inputText = content?.inputTranscription?.text?.trim();
    if (inputText) input.onInputTranscript(inputText);
    const outputText = content?.outputTranscription?.text?.trim();
    if (outputText) input.onOutputTranscript(outputText);
    if (content?.interrupted) player.stop();
    for (const part of content?.modelTurn?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data;
      if (inline?.data) player.enqueue(inline.data, inlineMimeType(inline));
    }
    if (content?.turnComplete) input.onTurnComplete();
  };

  websocket.onerror = () => {
    if (!cleanedUp) input.onError(new Error("Gemini Live APIの接続に失敗しました。APIキー、対応モデル、ネットワーク接続を確認してください。"));
  };
  websocket.onclose = cleanup;

  return {
    stop: () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        window.setTimeout(() => websocket.close(), 250);
      } else {
        websocket.close();
      }
    }
  };
}

class LivePcmPlayer {
  private context: AudioContext | null = null;
  private nextStartTime = 0;

  enqueue(base64: string, mimeType: string) {
    if (typeof AudioContext === "undefined") return;
    const sampleRate = sampleRateFromMime(mimeType) ?? 24000;
    this.context ??= new AudioContext();
    const pcm = base64ToBytes(base64);
    const samples = pcm16ToFloat32(pcm);
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime + 0.02, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
  }

  stop() {
    if (this.context) void this.context.close();
    this.context = null;
    this.nextStartTime = 0;
  }
}

function floatToPcm16(floatData: Float32Array) {
  const bytes = new Uint8Array(floatData.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < floatData.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, floatData[index]));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

function downsampleFloat32(samples: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate <= targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += samples[cursor];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function pcm16ToFloat32(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

function inlineMimeType(inline: { data?: string; mimeType?: string } | { data?: string; mime_type?: string }) {
  const value = inline as { mimeType?: string; mime_type?: string };
  return value.mimeType ?? value.mime_type ?? "audio/pcm;rate=24000";
}
