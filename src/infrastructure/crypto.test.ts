import { describe, expect, it } from "vitest";
import { decryptBackupJson, encryptBackupJson } from "./crypto";

describe("backup crypto", () => {
  it("round trips encrypted backup data", async () => {
    const encrypted = await encryptBackupJson(JSON.stringify({ hello: "world" }), "12345678");
    expect(encrypted).not.toContain("world");
    await expect(decryptBackupJson(encrypted, "12345678")).resolves.toContain("world");
    await expect(decryptBackupJson(encrypted, "wrongpass")).rejects.toThrow();
  });
});
