import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  buttonsNamed,
  callsTo,
  renderApp,
  resetApp,
  setInputValue,
  waitForCondition,
} from "../test/app";

describe("AccountArea", () => {
  afterEach(resetApp);

  async function fillAccountForm(container: HTMLElement, emailValue: string, passwordValue: string, buttonText: string) {
    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("account form not found");
    await act(async () => {
      setInputValue(email, emailValue);
      setInputValue(password, passwordValue);
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === buttonText)
        ?.click();
    });
  }

  it("signs in and signs out without reloading", async () => {
    const { container } = await renderApp({
      route: (path) => {
        if (path === "/me") return new Response(null, { status: 401 });
        if (path === "/login") {
          return new Response(JSON.stringify({ id: "user-1", email: "learner@example.com" }), {
            status: 200,
          });
        }
        if (path === "/logout") return new Response(null, { status: 204 });
      },
    });

    expect(container.textContent).not.toContain("learner@example.com");
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
    await waitForCondition(() => container.textContent?.includes("learner@example.com") ?? false);
    // The form that held focus is gone, so focus moves to the control that replaced it.
    expect(document.activeElement?.textContent).toBe("Sign out");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign out")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("Sign in") ?? false);
    expect(container.textContent).not.toContain("learner@example.com");
    expect(document.activeElement).toBe(container.querySelector('input[aria-label="Email"]'));
  });

  it("rejects a short sign-up password without sending a request", async () => {
    const { container } = await renderApp();

    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-up form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "short");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign up")
        ?.click();
    });

    expect(container.textContent).toContain(
      "Password must be at least 8 characters (and at most 72 bytes).",
    );
    expect(callsTo("/signup")).toBe(0);
  });

  it("shows the email and password message for a sign-up 400", async () => {
    const { container } = await renderApp({
      route: (path) => {
        if (path === "/signup") return new Response(null, { status: 400 });
      },
    });

    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-up form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "password");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign up")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes(
      "Check your email address and password. Password must be at least 8 characters (and at most 72 bytes).",
    ) ?? false);

    expect(container.textContent).toContain(
      "Check your email address and password. Password must be at least 8 characters (and at most 72 bytes).",
    );
  });

  it("shows an inline sign-in error and stays signed out", async () => {
    const { container } = await renderApp({
      route: (path) => {
        if (path === "/me" || path === "/login") return new Response(null, { status: path === "/me" ? 401 : 401 });
      },
    });

    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-in form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "wrong");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign in")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("Invalid email or password.") ?? false);
    expect(container.querySelector('input[aria-label="Email"]')).not.toBeNull();
    expect(container.textContent).not.toContain("learner@example.com");
  });

  it("sends no sign-up request for an invalid email", async () => {
    const { container } = await renderApp();
    await fillAccountForm(container, "not-an-email", "password", "Sign up");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(callsTo("/signup")).toBe(0);
  });

  it("shows the too-many-attempts line for a 429", async () => {
    const { container } = await renderApp({ route: (path) => (path === "/login" ? new Response(null, { status: 429 }) : undefined) });
    await fillAccountForm(container, "learner@example.com", "password", "Sign in");
    await waitForCondition(() => container.textContent?.includes("Too many attempts. Try again in a few minutes.") ?? false);
  });

  it("makes Enter's action, Sign in, the primary button and keeps Sign up on the keyboard", async () => {
    const view = await renderApp();
    const form = view.container.querySelector<HTMLInputElement>('input[aria-label="Email"]')?.form;
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    const signUp = form ? buttonsNamed(form, "Sign up")[0] : undefined;
    expect(form?.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(submit?.textContent).toBe("Sign in");
    expect(submit?.getAttribute("data-variant")).toBe("primary");
    expect(form?.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(signUp?.type).toBe("button");
    expect(signUp?.disabled).toBe(false);
    expect(signUp?.tabIndex).toBe(0);
  });
});
