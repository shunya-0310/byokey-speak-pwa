import { describe, expect, it } from "vitest";
import { isTrustedPersistentHostname } from "./pwa";

describe("persistent API key storage origins", () => {
  it("allows the stable Gemini voice preview URL", () => {
    expect(isTrustedPersistentHostname("preview-gemini-voice.byokey-speak-pwa.pages.dev")).toBe(true);
  });

  it("does not allow arbitrary Pages preview URLs", () => {
    expect(isTrustedPersistentHostname("random-deployment.byokey-speak-pwa.pages.dev")).toBe(false);
  });
});
