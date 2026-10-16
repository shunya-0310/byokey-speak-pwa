import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
const { model, style } = JSON.parse(await readFile(path.join(root, "src", "domain", "tts-config.json"), "utf8"));
const sampleText = "Hello! I am your English coach. Let’s practice together.";
const force = process.argv.includes("--force");
const fetchFromNode = globalThis.fetch;
const manifestPath = path.join(outputDir, "manifest.json");
const previousManifest = JSON.parse(await readFile(manifestPath, "utf8"));
const previousVoices = new Map(previousManifest.voices.map((item) => [item.file, item]));

await mkdir(outputDir, { recursive: true });
const generated = [];
for (const voice of voices) {
  const filename = `${voice.toLowerCase()}.wav`;
  const outputPath = path.join(outputDir, filename);
  if (!force && await exists(outputPath)) {
    console.log(`skip ${voice} (already exists)`);
    const previous = previousVoices.get(filename);
    if (!previous?.model && !previousManifest.generatedWith) throw new Error(`${voice}: existing file has no known generation model.`);
    generated.push({ ...previous, voice, file: filename, status: "existing", model: previous?.model ?? previousManifest.generatedWith });
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
      input: [{ type: "user_input", content: [{ type: "text", text: sampleText, annotations: [{ type: "speech_metadata", style }] }] }],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice }] }
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${voice}: Gemini TTS request failed (${response.status}).`);
  const audio = findAudio(JSON.parse(raw));
  if (!audio?.data) throw new Error(`${voice}: Gemini TTS response did not include audio.`);
  if (!/^audio\/l16(?:;|$)/i.test(audio.mimeType ?? "") || (audio.sampleRate != null && audio.sampleRate !== 24000) || (audio.channels != null && audio.channels !== 1)) {
    throw new Error(`${voice}: unexpected audio format.`);
  }
  const pcm = Buffer.from(audio.data, "base64");
  if (!pcm.length || pcm.length % 2 || pcm.toString("ascii", 0, 4) === "RIFF") throw new Error(`${voice}: expected raw PCM audio.`);
  const sampleRate = audio.sampleRate ?? sampleRateFromMime(audio.mimeType) ?? 24000;
  const channels = audio.channels ?? 1;
  await writeFile(outputPath, pcmToWav(pcm, sampleRate, channels));
  const bytes = (await stat(outputPath)).size;
  generated.push({ voice, file: filename, status: "generated", model, bytes, sampleRate, channels });
}

await writeFile(manifestPath, `${JSON.stringify({
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
