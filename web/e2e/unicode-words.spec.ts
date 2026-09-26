import { ACCOUNT_PASSWORD, createLesson, expect, submitAccount, test, uniqueEmail, viewLink } from "./fixtures";

test("save a non-ASCII word from a user lesson, sync it and see it in Review", async ({ page }) => {
  const email = uniqueEmail();
  await page.goto("/");
  await submitAccount(page, "Create account", email, ACCOUNT_PASSWORD);
  await expect(page.getByText("Synced just now")).toBeVisible();

  await createLesson(page, { title: "Accents", text: "We meet at the café every day." });
  await expect(page.getByRole("heading", { level: 1, name: "Accents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "caf", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "café", exact: true }).click();

  const synced = page.waitForResponse(
    async (response) =>
      response.url().endsWith("/sync") &&
      response.request().method() !== "GET" &&
      (response.request().postData() ?? "").includes("café"),
  );
  await page.getByRole("button", { name: "Save word" }).click();
  await expect(page.getByRole("button", { name: "Saved, remove from review deck" })).toBeVisible();
  const response = await synced;
  expect(response.status()).toBe(200);
  const state = (await response.json()) as { cards: { id: string; source: { word: string } }[] };
  expect(state.cards.map((card) => card.source.word)).toContain("café");
  await expect(page.getByText("Synced just now")).toBeVisible();

  await viewLink(page, "Review").click();
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("café", { exact: true })).toBeVisible();
});
