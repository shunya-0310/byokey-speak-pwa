import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { preview } from "vite";

const localBrowsers = resolve(".ms-playwright");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}

const { chromium, devices } = await import("@playwright/test");
const port = Number(process.env.E2E_PORT || 4174);
const baseUrl = `http://127.0.0.1:${port}/`;

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
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.includes("BYOKey Speakへようこそ") || document.body.innerText.includes("New Chatです。") || document.body.innerText.includes("TODAY'S WORLD"), null, { timeout: 15000 });
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const titleVisible = bodyText.includes("BYOKey Speak");
    const onboardingVisible = bodyText.includes("BYOKey Speakへようこそ");
    const shellVisible = bodyText.includes("New Chatです。") || bodyText.includes("TODAY'S WORLD");
    if (!titleVisible || (!onboardingVisible && !shellVisible)) {
      throw new Error(`Initial app UI was not visible.\nPage errors: ${pageErrors.join(" | ")}\nBody: ${bodyText.slice(0, 500)}`);
    }
    if (onboardingVisible) {
      const expectedPages = [
        "BYOKとはBring Your Own Key",
        "APIキーはGemini API利用権限",
        "アプリ内のバックアップ機能",
        "さあ、はじめましょう"
      ];
      for (const expectedText of expectedPages) {
        await page.getByRole("button", { name: "次へ" }).click();
        await page.getByText(expectedText).waitFor({ timeout: 5000 });
      }
      await page.getByLabel("■リスクと外部送信について理解しました").check();
      await page.getByRole("button", { name: "開始" }).click();
      await page.getByText("TODAY'S WORLD").waitFor({ timeout: 10000 });
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

const server = await preview({
  preview: {
    host: "127.0.0.1",
    port,
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
