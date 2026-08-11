export const LINKS = {
  officialSite: "https://byokey-lab.com/",
  github: "https://github.com/shunya-0310/byokey-speak-pwa",
  apiGuide: "https://byokey-lab.com/guide/api/",
  googleAiStudio: "https://aistudio.google.com/apikey",
  googleCloudAbuseReport: "https://support.google.com/code/contact/cloud_platform_report",
  googleGeminiSafetyGuidance: "https://ai.google.dev/gemini-api/docs/safety-guidance",
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
