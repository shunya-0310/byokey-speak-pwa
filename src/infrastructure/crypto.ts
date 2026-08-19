import { db } from "./db";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const KEY_ID = "origin-aes-gcm-key";
const API_KEY_ID = "gemini-api-key";

export interface EncryptedEnvelope {
  formatVersion: 1;
  cipher: "AES-256-GCM";
  iv: string;
  ciphertext: string;
}

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...array));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function originKey() {
  const existing = await db.secrets.get(KEY_ID);
  if (existing?.value instanceof CryptoKey) return existing.value;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await db.secrets.put({ id: KEY_ID, value: key });
  return key;
}

function asArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function encryptText(plain: string): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await originKey(), textEncoder.encode(plain));
  return { formatVersion: 1, cipher: "AES-256-GCM", iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptText(envelope: EncryptedEnvelope) {
  if (envelope.formatVersion !== 1 || envelope.cipher !== "AES-256-GCM") throw new Error("暗号化形式が不正です。");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) }, await originKey(), fromBase64(envelope.ciphertext));
  return textDecoder.decode(plain);
}

export async function savePersistentApiKey(apiKey: string) {
  await db.secrets.put({ id: API_KEY_ID, value: await encryptText(apiKey) });
}

export async function loadPersistentApiKey() {
  const row = await db.secrets.get(API_KEY_ID);
  if (!row?.value) return "";
  return decryptText(row.value as EncryptedEnvelope);
}

export async function clearPersistentApiKey() {
  await db.secrets.delete(API_KEY_ID);
}

export function saveSessionApiKey(apiKey: string) {
  sessionStorage.setItem("byokey_speak_session_key", apiKey);
}

export function loadSessionApiKey() {
  return sessionStorage.getItem("byokey_speak_session_key") ?? "";
}

export function clearSessionApiKey() {
  sessionStorage.removeItem("byokey_speak_session_key");
}

export async function getActiveApiKey(mode: "persistent" | "session") {
  if (mode === "session") {
    const sessionKey = loadSessionApiKey();
    if (sessionKey) return sessionKey;
    return loadPersistentApiKey().catch(() => "");
  }
  const persistentKey = await loadPersistentApiKey().catch(() => "");
  return persistentKey || loadSessionApiKey();
}

export async function deriveBackupKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey("raw", textEncoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: asArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBackupJson(plainJson: string, passphrase: string) {
  if (passphrase.length < 8) throw new Error("パスフレーズは8文字以上で入力してください。");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 210_000;
  const key = await deriveBackupKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(plainJson));
  return JSON.stringify({
    formatVersion: 1,
    cipher: "AES-256-GCM",
    kdf: "PBKDF2-HMAC-SHA256",
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  });
}

export async function decryptBackupJson(envelopeText: string, passphrase: string) {
  const envelope = JSON.parse(envelopeText) as {
    formatVersion: number;
    cipher: string;
    kdf: string;
    iterations: number;
    salt: string;
    iv: string;
    ciphertext: string;
  };
  if (envelope.formatVersion !== 1 || envelope.cipher !== "AES-256-GCM" || envelope.kdf !== "PBKDF2-HMAC-SHA256") {
    throw new Error("このバックアップ形式には対応していません。");
  }
  if (envelope.iterations < 100_000 || envelope.iterations > 1_000_000) throw new Error("暗号化パラメータが不正です。");
  const key = await deriveBackupKey(passphrase, fromBase64(envelope.salt), envelope.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ciphertext));
    return textDecoder.decode(plain);
  } catch {
    throw new Error("パスフレーズが違うか、ファイルが破損しています。");
  }
}
