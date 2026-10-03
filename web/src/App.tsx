import { useRef, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Theme } from "@astryxdesign/core/theme";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import * as stylex from "@stylexjs/stylex";

import type { Lesson } from "./api/lessons";
import { AppFooter } from "./components/AppFooter";
import { AppHeader } from "./components/AppHeader";
import { ErrorBoundary, ViewHeading } from "./components/feedback";
import { sharedStyles } from "./components/styles";
import { YourData } from "./components/YourData";
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
import { useT } from "./i18n";
import { todayKey } from "./lib/progress";
import { capNewCards } from "./lib/vocab";
import { projectTheme } from "./theme";
import { LessonDetail, LibraryLessonDetail } from "./lesson/LessonDetail";
import { IMPORT_TITLE, ImportTextForm } from "./library/ImportTextForm";
import { LessonList } from "./library/LessonList";
import { UserLessonList } from "./library/UserLessonList";
import { Landing } from "./landing/Landing";
import { ReviewDeck } from "./review/ReviewDeck";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";

const appStyles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: "var(--color-background-body)",
    color: "var(--color-text-primary)",
  },
  content: {
    width: "100%",
    maxWidth: "48rem",
    marginInline: "auto",
    // Narrow screens give the spacing back to the first screen of lessons.
    padding: {
      default: "var(--spacing-6) var(--spacing-6) var(--spacing-12)",
      "@media (max-width: 480px)": "var(--spacing-2) var(--spacing-4) var(--spacing-8)",
    },
  },
  // The library lays its lessons out in columns, so it takes the header's full width.
  wide: {
    maxWidth: "72rem",
  },
  reviewDue: {
    alignSelf: "start",
  },
  // The library's hero text, beside Today as on the design's hero.
  intro: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: { default: "var(--spacing-1)", "@media (min-width: 481px)": "var(--spacing-4)" },
    minWidth: 0,
  },
  chips: {
    display: { default: "flex", "@media (max-width: 480px)": "none" },
    flexWrap: "wrap",
    gap: "var(--spacing-2)",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  chip: {
    padding: "var(--spacing-1) var(--spacing-3)",
    borderRadius: "var(--radius-full)",
    fontSize: "var(--text-supporting-size)",
    fontWeight: "var(--font-weight-bold)",
    letterSpacing: "0.04em",
  },
  listenChip: { backgroundColor: "var(--color-accent-muted)", color: "var(--color-accent)" },
  speakChip: { backgroundColor: "var(--rte-color-speak-muted)", color: "var(--rte-color-speak)" },
  unlockChip: { backgroundColor: "var(--color-background-muted)", color: "var(--color-text-secondary)" },
  display: {
    fontSize: { default: null, "@media (min-width: 481px)": "3rem" },
    lineHeight: { default: null, "@media (min-width: 481px)": 1.1 },
    letterSpacing: { default: null, "@media (min-width: 481px)": "-0.02em" },
  },
  lead: {
    maxWidth: "32rem",
    color: "var(--color-text-secondary)",
  },
  // Phones keep the first screen for lessons; the footer links How it works too.
  introLink: {
    display: { default: "inline-flex", "@media (max-width: 480px)": "none" },
  },
});

// The one Theme wraps the ErrorBoundary, so its fallback renders styled like the App.
export function App() {
  return (
    <Theme theme={projectTheme}>
      <ErrorBoundary>
        <AppViews />
      </ErrorBoundary>
    </Theme>
  );
}

function AppViews() {
  const t = useT();
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
    if (!window.confirm(t('Delete "{title}"? Cards saved from it stay in your deck.', { title: lesson.title }))) {
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
  const appView = view === "lesson" || view === "my" ? null : view;

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
      <AppHeader
        goalAnnounced={goalAnnounced}
        storageKept={storageKept}
        storageError={storageError}
        backupError={backupError}
        syncLine={syncLine}
        auth={auth}
        view={appView}
        due={due}
        cta={
          lastLesson && !(route.view === lastLesson.view && route.id === lastLesson.id)
            ? { label: t("Continue practising"), onClick: () => navigate(lastLesson) }
            : view !== "library" && !lastLesson
              ? { label: t("Start practising"), onClick: () => navigate({ view: "library" }) }
              : null
        }
        onNavigate={navigate}
      />
      <div className={stylex.props(appStyles.content, view !== "review" && view !== "manage" && appStyles.wide).className}>
        <VStack as="main" gap={2}>
          {(view === "review" || view === "manage") && (
            <VStack gap={1}>
              <ViewHeading takeFocus={takeHeadingFocus}>
                {view === "review" ? t("Review deck") : t("Manage lessons and data")}
              </ViewHeading>
              <Text type="large">
                {view === "review" ? t("Review saved sentences with spaced repetition.") : t("Create lessons, import text, and manage your data.")}
              </Text>
            </VStack>
          )}
          {view === "about" ? (
            <Landing
              takeHeadingFocus={takeHeadingFocus}
              onStart={() => navigate({ view: "library" })}
              onOpenLesson={(id) => navigate({ view: "lesson", id })}
            />
          ) : view === "review" ? (
            <VStack gap={2}>
              <Badge label={t("{count} due", { count: reviewDeck.length })} variant="info" xstyle={appStyles.reviewDue} />
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
                intro={(
                  <div className={stylex.props(appStyles.intro).className}>
                    <ul aria-label={t("The practice loop")} className={stylex.props(appStyles.chips).className}>
                      <li className={stylex.props(appStyles.chip, appStyles.listenChip).className}>{t("LISTEN")}</li>
                      <li className={stylex.props(appStyles.chip, appStyles.speakChip).className}>{t("SAY IT BACK")}</li>
                      <li className={stylex.props(appStyles.chip, appStyles.unlockChip).className}>{t("UNLOCK")}</li>
                    </ul>
                    <ViewHeading takeFocus={takeHeadingFocus} xstyle={appStyles.display}>{t("Lesson library")}</ViewHeading>
                    <Text type="large" xstyle={appStyles.lead}>{t("Choose a lesson to practise reading and speaking.")}</Text>
                    <Button label={t("How it works")} variant="secondary" xstyle={appStyles.introLink} onClick={() => navigate({ view: "about" })} />
                  </div>
                )}
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
                <VStack gap={0.5}>
                  <p aria-hidden="true" className={stylex.props(sharedStyles.eyebrow, sharedStyles.speakEyebrow).className}>{t("Your own")}</p>
                  <Heading level={2} ref={userLessonsHeading} tabIndex={-1} xstyle={sharedStyles.sectionTitle}>{t("Your lessons")}</Heading>
                </VStack>
                <UserLessonList
                  lessons={userLessons}
                  onSelect={(lesson) => navigate({ view: "my", id: lesson.id })}
                  onDelete={(lesson) => void deleteLesson(lesson)}
                  deleteFailedId={deleteFailedId}
                  completedLessons={progress.completedLessons}
                  takeFocus={takeReturnFocus}
                  onCreateLesson={() => navigate({ view: "manage" }, IMPORT_TITLE)}
                />
              </VStack>
            </VStack>
          ) : view === "manage" ? (
            <VStack gap={4}>
              <ImportTextForm
                onCreate={createLesson}
                levelFilter={levelFilter}
                takeReturnFocus={takeReturnFocus}
              />
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
            <Text as="p">{t("Loading lesson...")}</Text>
          )}
        </VStack>
      </div>
      <AppFooter onNavigate={navigate} />
    </div>
  );
}
