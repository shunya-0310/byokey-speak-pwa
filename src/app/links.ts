export const LINKS = {
  github: "https://github.com/shunya-0310/byokey-speak-pwa",
  apiGuide: "https://byokey-lab.com/guide/api/",
  googleAiStudio: "https://aistudio.google.com/apikey",
  privacy: "https://byokey-lab.com/privacy/",
  terms: "https://byokey-lab.com/terms/",
  support: "https://byokey-lab.com/support/",
  googleApiKeyDocs: "https://ai.google.dev/gemini-api/docs/api-key"
} as const;

export const BUILD_INFO = {
  version: __APP_VERSION__,
  commitSha: __COMMIT_SHA__,
  buildTime: __BUILD_TIME__
} as const;
