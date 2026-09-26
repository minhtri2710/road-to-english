import { afterEach, describe, expect, it } from "vitest";

import { parseRoute, readRoute, routeHash, type Route } from "./route";

describe("routes", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it.each<Route>([
    { view: "library" },
    { view: "review" },
    { view: "manage" },
    { view: "lesson", id: "greetings-basics" },
    { view: "my", id: "user-00000000-0000-4000-8000-000000000001" },
    { view: "lesson", id: "a/b c#?%" },
  ])("round-trips %j through its hash", (route) => {
    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it("parses the Manage hash route", () => {
    expect(parseRoute("#/manage")).toEqual({ view: "manage" });
    expect(routeHash({ view: "manage" })).toBe("#/manage");
  });

  it("encodes a lesson id into one path segment", () => {
    expect(routeHash({ view: "lesson", id: "a/b" })).toBe("#/lesson/a%2Fb");
  });

  it.each(["", "#", "#/"])("reads %j as the library", (hash) => {
    expect(parseRoute(hash)).toEqual({ view: "library" });
  });

  it.each(["#/nope", "#/lesson", "#/lesson/", "#/lesson/a/b", "#/review/x", "#/my/%E0%A4%A", "lesson/a"])(
    "rejects %j",
    (hash) => {
      expect(parseRoute(hash)).toBeNull();
    },
  );

  it("replaces a malformed hash with the library's", () => {
    window.history.replaceState(null, "", "#/nope");
    const length = window.history.length;
    expect(readRoute()).toEqual({ view: "library" });
    expect(window.location.hash).toBe("#/");
    expect(window.history.length).toBe(length);
  });

  it("reads a valid hash without touching history", () => {
    window.history.replaceState(null, "", "#/my/x%20y");
    expect(readRoute()).toEqual({ view: "my", id: "x y" });
    expect(window.location.hash).toBe("#/my/x%20y");
  });
});
