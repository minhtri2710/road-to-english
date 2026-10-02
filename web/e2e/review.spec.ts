import type { Page } from "@playwright/test";

import { expect, openLibraryLesson, test, viewLink } from "./fixtures";

async function saveWords(page: Page, words: string[]): Promise<void> {
  await openLibraryLesson(page, "Greetings & Basics");
  for (const word of words) {
    await page.getByRole("button", { name: word, exact: true }).click();
    await page.getByRole("button", { name: "Save word" }).click();
    await expect(page.getByRole("button", { name: "Saved, remove from review deck" })).toBeVisible();
  }
  await viewLink(page, "Review").click();
  await expect(page.getByText(`${words.length} due`)).toBeVisible();
}

const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? "");

const ratingRows = (page: Page) =>
  page.evaluate(() => {
    const rows = new Map<number, number>();
    for (const el of document.querySelectorAll<HTMLElement>("button[aria-keyshortcuts]")) {
      if (/^[1-4]$/.test(el.getAttribute("aria-keyshortcuts") ?? "")) {
        const top = Math.round(el.getBoundingClientRect().top);
        rows.set(top, (rows.get(top) ?? 0) + 1);
      }
    }
    return [...rows.values()];
  });

test("review two due cards with the keyboard only and see the recap", async ({ page }) => {
  await saveWords(page, ["morning", "today"]);

  const showAnswer = page.getByRole("button", { name: "Show answer" });
  for (let step = 0; step < 10 && !(await showAnswer.evaluate((el) => el === document.activeElement)); step += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(showAnswer).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
  await page.locator("[data-review-card]").evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  expect(await ratingRows(page)).toEqual([4]);
  await page.keyboard.press("3");
  await expect(page.getByText("1 due")).toBeVisible();
  await expect.poll(() => page.locator("[data-review-card]").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

  // The first rating moved focus to the next card's prompt, so both keys are the card's shortcuts.
  await expect(showAnswer).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
  await page.keyboard.press("3");

  await expect(page.getByText("0 due")).toBeVisible();
  await expect(page.getByRole("list", { name: "Session rating breakdown" }).getByRole("listitem")).toHaveCount(4);
  await expect.poll(() => focusedText(page)).toMatch(/^Reviewed 2 cards: 2 Good\. All caught up\./);
  await expect(page.getByRole("heading", { name: "Rated Again" })).toHaveCount(0);
});

// Every button inside the screen, nothing scrolls sideways, and the ratings form one row of four or a 2x2 grid.
const overflow = (page: Page) =>
  page.evaluate(() => {
    const width = window.innerWidth;
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > width) {
      problems.push(`page scrolls horizontally: ${document.documentElement.scrollWidth} > ${width}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>("button")) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && (rect.left < 0 || rect.right > width)) {
        problems.push(`clipped: ${el.textContent?.trim()} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
      }
      if (el.scrollWidth > el.clientWidth) {
        problems.push(`overflows: ${el.textContent?.trim()}`);
      }
    }
    return problems;
  });

for (const width of [360, 320]) {
  test.describe(`${width} px wide`, () => {
    test.use({ viewport: { width, height: 740 } });

    test("the rating row and the recap stay inside the screen", async ({ page }) => {
      await saveWords(page, ["morning"]);
      await page.getByRole("button", { name: "Show answer" }).click();
      await expect(page.getByRole("button", { name: "Easy" })).toBeVisible();
      await page.locator("[data-review-card]").evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished)),
      );
      expect(await ratingRows(page)).toEqual([2, 2]);
      expect(await overflow(page)).toEqual([]);

      await page.getByRole("button", { name: "Again" }).click();
      await expect(page.getByRole("heading", { name: "Rated Again" })).toBeVisible();
      const breakdown = page.getByRole("list", { name: "Session rating breakdown" });
      await expect(breakdown.getByRole("listitem")).toHaveCount(4);
      expect(await overflow(page)).toEqual([]);
    });
  });
}

test("Listen first hides the card front until Show answer and speaks it", async ({ page }) => {
  await saveWords(page, ["morning"]);
  const toggle = page.getByRole("button", { name: "Listen first" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Listen and recall the card.")).toBeVisible();
  await expect(page.getByText("morning", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.at(-1))).toBe("morning");

  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByText("morning", { exact: true })).toBeVisible();
  await expect(page.getByText("Listen and recall the card.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
});

test("the due badge does not stretch across its parent", async ({ page }) => {
  await saveWords(page, ["morning"]);
  await expect(page.getByText("1 due")).toBeVisible();
  const badge = page.locator("main span[title='1 due']");
  await expect(badge).toBeVisible();
  const parent = badge.locator("xpath=..");
  const badgeBox = await badge.boundingBox();
  const parentBox = await parent.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(parentBox).not.toBeNull();
  expect(badgeBox!.width).toBeLessThan(parentBox!.width);
});

test("rating buttons carry their semantic colors in light and dark themes", async ({ page }) => {
  const expected = {
    light: {
      Again: ["rgb(253, 231, 228)", "rgb(180, 35, 24)", "rgb(180, 35, 24)"],
      Hard: ["rgb(251, 239, 214)", "rgb(133, 86, 0)", "rgb(133, 86, 0)"],
      Good: ["rgb(29, 122, 59)", "rgb(255, 255, 255)"],
      Easy: ["rgb(212, 236, 238)", "rgb(11, 110, 120)", "rgb(11, 110, 120)"],
    },
    dark: {
      Again: ["rgb(69, 32, 28)", "rgb(255, 122, 110)", "rgb(255, 122, 110)"],
      Hard: ["rgb(58, 46, 18)", "rgb(242, 193, 78)", "rgb(242, 193, 78)"],
      Good: ["rgb(95, 211, 138)", "rgb(16, 19, 23)"],
      Easy: ["rgb(18, 58, 62)", "rgb(79, 195, 204)", "rgb(79, 195, 204)"],
    },
  };
  await saveWords(page, ["morning"]);
  let firstScheme = true;
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    if (!firstScheme) {
      await viewLink(page, "Library").click();
      await viewLink(page, "Review").click();
    }
    firstScheme = false;
    await page.getByRole("button", { name: "Show answer" }).click();
    for (const [grade, colors] of Object.entries(expected[colorScheme])) {
      const button = page.getByRole("button", { name: grade });
      const actual = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          text: style.color,
          borderWidth: style.borderTopWidth,
          borderStyle: style.borderTopStyle,
          shadow: style.boxShadow,
        };
      });
      expect(actual.background, `${grade} ${colorScheme} background`).toBe(colors[0]);
      expect(actual.text, `${grade} ${colorScheme} text`).toBe(colors[1]);
      if (grade !== "Good") {
        expect(actual.borderWidth, `${grade} ${colorScheme} rendered edge width`).toBe("0px");
        expect(actual.borderStyle, `${grade} ${colorScheme} rendered edge style`).toBe("none");
        expect(actual.shadow, `${grade} ${colorScheme} rendered edge`).toContain(`${colors[2]} 0px 0px 0px 1px inset`);
      }
    }
    await page.goto("/");
  }
});

test("a saved sentence card shows the sentence's Vietnamese on its back", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  await page.getByRole("button", { name: "Save to review" }).first().click();
  await viewLink(page, "Review").click();
  await expect(page.getByText("Good morning, how are you today?")).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.locator('[lang="vi"]')).toHaveText("Chào buổi sáng, hôm nay bạn thế nào?");
});
