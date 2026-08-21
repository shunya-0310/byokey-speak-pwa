export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return undefined;
  return navigator.storage.persist();
}

export async function persistentStorageStatus() {
  if (!navigator.storage?.persisted) return undefined;
  return navigator.storage.persisted();
}

export function isPreviewOrigin() {
  return location.hostname.endsWith(".pages.dev") && location.hostname !== "byokey-speak-pwa.pages.dev";
}

export function isTrustedPersistentHostname(hostname: string) {
  // The Gemini voice preview is intentionally a stable, shareable Pages URL.
  // It is still a local-first BYOK app: this only permits IndexedDB storage in
  // the visitor's browser and never sends a key to BYOKey Lab.
  return [
    "localhost",
    "127.0.0.1",
    "speak.byokey-lab.com",
    "byokey-speak-pwa.pages.dev",
    "preview-gemini-voice.byokey-speak-pwa.pages.dev"
  ].includes(hostname);
}

export function isTrustedPersistentOrigin() {
  return isTrustedPersistentHostname(location.hostname);
}
