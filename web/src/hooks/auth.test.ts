import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe, signIn, type AuthUser } from "../api/auth";
import { useAuth, type AuthState } from "./auth";

vi.mock("../api/auth", () => ({
  fetchMe: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

const user: AuthUser = { id: "u1", email: "learner@example.com" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
