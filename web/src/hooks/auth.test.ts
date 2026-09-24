import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe, signIn, type AuthUser } from "../api/auth";
import { useAuth, type AuthState } from "./auth";
import { deferred } from "../test/fixtures";

vi.mock("../api/auth", () => ({
  fetchMe: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

const user: AuthUser = { id: "u1", email: "learner@example.com" };

let state: AuthState;
let root: Root;
let container: HTMLDivElement;

function Probe() {
  state = useAuth();
  return null;
}

async function mount() {
  await act(async () => {
    root.render(createElement(Probe));
  });
}

async function mountStrict() {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Probe)));
  });
}

async function signInNow() {
  vi.mocked(signIn).mockResolvedValueOnce(user);
  await act(async () => {
    await state.signIn(user.email, "correct password");
  });
}

describe("useAuth", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  it("keeps a sign-in error when a /me pending during the sign-in resolves signed out", async () => {
    const me = deferred<AuthUser | null>();
    vi.mocked(fetchMe).mockReturnValue(me.promise);
    await mountStrict();

    const rejected = new Error("Invalid email or password.");
    vi.mocked(signIn).mockRejectedValueOnce(rejected);
    await act(async () => {
      await state.signIn(user.email, "wrong password").catch(() => undefined);
    });
    expect(state.error).toBe(rejected);
    await act(async () => me.resolve(null));

    expect(state.user).toBeNull();
    expect(state.error).toBe(rejected);
    expect(state.loading).toBe(false);
  });

  it("clears a /me network error when the online retry of /me succeeds", async () => {
    vi.mocked(fetchMe).mockRejectedValue(new TypeError("Failed to fetch"));
    await mountStrict();
    expect(state.error).toBeInstanceOf(TypeError);

    vi.mocked(fetchMe).mockResolvedValue(user);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(state.user).toEqual(user);
    expect(state.error).toBeNull();
  });

  it("keeps a manual sign-in when the initial /me later resolves signed out", async () => {
    const me = deferred<AuthUser | null>();
    vi.mocked(fetchMe).mockReturnValueOnce(me.promise);
    await mount();

    await signInNow();
    await act(async () => me.resolve(null));

    expect(state.user).toEqual(user);
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("keeps a manual sign-in when the online retry of /me later resolves signed out", async () => {
    vi.mocked(fetchMe).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await mount();
    expect(state.error).toBeInstanceOf(TypeError);

    const retry = deferred<AuthUser | null>();
    vi.mocked(fetchMe).mockReturnValueOnce(retry.promise);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchMe).toHaveBeenCalledTimes(2);

    await signInNow();
    await act(async () => retry.resolve(null));

    expect(state.user).toEqual(user);
    expect(state.error).toBeNull();
  });

  it("sets no error when /me rejects after a manual sign-in", async () => {
    const me = deferred<AuthUser | null>();
    vi.mocked(fetchMe).mockReturnValueOnce(me.promise);
    await mount();

    await signInNow();
    await act(async () => me.reject(new TypeError("Failed to fetch")));

    expect(state.user).toEqual(user);
    expect(state.error).toBeNull();
    expect(state.loading).toBe(false);

    // The late rejection must not arm the online retry either.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchMe).toHaveBeenCalledTimes(1);
  });
});
