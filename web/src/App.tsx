import { useEffect, useRef, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Heading } from "@astryxdesign/core/Heading";
import { Theme } from "@astryxdesign/core/theme";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { VStack } from "@astryxdesign/core/VStack";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "./api/lessons";
import { AccountArea } from "./components/AccountArea";
import { BackupControls } from "./components/BackupControls";
import { Alert, ErrorBoundary, Status, ViewHeading } from "./components/feedback";
import { sharedStyles } from "./components/styles";
import { useAuth } from "./hooks/auth";
import { useUserLessons } from "./hooks/lessons";
import { useProgress } from "./hooks/progress";
import { useDailyGoal } from "./hooks/useDailyGoal";
import { useLastLesson } from "./hooks/useLastLesson";
import { useLevelFilter } from "./hooks/useLevelFilter";
import { useSync } from "./hooks/useSync";
import { useVocabDeck } from "./hooks/vocab";
import { capNewCards } from "./lib/vocab";
import { readRoute, routeHash, type Route } from "./lib/route";
import { LessonDetail, LibraryLessonDetail } from "./lesson/LessonDetail";
import { ImportTextForm } from "./library/ImportTextForm";
import { LessonList } from "./library/LessonList";
import { UserLessonList } from "./library/UserLessonList";
import { ReviewDeck } from "./review/ReviewDeck";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";

// The return-focus id the Your data heading takes, like a lesson row takes its lesson id.
const YOUR_DATA = "your-data";

const appStyles = stylex.create({
  page: {
    minHeight: "100vh",
    // Narrow screens give the spacing back to the first screen of lessons.
    padding: { default: "2rem", "@media (max-width: 480px)": "1rem" },
    backgroundColor: "var(--color-background-body)",
    color: "var(--color-text-primary)",
  },
  content: {
    width: "100%",
    maxWidth: "48rem",
    marginInline: "auto",
  },
  header: {
    marginBottom: { default: "2rem", "@media (max-width: 480px)": 0 },
  },
});

// The one Theme wraps the ErrorBoundary, so its fallback renders styled like the App.
export function App() {
  return (
    <Theme theme={neutralTheme}>
      <ErrorBoundary>
        <AppViews />
      </ErrorBoundary>
    </Theme>
  );
}

