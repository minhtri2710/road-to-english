import { expect, test } from "./fixtures";

test("a failing IndexedDB shows the storage line and leaves the library usable", async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
  });
  await page.goto("/");

  await expect(page.getByText(/^Your saved data couldn't be read or saved on this device: .+ Reload to try again\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Greetings & Basics" })).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByText("Your review deck couldn't be loaded.")).toBeVisible();
  await expect(page.getByText(/Nothing to review yet/)).toHaveCount(0);
  await expect(page.getByText("Loading review deck...")).toHaveCount(0);
});
