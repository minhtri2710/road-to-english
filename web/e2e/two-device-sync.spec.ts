import type { Response } from "@playwright/test";

import { ACCOUNT_PASSWORD, expect, openLibraryLesson, submitAccount, test, uniqueEmail, viewLink } from "./fixtures";

const LESSON = "Greetings & Basics";
const MORNING_ID = "greetings-basics:greetings-basics-1:morning";
const TODAY_ID = "greetings-basics:greetings-basics-1:today";

type SyncCard = {
  id: string;
  source: { word: string | null };
  deletedAt: string | null;
  fsrs: { reps: number };
};

type SyncState = { cards: SyncCard[] };

function nextSync(page: import("@playwright/test").Page): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().endsWith("/sync") && response.request().method() === "POST",
  );
}

async function cardFromSync(response: Response, id: string): Promise<SyncCard> {
  expect(response.status()).toBe(200);
  const state = (await response.json()) as SyncState;
  const card = state.cards.find((item) => item.id === id);
  expect(card, `sync reply contains ${id}`).toBeDefined();
  return card!;
}

test("cards, ratings, removals and undo sync between two devices", async ({ page, secondDevice }) => {
  const email = uniqueEmail();
  await page.goto("/");
  await submitAccount(page, "Create account", email, ACCOUNT_PASSWORD);
  await expect(page.getByText("Synced just now")).toBeVisible();

  await openLibraryLesson(page, LESSON);
  await page.getByRole("button", { name: "morning", exact: true }).click();
  const morningSave = nextSync(page);
  await page.getByRole("button", { name: "Save word" }).click();
  const savedMorning = await cardFromSync(await morningSave, MORNING_ID);
  expect(savedMorning.deletedAt, "saved card is live on sync").toBeNull();
  await expect(page.getByRole("button", { name: "Saved, remove from review deck" })).toBeVisible();

  await viewLink(page, "Review").click();
  await expect(page.getByText("1 due")).toBeVisible();
  await expect(page.getByText("morning", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show answer" }).click();
  const ratingSync = nextSync(page);
  await page.getByRole("button", { name: "Good", exact: false }).click();
  const ratedMorning = await cardFromSync(await ratingSync, MORNING_ID);
  expect(ratedMorning.fsrs.reps, "rating is in the sync reply").toBeGreaterThan(0);

  await openLibraryLesson(page, LESSON);
  await page.getByRole("button", { name: "today", exact: true }).click();
  const todaySave = nextSync(page);
  await page.getByRole("button", { name: "Save word" }).click();
  const savedToday = await cardFromSync(await todaySave, TODAY_ID);
  expect(savedToday.deletedAt, "second saved card is live on sync").toBeNull();

  await secondDevice.page.goto("/");
  const initialPull = nextSync(secondDevice.page);
  await submitAccount(secondDevice.page, "Sign in", email, ACCOUNT_PASSWORD);
  const pulledInitial = await initialPull;
  const pulledMorning = await cardFromSync(pulledInitial, MORNING_ID);
  const pulledToday = await cardFromSync(pulledInitial, TODAY_ID);
  expect(pulledMorning.deletedAt, "device B pulled the rated card live").toBeNull();
  expect(pulledMorning.fsrs.reps, "device B pulled the rating history").toBe(ratedMorning.fsrs.reps);
  expect(pulledToday.deletedAt, "device B pulled the other saved card live").toBeNull();
  await viewLink(secondDevice.page, "Review").click();
  await expect(secondDevice.page.getByText("1 due")).toBeVisible();
  await expect(secondDevice.page.getByText("today", { exact: true })).toBeVisible();
  await expect(secondDevice.page.getByText("morning", { exact: true })).toHaveCount(0);

  await openLibraryLesson(secondDevice.page, LESSON);
  await secondDevice.page.getByRole("button", { name: "morning", exact: true }).click();
  await expect(secondDevice.page.getByRole("button", { name: "Saved, remove from review deck", exact: true })).toHaveCount(1);
  await secondDevice.page.getByRole("button", { name: "today", exact: true }).click();
  await expect(secondDevice.page.getByRole("button", { name: "Saved, remove from review deck", exact: true })).toHaveCount(1);

  await openLibraryLesson(page, LESSON);
  await page.getByRole("button", { name: "today", exact: true }).click();
  const removeToday = page.getByRole("button", { name: "Saved, remove from review deck" });
  await expect(removeToday).toBeVisible();
  const removalSync = nextSync(page);
  await removeToday.click();
  await expect(page.getByRole("status").filter({ hasText: /^Removed from your review deck\. Undo restores it\.$/ })).toBeVisible();
  const removedOnA = await cardFromSync(await removalSync, TODAY_ID);

  const removalPull = nextSync(secondDevice.page);
  await secondDevice.page.reload();
  const pulledRemoval = await removalPull;
  const morningOnB = await cardFromSync(pulledRemoval, MORNING_ID);
  const removedOnB = await cardFromSync(pulledRemoval, TODAY_ID);
  expect(morningOnB.deletedAt, "device B keeps the rated card live").toBeNull();

  await viewLink(secondDevice.page, "Review").click();
  await expect(secondDevice.page.getByText("0 due")).toBeVisible();
  await expect(secondDevice.page.getByText("today", { exact: true })).toHaveCount(0);
  await expect(secondDevice.page.getByText("morning", { exact: true })).toHaveCount(0);
  await openLibraryLesson(secondDevice.page, LESSON);
  await secondDevice.page.getByRole("button", { name: "today", exact: true }).click();
  await expect(secondDevice.page.getByRole("button", { name: "Save word", exact: true })).toHaveCount(1);
  await expect(secondDevice.page.getByRole("button", { name: "Saved, remove from review deck", exact: true })).toHaveCount(0);
  expect(removedOnA.deletedAt, "device A sync reply carries the deletion tombstone").not.toBeNull();
  expect(removedOnB.deletedAt, "device B sync reply carries the deletion tombstone").not.toBeNull();
  await secondDevice.page.getByRole("button", { name: "morning", exact: true }).click();
  await expect(secondDevice.page.getByRole("button", { name: "Saved, remove from review deck", exact: true })).toHaveCount(1);

  const undoSync = nextSync(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await cardFromSync(await undoSync, TODAY_ID);

  const undoPull = nextSync(secondDevice.page);
  await secondDevice.page.reload();
  const pulledUndo = await undoPull;
  const revivedToday = await cardFromSync(pulledUndo, TODAY_ID);
  expect(revivedToday.deletedAt, "device B pulled the restored card").toBeNull();
  await secondDevice.page.getByRole("button", { name: "today", exact: true }).click();
  await expect(secondDevice.page.getByRole("button", { name: "Saved, remove from review deck", exact: true })).toHaveCount(1);
  await viewLink(secondDevice.page, "Review").click();
  await expect(secondDevice.page.getByText("1 due")).toBeVisible();
  await expect(secondDevice.page.getByText("today", { exact: true })).toBeVisible();
});
