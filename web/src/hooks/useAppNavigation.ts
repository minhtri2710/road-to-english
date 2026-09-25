import { useEffect, useRef, useState } from "react";

import type { Lesson } from "../api/lessons";
import { readRoute, routeHash, type Route } from "../lib/route";

export function useAppNavigation(userLessons: Lesson[] | Error | null) {
  const [route, setRoute] = useState(readRoute);
  const shownRoute = useRef(route);
  const returnFocusId = useRef<string | null>(null);
  const headingFocus = useRef(false);
  const [, setHeadingFocusRequest] = useState(0);

  // A user view change focuses the new h1, or the row of the lesson being left when returnTo names it.
  // A pending return focus is dropped once the user moves on, so a late row mount cannot steal focus.
  const show = (next: Route, returnTo: string | null) => {
    returnFocusId.current = returnTo;
    headingFocus.current = returnTo === null;
    shownRoute.current = next;
    setRoute(next);
  };

  // In-app navigation pushes an entry, so browser Back retraces it. In-app Back also pushes the
  // library rather than calling history.back(): after a deep link that would leave the app.
  const navigate = (next: Route, returnTo: string | null = null) => {
    if (routeHash(next) !== window.location.hash) {
      window.history.pushState(null, "", routeHash(next));
    }
    show(next, returnTo);
  };

  const lessonId = (at: Route) => (at.view === "lesson" || at.view === "my" ? at.id : null);

  // Browser Back/Forward and hash edits are user view changes; returning to the library from a
  // lesson focuses that lesson's row. Both events can fire for one change, so a repeat is ignored.
  useEffect(() => {
    const follow = () => {
      const next = readRoute();
      const previous = shownRoute.current;
      if (routeHash(next) === routeHash(previous)) {
        return;
      }
      show(next, next.view === "library" ? lessonId(previous) : null);
    };
    window.addEventListener("popstate", follow);
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("hashchange", follow);
    };
  }, []);

  // Focuses the current view's h1 when it has not changed: the re-render hands it takeHeadingFocus again.
  const focusHeading = () => {
    headingFocus.current = true;
    setHeadingFocusRequest((request) => request + 1);
  };

  const takeHeadingFocus = () => {
    const take = headingFocus.current;
    headingFocus.current = false;
    return take;
  };

  // Once both lesson lists have settled, a return focus no row took (an unknown lesson id, or a
  // list that failed) goes to the view's h1 instead of dropping to <body>. Either list may settle last.
  const librarySettled = useRef(false);
  const settleReturnFocus = () => {
    if (returnFocusId.current !== null && librarySettled.current && userLessons !== null) {
      returnFocusId.current = null;
      focusHeading();
    }
  };

  // User-lesson rows take the return focus as they mount, before this runs.
  useEffect(() => {
    settleReturnFocus();
  }, [userLessons]);

  const takeReturnFocus = (id: string) => {
    if (returnFocusId.current !== id) {
      return false;
    }
    returnFocusId.current = null;
    return true;
  };

  const onLibrarySettled = (settled: boolean) => {
    librarySettled.current = settled;
    settleReturnFocus();
  };

  const userLesson =
    route.view === "my" && Array.isArray(userLessons)
      ? userLessons.find((lesson) => lesson.id === route.id)
      : undefined;
  // A user-lesson route whose lesson is unknown or deleted shows the library, and the URL follows.
  const missingUserLesson = route.view === "my" && userLessons !== null && userLesson === undefined;
  const view = missingUserLesson ? "library" : route.view;

  useEffect(() => {
    if (missingUserLesson) {
      const library: Route = { view: "library" };
      window.history.replaceState(null, "", routeHash(library));
      shownRoute.current = library;
      setRoute(library);
    }
  }, [missingUserLesson]);

  return {
    route,
    view,
    userLesson,
    navigate,
    lessonId,
    takeHeadingFocus,
    focusHeading,
    takeReturnFocus,
    onLibrarySettled,
  };
}
