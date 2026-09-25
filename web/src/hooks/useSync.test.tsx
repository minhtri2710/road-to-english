import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accountDisclosure,
  callsTo,
  click,
  clickElement,
  close,
  harnessAct,
  hasText,
  inputLabelled,
  openAccountForm,
  renderApp,
  resetApp,
  setInputValue,
  userResponse,
  waitForCondition,
} from "../test/app";

describe("useSync", () => {
  afterEach(async () => {
    await resetApp();
    vi.useRealTimers();
  });

  const syncFailed = "Saved on this device. Will sync when you're back online.";
  const liveRegions = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[role="status"], [role="alert"], [aria-live]')).map((region) => region.textContent).join("|");
  const syncLine = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("*")).find((el) => el.children.length === 0 && el.textContent?.startsWith("Synced "));

  it("syncs exactly once after sign-in", async () => {
    const { container } = await renderApp({
      route: (path) => {
        if (path === "/me") return new Response(null, { status: 401 });
        if (path === "/login") {
          return new Response(JSON.stringify({ id: "user-1", email: "learner@example.com" }), { status: 200 });
        }
      },
    });
    await openAccountForm(container);
    await harnessAct(async () => {
      setInputValue(inputLabelled(container, "Email"), "learner@example.com");
      setInputValue(inputLabelled(container, "Password"), "password");
    });
    await clickElement(
      inputLabelled(container, "Email").form?.querySelector<HTMLButtonElement>('button[type="submit"]'),
      "Sign in submit button",
    );
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
    await harnessAct(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitForCondition(() => !(container.textContent?.includes(syncFailed) ?? true));
    expect(callsTo("/sync")).toBe(before + 1);
    // The recovery is announced once; the visible line is plain supporting text.
    expect(syncLine(container)?.textContent).toBe("Synced just now");
    expect(liveRegions(container)).toContain("Synced.");
  });

  it("shows when the last run synced, refreshed once a minute, without announcing it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { container } = await renderApp({ route: (path) => (path === "/me" ? userResponse() : undefined) });
    await waitForCondition(() => syncLine(container) !== undefined);
    expect(syncLine(container)?.textContent).toBe("Synced just now");
    expect(syncLine(container)?.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(liveRegions(container)).not.toContain("Synced");

    await harnessAct(async () => {
      vi.advanceTimersByTime(59_999);
    });
    expect(syncLine(container)?.textContent).toBe("Synced just now");
    await harnessAct(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(syncLine(container)?.textContent).toBe("Synced 1 min ago");
    await harnessAct(async () => {
      vi.advanceTimersByTime(59 * 60_000);
    });
    expect(syncLine(container)?.textContent).toBe("Synced 1 h ago");
    expect(liveRegions(container)).not.toContain("Synced");
  });

  it("keeps one minute timer across sync runs and clears it on unmount", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const view = await renderApp({ route: (path) => (path === "/me" ? userResponse() : undefined) });
    await waitForCondition(() => syncLine(view.container) !== undefined);
    expect(vi.getTimerCount()).toBe(1);
    await harnessAct(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(syncLine(view.container)?.textContent).toBe("Synced 1 min ago");

    await harnessAct(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitForCondition(() => syncLine(view.container)?.textContent === "Synced just now");
    expect(vi.getTimerCount()).toBe(1);

    await close(view);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows no sync line once signed out", async () => {
    const { container } = await renderApp({ route: (path) => {
      if (path === "/me") return userResponse();
      if (path === "/logout") return new Response(null, { status: 204 });
      return undefined;
    } });
    await waitForCondition(() => syncLine(container) !== undefined);
    await click(container, "Sign out");
    await waitForCondition(hasText(container, "Account"));
    expect(syncLine(container)).toBeUndefined();
    expect(container.textContent).not.toContain(syncFailed);
  });

  it("re-syncs when the window gains focus", async () => {
    const { container } = await renderApp({ route: (path) => (path === "/me" ? userResponse() : undefined) });
    await waitForCondition(() => callsTo("/sync") === 1);

    await harnessAct(async () => {
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
    expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain(syncFailed);
  });

  const bodyTooLarge = "Sync is paused: your data is too large to send in one sync. Everything is still saved on this device.";

  it.each([
    ["request body too large", bodyTooLarge],
    ["too many cards", "Sync is paused: this account has more saved cards than sync can hold. Everything is still saved on this device."],
    ["too many practice days", "Sync is paused: this account has more practice days than sync can hold. Everything is still saved on this device."],
    ["too many lesson completions", "Sync is paused: this account has more completed lessons than sync can hold. Everything is still saved on this device."],
    ["something new", bodyTooLarge],
    [null, bodyTooLarge],
  ])("announces a 413 with code %s as paused sync", async (code, text) => {
    const { container } = await renderApp({ route: (path) => {
      if (path === "/me") return userResponse();
      if (path === "/sync") return new Response(code === null ? "too large" : JSON.stringify({ error: code }), { status: 413 });
      return undefined;
    } });
    await waitForCondition(() => liveRegions(container).includes(text));
    expect(container.textContent).not.toContain(syncFailed);
    expect(syncLine(container)).toBeUndefined();
  });

  it("still shows the failed text for a server error", async () => {
    const { container } = await renderApp({ route: (path) => {
      if (path === "/me") return userResponse();
      if (path === "/sync") return new Response(JSON.stringify({ error: "internal error" }), { status: 500 });
      return undefined;
    } });
    await waitForCondition(() => liveRegions(container).includes(syncFailed));
    expect(container.textContent).not.toContain("Sync is paused");
  });
});
