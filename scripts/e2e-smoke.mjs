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
    const bodyText = await waitForInitialAppText(page, pageErrors);
    const titleVisible = bodyText.includes("BYOKey Speak");
    const onboardingVisible = bodyText.includes("BYOKey Speakへようこそ");
    const shellVisible = bodyText.includes("New Chatです。") || bodyText.includes("TODAY'S WORLD");
    if (!titleVisible || (!onboardingVisible && !shellVisible)) {
      throw new Error(`Initial app UI was not visible.\nPage errors: ${pageErrors.join(" | ")}\nBody: ${bodyText.slice(0, 500)}`);
    }
    if (onboardingVisible) {
      async function advanceOnboarding(expectedText) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const beforeText = await page.locator("body").innerText().catch(() => "");
          const nextButton = page.getByRole("button", { name: "次へ" }).last();
          try {
            await nextButton.scrollIntoViewIfNeeded({ timeout: 5000 });
            await nextButton.evaluate((button) => button.click());
            // The onboarding changes its background and focus state between pages.
            // Give that transition one frame before checking the next page's text.
            await page.waitForTimeout(250);
          } catch {
            continue;
          }
          try {
            await page.waitForFunction((text) => document.body.innerText.includes(text), expectedText, { timeout: 2500 });
            return;
          } catch {
            const afterText = await page.locator("body").innerText().catch(() => "");
            if (afterText === beforeText) continue;
            // In headless browser checks the very first tap can occasionally be swallowed while the page finishes settling.
            // Retry the same visible primary action before failing the smoke test.
          }
        }
        const bodyTextAfterClick = await page.locator("body").innerText().catch(() => "");
        throw new Error(`Onboarding did not advance to expected text: ${expectedText}\nBody: ${bodyTextAfterClick.slice(0, 500)}`);
      }
      const expectedPages = [
        "BYOKとはBring Your Own Key",
        "APIキーはGemini API利用権限",
        "アプリ内のバックアップ機能",
        "さあ、はじめましょう"
      ];
      for (const expectedText of expectedPages) {
        await advanceOnboarding(expectedText);
      }
      await page.getByRole("button", { name: "後で設定する" }).click({ force: true });
      await page.getByLabel("Daily News").getByRole("heading", { name: "TODAY'S WORLD" }).waitFor({ timeout: 10000 });
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function waitForInitialAppText(page, pageErrors) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
    try {
      await page.waitForFunction(() => {
        const text = document.body?.innerText ?? "";
        return text.includes("BYOKey Speakへようこそ") || text.includes("New Chatです。") || text.includes("TODAY'S WORLD");
      }, null, { timeout: 15000 });
      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (bodyText.includes("BYOKey Speakへようこそ") || bodyText.includes("New Chatです。") || bodyText.includes("TODAY'S WORLD")) return bodyText;
    } catch {
      // The Windows/Chromium smoke check can occasionally observe an empty body immediately after Vite preview starts.
      // Retry once with a reload before reporting a real UI failure.
    }
  }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  throw new Error(`Initial app UI was not visible.\nPage errors: ${pageErrors.join(" | ")}\nBody: ${bodyText.slice(0, 500)}`);
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
