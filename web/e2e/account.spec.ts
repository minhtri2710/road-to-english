import {
  ACCOUNT_PASSWORD,
  accountDisclosure,
  accountModes,
  accountSubmit,
  expect,
  limitLogin,
  submitAccount,
  test,
  uniqueEmail,
} from "./fixtures";

test("create an account, see it sync, sign out, reject a wrong password, show the password, sign in", async ({ page }) => {
  const email = uniqueEmail();
  await page.goto("/");
  await submitAccount(page, "Create account", email, ACCOUNT_PASSWORD);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Synced just now")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(accountDisclosure(page)).toBeFocused();
  await expect(accountDisclosure(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(/^Synced /)).toHaveCount(0);

  await submitAccount(page, "Sign in", email, "wrong password");
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");

  const password = page.getByLabel("Password", { exact: true });
  const show = page.getByRole("button", { name: "Show password" });
  await password.fill(ACCOUNT_PASSWORD);
  await expect(password).toHaveAttribute("type", "password");
  await show.click();
  await expect(show).toHaveAttribute("aria-pressed", "true");
  await expect(show).toBeFocused();
  await expect(password).toHaveAttribute("type", "text");
  await show.click();
  await expect(password).toHaveAttribute("type", "password");

  await accountSubmit(page).click();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Synced just now")).toBeVisible();
});

test("the Sign in disclosure expands the form and collapses on Escape and Close", async ({ page }) => {
  await page.goto("/");
  const disclosure = accountDisclosure(page);
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Email")).toHaveCount(0);

  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  const region = page.locator(`[id="${await disclosure.getAttribute("aria-controls")}"]`);
  await expect(region.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(disclosure).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(disclosure).toBeFocused();
});

test("a 429 with Retry-After counts down with submit disabled, then re-enables", async ({ page }) => {
  await page.clock.install();
  await limitLogin(page, "3");
  await page.goto("/");
  await submitAccount(page, "Sign in", uniqueEmail(), ACCOUNT_PASSWORD);

  const countdown = page.locator("p:not([role=alert])", { hasText: /^Too many attempts\. Try again in/ });
  await expect(countdown).toHaveText("Too many attempts. Try again in 3 s");
  await expect(accountSubmit(page)).toBeDisabled();

  await page.clock.runFor(1000);
  await expect(countdown).toHaveText("Too many attempts. Try again in 2 s");
  await expect(accountSubmit(page)).toBeDisabled();

  await page.clock.runFor(2000);
  await expect(page.getByText(/Too many attempts/)).toHaveCount(0);
  await expect(accountSubmit(page)).toBeEnabled();
  await expect(accountModes(page).getByRole("button", { name: "Sign in" })).toHaveAttribute("aria-pressed", "true");
});
