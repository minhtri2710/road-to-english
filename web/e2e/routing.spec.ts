import { createLesson, expect, openLibraryLesson, test, viewLink } from "./fixtures";

const LIBRARY_LESSON = "Greetings & Basics";
const USER_LESSON = "My routed text";

test("a lesson survives a reload, and browser Back and Forward follow the route", async ({ page }) => {
  await openLibraryLesson(page, LIBRARY_LESSON);
  await expect(page).toHaveURL(/#\/lesson\/greetings-basics$/);
  await expect(page).toHaveTitle(`${LIBRARY_LESSON} · Road to English`);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: LIBRARY_LESSON })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  await expect(page).toHaveTitle("Lesson library · Road to English");
  await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeFocused();

  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: LIBRARY_LESSON })).toBeFocused();
});

test("deep links open Review, Manage and a library lesson on a fresh page", async ({ page }) => {
  await page.goto("/#/review");
  await expect(page.getByRole("heading", { level: 1, name: "Review deck" })).toBeVisible();
  await expect(viewLink(page, "Review")).toHaveAttribute("aria-current", "page");

  // A blank page between them makes each deep link a fresh document load, not a hash change.
  await page.goto("about:blank");
  await page.goto("/#/manage");
  await expect(page.getByRole("heading", { level: 1, name: "Manage lessons and data" })).toBeVisible();
  await expect(page).toHaveTitle("Manage lessons and data · Road to English");
  await expect(viewLink(page, "Manage")).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Manage lessons and data" })).toBeVisible();

  await page.goto("about:blank");
  await page.goto("/#/lesson/greetings-basics");
  await expect(page.getByRole("heading", { level: 1, name: LIBRARY_LESSON })).toBeVisible();
});

test("a user lesson deep link opens it after it is created", async ({ page }) => {
  await createLesson(page, { title: USER_LESSON, text: "The first sentence is short. The second one follows." });
  await expect(page.getByRole("heading", { level: 1, name: USER_LESSON })).toBeVisible();
  const url = page.url();
  expect(url).toMatch(/#\/my\/user-[0-9a-f-]{36}$/);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: USER_LESSON })).toBeVisible();
});

test("Manage deep links survive reload and Back/Forward retrace the route", async ({ page }) => {
  await page.goto("/#/manage");
  await expect(page.getByRole("heading", { level: 1, name: "Manage lessons and data" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  await viewLink(page, "Manage").click();
  await expect(page).toHaveURL(/#\/manage$/);
  await expect(page.getByRole("heading", { level: 1, name: "Manage lessons and data" })).toBeFocused();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Manage lessons and data" })).toBeFocused();
});

test("Back to lessons after a deep link stays in the app and focuses the lesson's row", async ({ page }) => {
  await page.goto("about:blank");
  await page.goto("/#/lesson/greetings-basics");
  await expect(page.getByRole("heading", { level: 1, name: LIBRARY_LESSON })).toBeVisible();

  await page.getByRole("button", { name: "Back to lessons" }).click();
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Lesson library" })).toBeVisible();
  await expect(page.getByRole("button", { name: LIBRARY_LESSON })).toBeFocused();
});
