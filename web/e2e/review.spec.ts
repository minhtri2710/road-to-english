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

const flipTiming = (page: Page) =>
  page.locator("[data-review-card]").evaluate((element) => {
    const animation = element.getAnimations()[0];
    return {
      iterations: animation?.effect?.getComputedTiming().iterations,
      duration: animation?.effect?.getComputedTiming().duration,
      computedDuration: getComputedStyle(element).animationDuration,
      animationName: getComputedStyle(element).animationName,
    };
  });

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
  const flip = await flipTiming(page);
  expect(flip.iterations).toBe(1);
  expect(flip.duration).toBeLessThanOrEqual(320);
  expect(flip.computedDuration).toBe("0.32s");
  expect(flip.animationName).not.toBe("none");
  await page.locator("[data-review-card]").evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  expect(await ratingRows(page)).toEqual([4]);
  await page.keyboard.press("3");
  await expect(page.getByText("1 due")).toBeVisible();
  await expect.poll(async () => (await flipTiming(page)).animationName).toBe("none");

  // The first rating moved focus to the next card's prompt, so both keys are the card's shortcuts.
  await expect(showAnswer).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Good" })).toBeVisible();
  await page.keyboard.press("3");

  await expect(page.getByText("0 due")).toBeVisible();
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

    test("the rating row and the recap stay inside the screen", async ({ page }, testInfo) => {
      await saveWords(page, ["morning"]);
      await page.getByRole("button", { name: "Show answer" }).click();
      await expect(page.getByRole("button", { name: "Easy" })).toBeVisible();
      await page.locator("[data-review-card]").evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished)),
      );
      expect(await ratingRows(page)).toEqual([2, 2]);
      await page.screenshot({ path: testInfo.outputPath(`review-rating-${width}.png`), fullPage: true });
      expect(await overflow(page)).toEqual([]);
      expect([[4], [2, 2]]).toContainEqual(await ratingRows(page));

      await page.getByRole("button", { name: "Again" }).click();
      await expect(page.getByRole("heading", { name: "Rated Again" })).toBeVisible();
      const breakdown = page.getByRole("list", { name: "Session rating breakdown" });
      await expect(breakdown.getByRole("listitem")).toHaveCount(4);
      await page.screenshot({ path: testInfo.outputPath(`review-recap-${width}.png`), fullPage: true });
      expect(await overflow(page)).toEqual([]);
    });
  });
}

test("the due badge is narrower than the review column", async ({ page }) => {
  await saveWords(page, ["morning"]);
  const badge = page.locator("main span[title='1 due']");
  const column = page.locator("main > div").last();
  const badgeBox = await badge.boundingBox();
  const columnBox = await column.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(columnBox).not.toBeNull();
  expect(badgeBox!.width).toBeLessThan(columnBox!.width);
});

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

test("rating buttons carry their semantic colors in light and dark themes", async ({ page }) => {
  const expected = {
    light: {
      Again: ["rgb(254, 228, 226)", "rgb(180, 35, 52)", "rgb(180, 35, 52)"],
      Hard: ["rgb(254, 243, 199)", "rgb(133, 77, 14)", "rgb(133, 77, 14)"],
      Good: ["rgb(22, 101, 52)", "rgb(255, 255, 255)"],
      Easy: ["rgb(204, 251, 241)", "rgb(15, 118, 110)", "rgb(15, 118, 110)"],
    },
    dark: {
      Again: ["rgb(74, 32, 37)", "rgb(255, 122, 132)", "rgb(255, 122, 132)"],
      Hard: ["rgb(67, 53, 20)", "rgb(252, 211, 77)", "rgb(252, 211, 77)"],
      Good: ["rgb(134, 239, 172)", "rgb(6, 53, 28)"],
      Easy: ["rgb(22, 67, 61)", "rgb(94, 234, 212)", "rgb(94, 234, 212)"],
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