function AppViews() {
  const [route, setRoute] = useState(readRoute);
  const shownRoute = useRef(route);
  const {
    lessons: userLessons,
    reload: reloadUserLessons,
    create: createUserLesson,
    remove: removeUserLesson,
  } = useUserLessons();
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const deck = useVocabDeck();
  const progress = useProgress();
  const reviewDeck = capNewCards(deck.due, progress.newCardsToday);
  const storageError =
    deck.error ?? progress.error ?? (userLessons instanceof Error ? userLessons : null);
  const { dailyGoal, goalMet, goalAnnounced, armGoal, disarmGoal, chooseGoal } = useDailyGoal(progress.actionsToday);
  const recordPractice = async (options: { newCard: boolean }) => {
    armGoal();
    if (!(await progress.recordPractice(options))) {
      disarmGoal();
    }
  };
  const { levelFilter, chooseLevelFilter } = useLevelFilter();
  const auth = useAuth();
  const syncLine = useSync(auth, deck, progress);
  const returnFocusId = useRef<string | null>(null);
  const headingFocus = useRef(false);
  const [, setHeadingFocusRequest] = useState(0);
  const userLessonsHeading = useRef<HTMLHeadingElement>(null);
  const [storageKept, setStorageKept] = useState<boolean | null>(null);
  const persistRequested = useRef(false);

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

  // Ask once per app start; StrictMode's second effect run keeps the ref and skips.
  useEffect(() => {
    if (persistRequested.current) {
      return;
    }
    persistRequested.current = true;
    if (typeof navigator.storage?.persist !== "function") {
      setStorageKept(false);
      return;
    }
    navigator.storage.persist().then(setStorageKept, () => setStorageKept(false));
  }, []);

  const createLesson = async (lesson: Lesson) => {
    await createUserLesson(lesson);
    navigate({ view: "my", id: lesson.id });
  };

  const deleteLesson = async (lesson: Lesson) => {
    if (!window.confirm(`Delete "${lesson.title}"? Cards saved from it stay in your deck.`)) {
      return;
    }
    setDeleteFailedId(null);
    try {
      await removeUserLesson(lesson.id);
    } catch {
      setDeleteFailedId(lesson.id);
      return;
    }
    // The deleted row took the focused Delete with it.
    userLessonsHeading.current?.focus();
  };

  const reloadAfterImport = async () => {
    await Promise.all([deck.reload(), progress.reload(), reloadUserLessons()]);
  };

  const userLesson =
    route.view === "my" && Array.isArray(userLessons)
      ? userLessons.find((lesson) => lesson.id === route.id)
      : undefined;
  // A user-lesson route whose lesson is unknown or deleted shows the library, and the URL follows.
  const missingUserLesson = route.view === "my" && userLessons !== null && userLesson === undefined;
  const view = missingUserLesson ? "library" : route.view;
  const lastLesson = useLastLesson(route.view === "lesson" || (route.view === "my" && userLesson) ? route : null);

  useEffect(() => {
    if (missingUserLesson) {
      const library: Route = { view: "library" };
      window.history.replaceState(null, "", routeHash(library));
      shownRoute.current = library;
      setRoute(library);
    }
  }, [missingUserLesson]);

  const detailProps = {
    onBack: () => navigate({ view: "library" }, lessonId(route)),
    savedCardIds: deck.savedCardIds,
    addCard: deck.addCard,
    removeCard: deck.removeCard,
    undoRemove: deck.undoRemove,
    recordPractice,
    completedLessons: progress.completedLessons,
    markLessonComplete: progress.markLessonComplete,
    takeHeadingFocus,
  };

  return (
    <div className={stylex.props(appStyles.page).className}>
      <div className={stylex.props(appStyles.content).className}>
        <VStack gap={4}>
          <VStack as="header" gap={1} xstyle={appStyles.header}>
            {/* Only reaching the goal is announced; the count lives in the library's Today card. */}
            <Status>
              {goalAnnounced && <Text type="supporting">Daily goal met.</Text>}
            </Status>
            {storageKept === false && (
              <Banner
                status="info"
                title="Progress saved only in this browser"
                endContent={
                  <Button label="Back up" variant="secondary" onClick={() => navigate({ view: "library" }, YOUR_DATA)} />
                }
              />
            )}
            {storageError && (
              <Alert>
                Your saved data couldn't be read or saved on this device: {storageError.message}. Reload to try again.
              </Alert>
            )}
            {backupError && <Alert>Backup error: {backupError}</Alert>}
            {/* The synced line changes every minute, so the live region carries only problems and one "Synced." after a failure. */}
            <Status>
              {syncLine?.status === "failed" && <Text as="p" type="supporting">{syncLine.text}</Text>}
              {syncLine?.status === "ownerMismatch" && (
                <Text as="p" color="primary" xstyle={sharedStyles.error}>
                  {syncLine.text}
                </Text>
              )}
              {syncLine?.recovered && <VisuallyHidden>Synced.</VisuallyHidden>}
            </Status>
            {syncLine?.status === "synced" && <Text as="p" type="supporting">{syncLine.text}</Text>}
            <AccountArea auth={auth} />
          </VStack>
          <nav aria-label="Views" className={stylex.props(sharedStyles.viewToggle).className}>
            <ToggleButtonGroup
              label="App view"
              // Inside a lesson no view is pressed, so Library and Review both navigate.
              value={view === "review" || view === "library" ? view : null}
              onChange={(nextView) => {
                if (nextView) {
                  navigate({ view: nextView as "library" | "review" });
                }
              }}
            >
              <ToggleButton value="library" label="Library" />
              <ToggleButton value="review" label="Review" />
            </ToggleButtonGroup>
          </nav>
          <VStack as="main" gap={4}>
            {(view === "review" || view === "library") && (
              <VStack gap={1}>
                <ViewHeading takeFocus={takeHeadingFocus}>
                  {view === "library" ? "Lesson library" : "Review deck"}
                </ViewHeading>
                <Text type="large">
                  {view === "library"
                    ? "Choose a lesson to practise reading and speaking."
                    : "Review saved sentences with spaced repetition."}
                </Text>
              </VStack>
            )}
            {view === "review" ? (
              <VStack gap={2}>
                <Badge label={`${reviewDeck.length} due`} variant="info" />
                <ReviewDeck
                  due={reviewDeck}
                  hiddenNew={deck.due.length - reviewDeck.length}
                  nextDueInMinutes={deck.nextDueInMinutes}
                  hasCards={deck.savedCardIds.size > 0}
                  loading={deck.loading}
                  loadFailed={deck.error !== null}
                  review={deck.review}
                  recordPractice={recordPractice}
                  onGoToLibrary={() => navigate({ view: "library" })}
                />
              </VStack>
            ) : view === "library" ? (
              <VStack gap={4}>
                <LessonList
                  onSelect={(id) => navigate({ view: "lesson", id })}
                  completedLessons={progress.completedLessons}
                  takeFocus={takeReturnFocus}
                  focusHeading={focusHeading}
                  onSettled={(settled) => {
                    librarySettled.current = settled;
                    settleReturnFocus();
                  }}
                  levelFilter={levelFilter}
                  chooseLevelFilter={chooseLevelFilter}
                  lastLesson={lastLesson}
                  ownLessons={Array.isArray(userLessons) ? userLessons : []}
                  onContinue={() => lastLesson && navigate(lastLesson)}
                  today={{
                    due: deck.error === null && !deck.loading ? reviewDeck.length : null,
                    actionsToday: progress.actionsToday,
                    dailyGoal,
                    goalMet,
                    chooseGoal,
                    streak: progress.streak,
                    freezes: progress.freezes,
                    xp: progress.xp,
                    week: progress.week,
                    onReview: () => navigate({ view: "review" }),
                  }}
                />
                <VStack gap={2}>
                  <Heading level={2} ref={userLessonsHeading} tabIndex={-1}>Your lessons</Heading>
                  <UserLessonList
                    lessons={userLessons}
                    onSelect={(lesson) => navigate({ view: "my", id: lesson.id })}
                    onDelete={(lesson) => void deleteLesson(lesson)}
                    deleteFailedId={deleteFailedId}
                    completedLessons={progress.completedLessons}
                    takeFocus={takeReturnFocus}
                    onCreateLesson={() => document.getElementById("import-title")?.focus()}
                  />
                </VStack>
                <ImportTextForm onCreate={createLesson} levelFilter={levelFilter} />
                <VStack as="section" gap={2} aria-labelledby={YOUR_DATA}>
                  <Heading
                    id={YOUR_DATA}
                    level={2}
                    tabIndex={-1}
                    ref={(heading) => {
                      if (heading && takeReturnFocus(YOUR_DATA)) {
                        heading.focus();
                      }
                    }}
                  >
                    Your data
                  </Heading>
                  <Text as="p" type="supporting">
                    Export saves a backup file of your cards, progress and lessons. Export CSV saves your cards for a
                    spreadsheet. Import replaces the data on this device with a backup file.
                  </Text>
                  <BackupControls signedIn={auth.user !== null} setError={setBackupError} onImported={reloadAfterImport} />
                  {storageKept !== null && (
                    <Text as="p" type="supporting">
                      {storageKept
                        ? "Storage: kept on this device."
                        : "This browser may clear your saved progress when space is low. Export a backup or sign in to keep it."}
                    </Text>
                  )}
                </VStack>
              </VStack>
            ) : route.view === "lesson" ? (
              <LibraryLessonDetail key={route.id} id={route.id} {...detailProps} />
            ) : userLesson ? (
              <LessonDetail key={userLesson.id} lesson={userLesson} {...detailProps} />
            ) : (
              <Text as="p">Loading lesson...</Text>
            )}
          </VStack>
        </VStack>
      </div>
    </div>
  );
}
