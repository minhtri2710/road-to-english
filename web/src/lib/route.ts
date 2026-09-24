// The hash route is the one source of truth for the view and the open lesson. Hash URLs need no
// server fallback, so any static host serves them.
export type Route =
  | { view: "library" }
  | { view: "review" }
  | { view: "lesson"; id: string }
  | { view: "my"; id: string };

export function routeHash(route: Route): string {
  switch (route.view) {
    case "library":
      return "#/";
    case "review":
      return "#/review";
    default:
      return `#/${route.view}/${encodeURIComponent(route.id)}`;
  }
}

export function parseRoute(hash: string): Route | null {
  if (hash === "" || hash === "#" || hash === "#/") {
    return { view: "library" };
  }
  if (hash === "#/review") {
    return { view: "review" };
  }
  const match = /^#\/(lesson|my)\/([^/]+)$/.exec(hash);
  if (!match) {
    return null;
  }
  try {
    return { view: match[1] as "lesson" | "my", id: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

// A malformed hash falls back to the library and replaces its history entry.
export function readRoute(): Route {
  const route = parseRoute(window.location.hash);
  if (route) {
    return route;
  }
  window.history.replaceState(null, "", routeHash({ view: "library" }));
  return { view: "library" };
}
