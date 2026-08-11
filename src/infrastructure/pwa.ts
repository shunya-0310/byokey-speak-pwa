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

export function isTrustedPersistentOrigin() {
  return ["localhost", "127.0.0.1", "speak.byokey-lab.com", "byokey-speak-pwa.pages.dev"].includes(location.hostname);
}
