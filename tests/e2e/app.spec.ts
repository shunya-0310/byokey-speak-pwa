import { expect, test } from "@playwright/test";

test("loads onboarding and app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("BYOKey Speak").first()).toBeVisible();
  await expect(page.getByText("Gemini-only local-first PWA")).toBeVisible();
});
