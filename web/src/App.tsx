import { useRef, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Heading } from "@astryxdesign/core/Heading";
import { Theme } from "@astryxdesign/core/theme";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "./api/lessons";
import { AppHeader } from "./components/AppHeader";
import { ErrorBoundary, ViewHeading } from "./components/feedback";
import { sharedStyles } from "./components/styles";
import { YOUR_DATA, YourData } from "./components/YourData";
import { useAuth } from "./hooks/auth";
import { useUserLessons } from "./hooks/lessons";
import { useProgress } from "./hooks/progress";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useDailyGoal } from "./hooks/useDailyGoal";
import { useLastLesson } from "./hooks/useLastLesson";
import { useLevelFilter } from "./hooks/useLevelFilter";
import { useStorageKept } from "./hooks/useStorageKept";
import { useSync } from "./hooks/useSync";
import { useVocabDeck } from "./hooks/vocab";
import { todayKey } from "./lib/progress";
import { capNewCards } from "./lib/vocab";
import { LessonDetail, LibraryLessonDetail } from "./lesson/LessonDetail";
import { ImportTextForm } from "./library/ImportTextForm";
import { LessonList } from "./library/LessonList";
import { UserLessonList } from "./library/UserLessonList";
import { ReviewDeck } from "./review/ReviewDeck";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";

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
  const {
    lessons: userLessons,
    reload: reloadUserLessons,
    create: createUserLesson,
    remove: removeUserLesson,
  } = useUserLessons();
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  const { route, view, userLesson, navigate, lessonId, takeHeadingFocus, focusHeading, takeReturnFocus, onLibrarySettled } =
    useAppNavigation(userLessons);
  const [backupError, setBackupError] = useState<string | null>(null);
  const deck = useVocabDeck();
  const progress = useProgress();
  const reviewDeck = capNewCards(deck.due, progress.newCardsToday);
  const storageError =
    deck.error ?? progress.error ?? (userLessons instanceof Error ? userLessons : null);
  const { dailyGoal, goalMet, goalAnnounced, practiceCommitted, chooseGoal } = useDailyGoal(progress.actionsToday);
  // A save that resolves after local midnight committed the previous day's count, which never announces.
  const recordPractice = async (options: { newCard: boolean }) => {
    const committed = await progress.recordPractice(options);
    if (committed !== null && committed.date === todayKey(new Date())) {
      practiceCommitted(committed.actions);
    }
  };
  const { levelFilter, chooseLevelFilter } = useLevelFilter();
  // Cards due now, or null while the deck is loading or failed to load.
  const due = deck.error === null && !deck.loading ? reviewDeck.length : null;
  const auth = useAuth();
  const syncLine = useSync(auth, deck, progress);
  const userLessonsHeading = useRef<HTMLHeadingElement>(null);
  const storageKept = useStorageKept();

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

  const lastLesson = useLastLesson(route.view === "lesson" || (route.view === "my" && userLesson) ? route : null);

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
    due,
    onReview: () => navigate({ view: "review" }),
    source:
      route.view === "my"
        ? { view: "my" as const, lessons: Array.isArray(userLessons) ? userLessons : [] }
        : { view: "lesson" as const, levelFilter },
    openLesson: (id: string) => navigate({ view: route.view === "my" ? "my" : "lesson", id }),
  };

  return (
    <div className={stylex.props(appStyles.page).className}>
      <div className={stylex.props(appStyles.content).className}>
        <VStack gap={4}>
          <AppHeader
            goalAnnounced={goalAnnounced}
            storageKept={storageKept}
            storageError={storageError}
            backupError={backupError}
            syncLine={syncLine}
            auth={auth}
            onBackUp={() => navigate({ view: "library" }, YOUR_DATA)}
          />
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
                  onSettled={onLibrarySettled}
                  levelFilter={levelFilter}
                  chooseLevelFilter={chooseLevelFilter}
                  lastLesson={lastLesson}
                  ownLessons={Array.isArray(userLessons) ? userLessons : []}
                  onContinue={() => lastLesson && navigate(lastLesson)}
                  today={{
                    due,
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
                <YourData
                  storageKept={storageKept}
                  signedIn={auth.user !== null}
                  setError={setBackupError}
                  onImported={reloadAfterImport}
                  takeReturnFocus={takeReturnFocus}
                />
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
