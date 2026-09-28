import { expect, menuItem, openLibraryLesson, test, viewLink } from "./fixtures";

test("shadow a library lesson, save a word, review it", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");

  await page.getByRole("button", { name: "Listen" }).first().click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken))
    .toContain("Good morning, how are you today?");

  await page.getByRole("button", { name: "morning", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hear word" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Define" })).toBeVisible();
  await page.getByRole("button", { name: "Save word" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveAccessibleName("Saved, remove from review deck");

  await viewLink(page, "Review").click();
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("morning", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByRole("button", { name: "Good" }).click();
  await expect(page.getByText("0 due")).toBeVisible();
  await expect(page.getByText(/All caught up/)).toBeVisible();
});

test("remove a saved word with the Saved toggle, then Undo puts it back in Review", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  await page.getByRole("button", { name: "morning", exact: true }).click();
  await page.getByRole("button", { name: "Save word" }).click();
  const saved = page.getByRole("button", { name: "Saved, remove from review deck" });
  await expect(saved).toBeVisible();

  await saved.focus();
  await page.keyboard.press("Enter");
  const save = page.getByRole("button", { name: "Save word" });
  await expect(save).toBeFocused();
  await expect(page.getByLabel("Notifications").getByText("Removed from your review deck.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Removed from your review deck." })).toHaveCount(1);

  await viewLink(page, "Review").click();
  await expect(page.getByText("0 due")).toBeVisible();

  const undo = page.getByRole("button", { name: "Undo" });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("morning", { exact: true })).toBeVisible();
});

test("Display menu opens by keyboard, navigates options, and Escape restores focus", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  const display = page.getByRole("button", { name: "Display" });
  for (const key of ["Enter", "Space", "ArrowDown"]) {
    await display.focus();
    await page.keyboard.press(key);
    await expect(page.getByRole("menu", { name: "Display" })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "0.5x" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "0.75x" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Display" })).toHaveCount(0);
    await expect(display).toBeFocused();
  }
});

test("sentence reading joins punctuation and uses a real bold stress face", async ({ page }) => {
  await openLibraryLesson(page, "Stress Pairs: Nouns and Verbs");
  const album = page.getByRole("button", { name: "album", exact: true }).first();
  const metrics = await album.evaluate((button) => {
    const textRange = (element: Element, text: string) => {
      if (!element) throw new Error(`element not found for text: ${text}`);
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.includes(text)) node = walker.nextNode();
      if (!node) throw new Error(`text not found: ${text}`);
      const offset = node.textContent!.indexOf(text);
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + text.length);
      return range.getBoundingClientRect();
    };
    const wrapper = button.parentElement!;
    const punctuation = wrapper.lastChild as Text;
    const albumGlyph = textRange(button, "album");
    const punctuationGlyph = textRange(wrapper, ".");
    const namedButton = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => {
      const visible = candidate.cloneNode(true) as HTMLElement;
      visible.querySelectorAll("[aria-hidden]").forEach((node) => node.remove());
      return visible.textContent?.trim() === name;
    })!;
    const band = namedButton("band");
    const will = namedButton("will");
    const bandGlyph = textRange(band, "band");
    const willGlyph = textRange(will, "will");
    return {
      gap: punctuationGlyph.left - albumGlyph.right,
      wordGap: willGlyph.left - bandGlyph.right,
      punctuation: punctuation.textContent,
    };
  });
  expect(metrics.gap).toBeLessThanOrEqual(2);
  expect(metrics.wordGap).toBeLessThanOrEqual(10);

  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Stress" }).click();
  await expect(page.getByText("Stress and intonation marks are auto-generated", { exact: false })).toBeVisible();
  const marks = await album.evaluate((button) => {
    const group = button.parentElement!;
    return {
      nowrap: getComputedStyle(group).whiteSpace,
      order: Array.from(group.childNodes).map((node) => node.textContent),
    };
  });
  expect(marks.nowrap).toBe("nowrap");
  expect(marks.order[0]).toContain("album");
  expect(marks.order[1]).toMatch(/^[●•]( [●•])*$/);
  expect(marks.order[2]).toBe(".");
  await page.evaluate(async () => {
    await document.fonts.load('700 20px "Be Vietnam Pro"', "album");
  });
  const stressedWeight = await page.getByRole("button", { name: "album", exact: true }).first().locator("span span span").evaluate((label) => getComputedStyle(label).fontWeight);
  const unstressedWeight = await page.getByRole("button", { name: "will", exact: true }).first().locator("span span span").evaluate((label) => getComputedStyle(label).fontWeight);
  const loaded = await page.evaluate(() => document.fonts.check('700 20px "Be Vietnam Pro"', "album"));
  expect({ stressed: stressedWeight, unstressed: unstressedWeight, loaded }).toEqual({ stressed: "700", unstressed: "400", loaded: true });
});

test("one-at-a-time mode limits the lesson to one sentence and restores the list", async ({ page }) => {
  await openLibraryLesson(page, "Greetings & Basics");
  const guided = await menuItem(page, "One at a time");
  await guided.click();
  await expect(guided).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Sentence 1 of 9");
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveCount(1);

  await (await menuItem(page, "One at a time")).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveCount(9);
});
