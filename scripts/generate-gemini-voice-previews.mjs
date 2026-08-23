import { mkdir, stat, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const voices = [
  "Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"
];

const apiKey = process.env.gemini_tts_voice ?? process.env.GEMINI_TTS_VOICE;
if (!apiKey?.trim()) {
  throw new Error("gemini_tts_voice 環境変数が見つかりません。値を表示・保存せずに終了しました。");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "public", "voice-previews");
const model = "gemini-3.1-flash-tts-preview";
const sampleText = "Hello! I am your English coach. Let’s practice together.";
const prompt = `Read aloud naturally as a warm English conversation coach. Keep the pacing clear and expressive:\n\n${sampleText}`;
const force = process.argv.includes("--force");
const fetchFromNode = globalThis.fetch;

await mkdir(outputDir, { recursive: true });
const generated = [];
for (const voice of voices) {
  const filename = `${voice.toLowerCase()}.wav`;
  const outputPath = path.join(outputDir, filename);
  if (!force && await exists(outputPath)) {
    console.log(`skip ${voice} (already exists)`);
    generated.push({ voice, file: filename, status: "existing" });
    continue;
  }

  console.log(`generate ${voice}`);
  const response = await fetchFromNode("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey.trim()
    },
    body: JSON.stringify({
      model,
      input: prompt,
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice }] }
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${voice}: Gemini TTS request failed (${response.status}).`);
  const audio = findAudio(JSON.parse(raw));
  if (!audio?.data) throw new Error(`${voice}: Gemini TTS response did not include audio.`);
  const pcm = Buffer.from(audio.data, "base64");
  const sampleRate = audio.sampleRate ?? sampleRateFromMime(audio.mimeType) ?? 24000;
  const channels = audio.channels ?? 1;
  await writeFile(outputPath, pcmToWav(pcm, sampleRate, channels));
  const bytes = (await stat(outputPath)).size;
  generated.push({ voice, file: filename, status: "generated", bytes, sampleRate, channels });
}

await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({
  generatedWith: model,
  sampleText,
  format: "WAV / 16-bit PCM",
  note: "Bundled Gemini voice samples. Playback does not invoke the Gemini API.",
  voices: generated
}, null, 2)}\n`, "utf8");
console.log(`complete: ${generated.filter((item) => item.status === "generated").length} generated, ${generated.length} total`);

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (caught) {
    if (caught && typeof caught === "object" && "code" in caught && caught.code === "ENOENT") return false;
    throw caught;
  }
}

function findAudio(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findAudio(child);
      if (found) return found;
    }
    return null;
  }
  const record = value;
  const data = typeof record.data === "string" ? record.data : null;
  if (data && (record.type === "audio" || record.mime_type || record.mimeType)) {
    return {
      data,
      mimeType: typeof record.mime_type === "string" ? record.mime_type : record.mimeType,
      sampleRate: typeof record.sample_rate === "number" ? record.sample_rate : record.sampleRate,
      channels: typeof record.channels === "number" ? record.channels : undefined
    };
  }
  for (const child of Object.values(record)) {
    const found = findAudio(child);
    if (found) return found;
  }
  return null;
}

function sampleRateFromMime(mimeType) {
  const match = typeof mimeType === "string" ? mimeType.match(/rate=(\d+)/i) : null;
  return match ? Number(match[1]) : undefined;
}

function pcmToWav(pcm, sampleRate, channels) {
  const buffer = Buffer.alloc(44 + pcm.length);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcm.length, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcm.length, 40);
  pcm.copy(buffer, 44);
  return buffer;
}
