import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  callsTo,
  renderApp,
  resetApp,
  setInputValue,
  userResponse,
  waitForCondition,
} from "../test/app";

describe("useSync", () => {
  afterEach(resetApp);

  const syncFailed = "Couldn't sync. Your changes are saved on this device and will sync when you're back online.";

  it("syncs exactly once after sign-in", async () => {
    const { container } = await renderApp({
      route: (path) => {
        if (path === "/me") return new Response(null, { status: 401 });
        if (path === "/login") {
          return new Response(JSON.stringify({ id: "user-1", email: "learner@example.com" }), { status: 200 });
        }
      },
    });
    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-in form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "password");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign in")
        ?.click();
    });
    await waitForCondition(() => callsTo("/sync") === 1);
    expect(callsTo("/sync")).toBe(1);
  });

  it("syncs exactly once after /me restores a user", async () => {
    await renderApp({
      route: (path) => {
        if (path === "/me") return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), { status: 200 });
      },
    });
    await waitForCondition(() => callsTo("/sync") === 1);
    expect(callsTo("/sync")).toBe(1);
  });

  it("shows the owner mismatch message and sends no sync", async () => {
    const { claimOwner } = await import("../lib/backupStore");
    await claimOwner("another-user");
    const { container } = await renderApp({
      route: (path) => {
        if (path === "/me") return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), { status: 200 });
      },
    });
    await waitForCondition(() => container.textContent?.includes("This device's data belongs to another account") ?? false);
    expect(callsTo("/sync")).toBe(0);
  });

  it("shows a failed sync and clears it when an online event re-syncs", async () => {
    let offline = true;
    const { container } = await renderApp({ route: (path) => {
      if (path === "/me") return userResponse();
      if (path === "/sync" && offline) throw new TypeError("Failed to fetch");
      return undefined;
    } });
    await waitForCondition(() => container.textContent?.includes(syncFailed) ?? false);
    expect(container.textContent).toContain("restored@example.com");

    offline = false;
    const before = callsTo("/sync");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitForCondition(() => !(container.textContent?.includes(syncFailed) ?? true));
    expect(callsTo("/sync")).toBe(before + 1);
  });

  it("re-syncs when the window gains focus", async () => {
    const { container } = await renderApp({ route: (path) => (path === "/me" ? userResponse() : undefined) });
    await waitForCondition(() => callsTo("/sync") === 1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitForCondition(() => callsTo("/sync") === 2);
    expect(container.textContent).toContain("restored@example.com");
  });

  it("signs the user out with a message when sync returns 401", async () => {
    const { container } = await renderApp({ route: (path) => {
      if (path === "/me") return userResponse();
      if (path === "/sync") return new Response(null, { status: 401 });
      return undefined;
    } });
    await waitForCondition(() => container.textContent?.includes("You were signed out. Sign in again to sync.") ?? false);
    expect(container.textContent).not.toContain("restored@example.com");
    expect(container.querySelector('input[aria-label="Email"]')).not.toBeNull();
    expect(container.textContent).not.toContain(syncFailed);
  });
});
