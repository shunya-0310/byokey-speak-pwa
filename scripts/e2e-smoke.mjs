import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { preview } from "vite";

const localBrowsers = resolve(".ms-playwright");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}

const { chromium, devices } = await import("@playwright/test");

async function checkViewport(contextOptions) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    page.setDefaultTimeout(10000);
    await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("New Chatです。") || document.body.innerText.includes("Geminiと英語、日本語、混在文で会話できます。"), null, { timeout: 15000 });
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const titleVisible = bodyText.includes("BYOKey Speak");
    const onboardingVisible = bodyText.includes("Geminiと英語、日本語、混在文で会話できます。");
    const shellVisible = bodyText.includes("Gemini-only local-first PWA");
    if (!titleVisible || (!onboardingVisible && !shellVisible)) {
      throw new Error(`Initial app UI was not visible.\nPage errors: ${pageErrors.join(" | ")}\nBody: ${bodyText.slice(0, 500)}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

const server = await preview({
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  }
});
let exitCode = 0;

try {
  await checkViewport({ viewport: { width: 1280, height: 900 } });
  await checkViewport({ ...devices["Pixel 7"] });
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  await new Promise((resolveClose) => server.httpServer.close(resolveClose));
}

process.exit(exitCode);
