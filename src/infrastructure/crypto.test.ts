import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { decryptBackupJson, encryptBackupJson, getActiveApiKey, savePersistentApiKey, saveSessionApiKey } from "./crypto";

beforeEach(async () => {
  sessionStorage.clear();
  await db.secrets.clear();
});

describe("backup crypto", () => {
  it("round trips encrypted backup data", async () => {
    const encrypted = await encryptBackupJson(JSON.stringify({ hello: "world" }), "12345678");
    expect(encrypted).not.toContain("world");
    await expect(decryptBackupJson(encrypted, "12345678")).resolves.toContain("world");
    await expect(decryptBackupJson(encrypted, "wrongpass")).rejects.toThrow();
  });

  it("falls back to the other local API key store when the selected mode is empty", async () => {
    saveSessionApiKey("session-key");
    await expect(getActiveApiKey("persistent")).resolves.toBe("session-key");
    sessionStorage.clear();

    await savePersistentApiKey("persistent-key");
    await expect(getActiveApiKey("session")).resolves.toBe("persistent-key");
  });
});
