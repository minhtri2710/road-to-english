import { expect, test } from "./fixtures";

test("the library starts with the A1 lesson About Me", async ({ page }) => {
  await page.goto("/");
  const firstLesson = page.getByRole("button").filter({ hasText: /· \d+ sentences/ }).first();
  await expect(firstLesson).toContainText("About Me");
  await expect(firstLesson).toContainText("A1 · 9 sentences");

  await firstLesson.click();
  await expect(page.getByRole("heading", { level: 1, name: "About Me" })).toBeVisible();
  await expect(page.getByText("Level A1")).toBeVisible();
  await expect(page.getByText("My name is Lan.", { exact: true })).toBeVisible();
});

test("the level filter narrows the library rows and survives a reload", async ({ page }) => {
  await page.goto("/");
  const rows = page.getByRole("button").filter({ hasText: /· \d+ sentences/ });
  await expect(rows.first()).toContainText("About Me");
  await expect(page.getByText("0 of 31 completed")).toBeVisible();

  const level = page.getByRole("radiogroup", { name: "Library level" });
  await level.getByRole("radio", { name: "B2" }).click();
  await expect(level.getByRole("radio", { name: "B2" })).toBeFocused();
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText("B2 ·");
  await expect(page.getByText("B2: 0 of 7 completed")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "B2: 0 of 7 completed" })).toHaveAttribute("aria-valuemax", "7");

  await page.reload();
  await expect(page.getByRole("radio", { name: "B2" })).toHaveAttribute("aria-checked", "true");
  await expect(rows).toHaveCount(7);
});

test("Today offers Continue for the lesson opened last", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Next: About Me")).toBeVisible();
  await page.getByRole("button", { name: "Daily Routine" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Daily Routine" })).toBeVisible();
  await page.getByRole("button", { name: "Back to lessons" }).click();

  await expect(page.getByText("Continue: Daily Routine")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Daily Routine" })).toBeVisible();
});

test("the own-lessons empty state's Create a lesson moves focus to the Title field", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "No lessons of your own yet" })).toBeVisible();
  await expect(page.getByText("Paste a transcript or any English text to practise it as a lesson.")).toBeVisible();
  await page.getByRole("button", { name: "Create a lesson" }).click();
  await expect(page.getByLabel("Title")).toBeFocused();
});

test("the Today card's goal picker survives a reload", async ({ page }) => {
  await page.goto("/");
  const today = page.getByRole("heading", { name: "Today" }).locator("xpath=../..");
  await expect(today.getByText("0 of 10 practice actions today")).toBeVisible();
  await today.getByRole("button", { name: "20 Intense" }).click();
  await expect(today.getByRole("progressbar", { name: "0 of 20 practice actions today" })).toHaveAttribute("aria-valuemax", "20");

  await page.reload();
  await expect(today.getByText("0 of 20 practice actions today")).toBeVisible();
  await expect(today.getByRole("button", { name: "20 Intense" })).toHaveAttribute("aria-pressed", "true");
});

test("the week view marks today as practised after a practice action", async ({ page }) => {
  await page.goto("/");
  const today = page.getByRole("heading", { name: "Today" }).locator("xpath=../..");
  const todayMark = today.getByRole("list", { name: "This week" }).locator('li[aria-current="date"]');
  await expect(today.getByText("Start a new streak today")).toBeVisible();
  await expect(todayMark).toContainText("not practised");

  await page.getByRole("button", { name: "Greetings & Basics" }).click();
  await page.getByRole("button", { name: "Dictation" }).click();
  await page.getByLabel("What did you hear?").first().fill("Good morning");
  await page.getByRole("button", { name: "Check" }).first().click();
  await expect(page.getByText(/^Reference:/).first()).toBeVisible();
  await page.getByRole("button", { name: "Back to lessons" }).click();

  await expect(today.getByText("1-day streak")).toBeVisible();
  await expect(todayMark).toContainText("✓");
  await expect(todayMark).not.toContainText("not practised");
  await expect(today.getByText("1 of 10 practice actions today")).toBeVisible();
});

test.describe("first-run welcome", () => {
  test.use({ welcomed: false });

  test("the welcome sets level and goal, and stays done across a reload", async ({ page }) => {
    await page.goto("/");
    const welcome = page.getByRole("region", { name: "Welcome to Road to English" });
    await expect(welcome.getByText("Step 1 of 2")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today" })).toHaveCount(0);
    const rows = page.getByRole("button").filter({ hasText: /· \d+ sentences/ });

    await welcome.getByRole("radiogroup", { name: "English level" }).getByRole("radio", { name: "B2" }).click();
    await expect(rows).toHaveCount(7);
    await welcome.getByRole("button", { name: "Next" }).click();
    await expect(welcome.getByText("Step 2 of 2")).toBeVisible();
    await expect(welcome.getByText("How much practice a day?")).toBeFocused();
    await welcome.getByRole("button", { name: "5 Light" }).click();
    await welcome.getByRole("button", { name: "Done" }).click();

    await expect(welcome).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Today" })).toBeFocused();
    await expect(page.getByText("0 of 5 practice actions today")).toBeVisible();
    await page.reload();
    await expect(page.getByText("0 of 5 practice actions today")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Library level" }).getByRole("radio", { name: "B2" })).toHaveAttribute("aria-checked", "true");
    await expect(rows).toHaveCount(7);
    await expect(welcome).toHaveCount(0);
  });

  test("Skip on step 1 keeps the defaults and shows the Today card", async ({ page }) => {
    await page.goto("/");
    const welcome = page.getByRole("region", { name: "Welcome to Road to English" });
    await welcome.getByRole("button", { name: "Skip" }).click();
    await expect(welcome).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Today" })).toBeFocused();
    await expect(page.getByText("0 of 10 practice actions today")).toBeVisible();
    await expect(page.getByText("0 of 31 completed")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(welcome).toHaveCount(0);
  });
});
