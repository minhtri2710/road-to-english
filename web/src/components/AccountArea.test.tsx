import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accountDisclosure,
  buttonsNamed,
  callsTo,
  click,
  close,
  hasText,
  inputLabelled,
  openAccountForm,
  renderApp,
  resetApp,
  setInputValue,
  waitForCondition,
} from "../test/app";

describe("AccountArea", () => {
  afterEach(async () => {
    await resetApp();
    vi.useRealTimers();
  });

  // Renders signed out with the account form expanded.
  async function renderOpen(options?: Parameters<typeof renderApp>[0]) {
    const view = await renderApp(options);
    await openAccountForm(view.container);
    return view;
  }

  const signedOut = (path: string) => (path === "/me" ? new Response(null, { status: 401 }) : undefined);
  const user = () => new Response(JSON.stringify({ id: "user-1", email: "learner@example.com" }), { status: 200 });

  const modeGroup = (container: HTMLElement) => {
    const group = container.querySelector<HTMLElement>('[role="group"][aria-label="Sign in or create an account"]');
    if (!group) throw new Error("mode control not found");
    return group;
  };
  const modeButton = (container: HTMLElement, name: "Sign in" | "Create account") => {
    const button = buttonsNamed(modeGroup(container), name)[0];
    if (!button) throw new Error(`${name} mode not found`);
    return button;
  };
  const submitButton = (container: HTMLElement) => {
    const buttons = inputLabelled(container, "Email").form?.querySelectorAll<HTMLButtonElement>('button[type="submit"]');
    if (buttons?.length !== 1) throw new Error("expected one submit button");
    return buttons[0];
  };
  const showPassword = (container: HTMLElement) => {
    const button = buttonsNamed(container, "Show password")[0];
    if (!button) throw new Error("Show password not found");
    return button;
  };
  const describedText = (input: HTMLElement) =>
    (input.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");

  async function chooseMode(container: HTMLElement, name: "Sign in" | "Create account") {
    await act(async () => {
      modeButton(container, name).click();
    });
  }

  async function fill(container: HTMLElement, emailValue: string, passwordValue: string) {
    await act(async () => {
      setInputValue(inputLabelled(container, "Email"), emailValue);
      setInputValue(inputLabelled(container, "Password"), passwordValue);
    });
  }

  // Submits the way Enter in a field does.
  async function pressEnter(container: HTMLElement) {
    await act(async () => {
      inputLabelled(container, "Password").form?.requestSubmit();
    });
  }

  async function submit(container: HTMLElement, emailValue: string, passwordValue: string) {
    await fill(container, emailValue, passwordValue);
    await act(async () => {
      submitButton(container).click();
    });
  }

  it("signs in and signs out without reloading", async () => {
    const { container } = await renderOpen({
      route: (path) => {
        if (path === "/me") return new Response(null, { status: 401 });
        if (path === "/login") return user();
        if (path === "/logout") return new Response(null, { status: 204 });
      },
    });

    expect(container.textContent).not.toContain("learner@example.com");
    await submit(container, "learner@example.com", "password");
    await waitForCondition(hasText(container, "learner@example.com"));
    // The form that held focus is gone, so focus moves to the control that replaced it.
    expect(document.activeElement?.textContent).toBe("Sign out");

    await click(container, "Sign out");
    await waitForCondition(() => !(container.textContent?.includes("learner@example.com") ?? true));
    // Signed out, the header shows the collapsed disclosure with focus on it.
    expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(document.activeElement).toBe(accountDisclosure(container));
  });

  it("offers Sign in and Create account modes, Sign in first, with one submit button named for the mode", async () => {
    const { container } = await renderOpen();
    expect(modeButton(container, "Sign in").getAttribute("aria-pressed")).toBe("true");
    expect(modeButton(container, "Create account").getAttribute("aria-pressed")).toBe("false");
    expect(submitButton(container).textContent).toBe("Sign in");
    expect(submitButton(container).getAttribute("data-variant")).toBe("primary");

    await chooseMode(container, "Create account");
    expect(modeButton(container, "Sign in").getAttribute("aria-pressed")).toBe("false");
    expect(modeButton(container, "Create account").getAttribute("aria-pressed")).toBe("true");
    expect(submitButton(container).textContent).toBe("Create account");

    // Pressing the chosen mode again keeps it.
    await chooseMode(container, "Create account");
    expect(submitButton(container).textContent).toBe("Create account");
  });

  it("labels the fields and sets autocomplete by mode", async () => {
    const { container } = await renderOpen();
    const email = inputLabelled(container, "Email");
    expect(email.type).toBe("email");
    expect(email.autocomplete).toBe("email");
    expect(email.hasAttribute("aria-label")).toBe(false);
    expect(inputLabelled(container, "Password").autocomplete).toBe("current-password");

    await chooseMode(container, "Create account");
    expect(inputLabelled(container, "Password").autocomplete).toBe("new-password");
  });

  it("submits the current mode on Enter", async () => {
    const { container } = await renderOpen({
      route: (path) => (path === "/signup" || path === "/login" ? user() : signedOut(path)),
    });
    await chooseMode(container, "Create account");
    await fill(container, "learner@example.com", "password");
    await pressEnter(container);
    await waitForCondition(hasText(container, "learner@example.com"));
    expect(callsTo("/signup")).toBe(1);
    expect(callsTo("/login")).toBe(0);
  });

  it("switching mode keeps the email, clears the password and field error, and keeps focus on the control", async () => {
    const { container } = await renderOpen();
    await chooseMode(container, "Create account");
    await submit(container, "learner@example.com", "short");
    expect(inputLabelled(container, "Password").getAttribute("aria-invalid")).toBe("true");
    await act(async () => {
      showPassword(container).click();
    });

    const signIn = modeButton(container, "Sign in");
    await act(async () => {
      signIn.focus();
      signIn.click();
    });
    const password = inputLabelled(container, "Password");
    expect(inputLabelled(container, "Email").value).toBe("learner@example.com");
    expect(password.value).toBe("");
    expect(password.hasAttribute("aria-invalid")).toBe(false);
    expect(container.textContent).not.toContain("Password must be at least 8 characters.");
    expect(password.type).toBe("password");
    expect(showPassword(container).getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(signIn);
  });

  it("shows and hides the password from a pressed button that keeps focus", async () => {
    const { container } = await renderOpen();
    const password = inputLabelled(container, "Password");
    const toggle = showPassword(container);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(password.type).toBe("password");

    await act(async () => {
      toggle.focus();
      toggle.click();
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(password.type).toBe("text");
    expect(document.activeElement).toBe(toggle);

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(password.type).toBe("password");
  });

  it("hides the password again after a successful submit", async () => {
    const { container } = await renderOpen({
      route: (path) => {
        if (path === "/login") return user();
        if (path === "/logout") return new Response(null, { status: 204 });
        return signedOut(path);
      },
    });
    await act(async () => {
      showPassword(container).click();
    });
    await submit(container, "learner@example.com", "password");
    await waitForCondition(hasText(container, "learner@example.com"));
    await click(container, "Sign out");
    await waitForCondition(() => !(container.textContent?.includes("learner@example.com") ?? true));
    await openAccountForm(container);
    expect(inputLabelled(container, "Password").type).toBe("password");
    expect(showPassword(container).getAttribute("aria-pressed")).toBe("false");
  });

  it("describes the password rule up front only when creating an account", async () => {
    const { container } = await renderOpen();
    expect(describedText(inputLabelled(container, "Password"))).toBe("");
    expect(container.textContent).not.toContain("At least 8 characters.");

    await chooseMode(container, "Create account");
    expect(describedText(inputLabelled(container, "Password"))).toBe("At least 8 characters.");
  });

  it("rejects a short new password on the field without sending a request", async () => {
    const { container } = await renderOpen();
    await chooseMode(container, "Create account");
    await submit(container, "learner@example.com", "short");

    const password = inputLabelled(container, "Password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    // The error takes the helper's place, so the rule is said once.
    expect(describedText(password)).toBe("Password must be at least 8 characters.");
    expect(container.textContent).not.toContain("At least 8 characters.");

    // Once the error clears, the helper returns.
    await chooseMode(container, "Sign in");
    await chooseMode(container, "Create account");
    expect(inputLabelled(container, "Password").hasAttribute("aria-invalid")).toBe(false);
    expect(describedText(inputLabelled(container, "Password"))).toBe("At least 8 characters.");
    expect(container.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("Password must");
    expect(callsTo("/signup")).toBe(0);
  });

  it("keeps the 72-byte message for a new password that is too long", async () => {
    const { container } = await renderOpen();
    await chooseMode(container, "Create account");
    await submit(container, "learner@example.com", "é".repeat(37));

    expect(describedText(inputLabelled(container, "Password"))).toBe(
      "Password must be at least 8 characters (and at most 72 bytes).",
    );
    expect(container.textContent).not.toContain("At least 8 characters.");
    expect(callsTo("/signup")).toBe(0);
  });

  it("attaches a Create account 400 to the password field", async () => {
    const { container } = await renderOpen({
      route: (path) => (path === "/signup" ? new Response(null, { status: 400 }) : signedOut(path)),
    });
    await chooseMode(container, "Create account");
    await submit(container, "learner@example.com", "password");
    await waitForCondition(() => inputLabelled(container, "Password").getAttribute("aria-invalid") === "true");

    expect(describedText(inputLabelled(container, "Password"))).toContain(
      "Check your email address and password. Password must be at least 8 characters (and at most 72 bytes).",
    );
    expect(inputLabelled(container, "Email").hasAttribute("aria-invalid")).toBe(false);
  });

  it("attaches a 409 to the email field and offers Sign in keeping the email", async () => {
    const { container } = await renderOpen({
      route: (path) => (path === "/signup" ? new Response(null, { status: 409 }) : signedOut(path)),
    });
    await chooseMode(container, "Create account");
    await submit(container, "learner@example.com", "password");
    await waitForCondition(() => inputLabelled(container, "Email").getAttribute("aria-invalid") === "true");

    const email = inputLabelled(container, "Email");
    expect(describedText(email)).toBe("This email is already registered. Sign in instead?");
    expect(inputLabelled(container, "Password").hasAttribute("aria-invalid")).toBe(false);

    await click(container, "Sign in instead?");
    expect(modeButton(container, "Sign in").getAttribute("aria-pressed")).toBe("true");
    expect(submitButton(container).textContent).toBe("Sign in");
    expect(inputLabelled(container, "Email").value).toBe("learner@example.com");
    expect(inputLabelled(container, "Email").hasAttribute("aria-invalid")).toBe(false);
    expect(inputLabelled(container, "Password").value).toBe("");
    expect(document.activeElement).toBe(inputLabelled(container, "Password"));
  });

  it("shows a wrong sign-in as a form-level alert and stays signed out", async () => {
    const { container } = await renderOpen({
      route: (path) => (path === "/login" ? new Response(null, { status: 401 }) : signedOut(path)),
    });
    await submit(container, "learner@example.com", "wrong");
    await waitForCondition(hasText(container, "Invalid email or password."));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Invalid email or password.");
    expect(inputLabelled(container, "Email").hasAttribute("aria-invalid")).toBe(false);
    expect(inputLabelled(container, "Password").hasAttribute("aria-invalid")).toBe(false);
    expect(container.textContent).not.toContain("learner@example.com");
  });

  it("keeps the network message for an unreachable server", async () => {
    const { container } = await renderOpen({
      route: (path) => {
        if (path === "/login") throw new TypeError("Failed to fetch");
        return signedOut(path);
      },
    });
    await submit(container, "learner@example.com", "password");
    await waitForCondition(hasText(container, "Can't reach the server. You can keep practising on this device."));
  });

  it("sends no Create account request for an invalid email", async () => {
    const { container } = await renderOpen();
    await chooseMode(container, "Create account");
    await fill(container, "not-an-email", "password");
    await pressEnter(container);
    expect(callsTo("/signup")).toBe(0);
  });

  it("keeps the few-minutes line and an enabled submit for a 429 without Retry-After", async () => {
    const { container } = await renderOpen({
      route: (path) => (path === "/login" ? new Response(null, { status: 429 }) : signedOut(path)),
    });
    await submit(container, "learner@example.com", "password");
    await waitForCondition(hasText(container, "Too many attempts. Try again in a few minutes."));
    expect(submitButton(container).disabled).toBe(false);
  });

  describe("a 429 with Retry-After", () => {
    const limited = (seconds: number) => (path: string) =>
      path === "/login" || path === "/signup"
        ? new Response(null, { status: 429, headers: { "Retry-After": String(seconds) } })
        : signedOut(path);

    async function tick(seconds: number) {
      await act(async () => {
        vi.advanceTimersByTime(seconds * 1000);
      });
    }

    it("counts down each second with submit disabled, then clears and re-enables", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { container } = await renderOpen({ route: limited(3) });
      await submit(container, "learner@example.com", "password");
      await waitForCondition(hasText(container, "Too many attempts. Try again in 3 s"));
      expect(submitButton(container).disabled).toBe(true);

      await tick(1);
      expect(container.textContent).toContain("Too many attempts. Try again in 2 s");
      await tick(1);
      expect(container.textContent).toContain("Too many attempts. Try again in 1 s");
      expect(submitButton(container).disabled).toBe(true);
      await tick(1);
      expect(container.textContent).not.toContain("Too many attempts");
      expect(submitButton(container).disabled).toBe(false);
    });

    it("shows minutes from 60 s up and announces the wait once", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { container } = await renderOpen({ route: limited(90) });
      await submit(container, "learner@example.com", "password");
      await waitForCondition(hasText(container, "Too many attempts. Try again in 2 min"));
      const announced = () =>
        Array.from(container.querySelectorAll('[role="alert"], [role="status"]')).map((region) => region.textContent).join("|");
      expect(announced()).toContain("Too many attempts. Try again in 2 min");

      await tick(30);
      expect(container.textContent).toContain("Too many attempts. Try again in 1 min");
      await tick(1);
      expect(container.textContent).toContain("Too many attempts. Try again in 59 s");
      // The visible countdown is not a live region; the alert keeps its first wording.
      expect(announced()).not.toContain("59 s");
    });

    it("stops the countdown on mode switch", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { container } = await renderOpen({ route: limited(30) });
      const idle = vi.getTimerCount();
      await submit(container, "learner@example.com", "password");
      await waitForCondition(hasText(container, "Too many attempts. Try again in 30 s"));
      expect(vi.getTimerCount()).toBe(idle + 1);

      await chooseMode(container, "Create account");
      expect(container.textContent).not.toContain("Too many attempts");
      expect(submitButton(container).disabled).toBe(false);
      expect(vi.getTimerCount()).toBe(idle);
    });

    it("stops the countdown on unmount", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const view = await renderOpen({ route: limited(30) });
      await submit(view.container, "learner@example.com", "password");
      await waitForCondition(hasText(view.container, "Too many attempts. Try again in 30 s"));
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await close(view);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("disclosure", () => {
    const formRegion = (container: HTMLElement) => {
      const id = accountDisclosure(container).getAttribute("aria-controls");
      return id ? document.getElementById(id) : null;
    };
    const closeButton = (container: HTMLElement) => {
      const button = buttonsNamed(container, "Close")[0];
      if (!button) throw new Error("Close not found");
      return button;
    };
    async function pressEscape(container: HTMLElement) {
      await act(async () => {
        inputLabelled(container, "Email").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
    }

    it("starts collapsed and expands in place with focus on Email", async () => {
      const { container } = await renderApp();
      const disclosure = accountDisclosure(container);
      expect(disclosure.getAttribute("aria-expanded")).toBe("false");
      expect(disclosure.getAttribute("aria-controls")).toBeTruthy();
      expect(container.querySelector('input[type="email"]')).toBeNull();

      await act(async () => {
        disclosure.click();
      });
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(formRegion(container)?.contains(inputLabelled(container, "Email"))).toBe(true);
      expect(formRegion(container)?.querySelector('[aria-label="Sign in or create an account"]')).not.toBeNull();
      expect(document.activeElement).toBe(inputLabelled(container, "Email"));
    });

    it("collapses on Escape and on Close, returning focus to the disclosure", async () => {
      const { container } = await renderApp();
      await openAccountForm(container);
      await pressEscape(container);
      expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('input[type="email"]')).toBeNull();
      expect(document.activeElement).toBe(accountDisclosure(container));

      await openAccountForm(container);
      await act(async () => {
        closeButton(container).click();
      });
      expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(accountDisclosure(container));
    });

    it("stays open while a field error shows", async () => {
      const { container } = await renderOpen();
      await chooseMode(container, "Create account");
      await submit(container, "learner@example.com", "short");
      await pressEscape(container);
      expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("true");
      expect(closeButton(container).disabled).toBe(true);
      await act(async () => {
        closeButton(container).click();
        accountDisclosure(container).click();
      });
      expect(inputLabelled(container, "Password").getAttribute("aria-invalid")).toBe("true");
    });

    it("stays open while the form-level error shows", async () => {
      const { container } = await renderOpen({
        route: (path) => (path === "/login" ? new Response(null, { status: 401 }) : signedOut(path)),
      });
      await submit(container, "learner@example.com", "wrong");
      await waitForCondition(hasText(container, "Invalid email or password."));
      await pressEscape(container);
      expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("true");
      expect(closeButton(container).disabled).toBe(true);
    });

    it("stays open during a 429 countdown and collapses once it ends", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { container } = await renderOpen({
        route: (path) =>
          path === "/login" ? new Response(null, { status: 429, headers: { "Retry-After": "2" } }) : signedOut(path),
      });
      await submit(container, "learner@example.com", "password");
      await waitForCondition(hasText(container, "Too many attempts. Try again in 2 s"));
      await pressEscape(container);
      expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("true");

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(closeButton(container).disabled).toBe(false);
      await pressEscape(container);
      expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("false");
    });

    it("shows the expired message beside the collapsed disclosure without opening the form", async () => {
      const { container } = await renderApp({ route: (path) => {
        if (path === "/me") return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), { status: 200 });
        if (path === "/sync") return new Response(null, { status: 401 });
        return undefined;
      } });
      await waitForCondition(hasText(container, "You were signed out. Sign in again to sync."));
      expect(accountDisclosure(container).getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('input[type="email"]')).toBeNull();
    });
  });
});
