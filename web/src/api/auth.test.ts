import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMe, signIn, signOut, signUp } from "./auth";

const fetchMock = vi.fn<typeof fetch>();

const user = { id: "user-1", email: "learner@example.com" };

function expectAuthRequest(
  path: string,
  method: string,
  body?: { email: string; password: string },
): void {
  expect(fetchMock).toHaveBeenCalledWith(
    path,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        }
      : { method, credentials: "include" },
  );
}

describe("auth API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("signs up with the session cookie included", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signUp(user.email, "password")).resolves.toEqual(user);
    expectAuthRequest("/signup", "POST", { email: user.email, password: "password" });
  });

  it("signs in with the session cookie included", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signIn(user.email, "password")).resolves.toEqual(user);
    expectAuthRequest("/login", "POST", { email: user.email, password: "password" });
  });

  it("signs out with the session cookie included", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signOut()).resolves.toBeUndefined();
    expectAuthRequest("/logout", "POST");
  });

  it("restores a session or returns null for the normal signed-out response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(user), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMe()).resolves.toEqual(user);
    expectAuthRequest("/me", "GET");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(fetchMe()).resolves.toBeNull();
    expectAuthRequest("/me", "GET");
  });

  it.each([409, 401, 400])("throws ApiError with status %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signIn(user.email, "password")).rejects.toMatchObject({ status });
  });
});
