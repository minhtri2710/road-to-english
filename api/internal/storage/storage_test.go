package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"
)

func newTestRepo(t *testing.T) *Repository {
	t.Helper()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Fatal("DATABASE_URL must be set to a local Postgres for storage tests; run: docker compose -f api/compose.yaml up -d --wait")
	}

	repo, err := Open(context.Background(), dsn)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(repo.Close)
	lockConn, err := repo.pool.Acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire test database lock: %v", err)
	}
	if _, err := lockConn.Exec(context.Background(), `SELECT pg_advisory_lock(hashtextextended('road-to-english-api-tests', 0))`); err != nil {
		lockConn.Release()
		t.Fatalf("lock test database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtextextended('road-to-english-api-tests', 0))`)
		lockConn.Release()
	})

	if _, err := repo.pool.Exec(context.Background(), "TRUNCATE users, sessions, cards, practice_days, lesson_completion RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
	return repo
}

func createTestUser(t *testing.T, repo *Repository, email string) User {
	t.Helper()
	user, err := repo.CreateUser(context.Background(), email, "hash")
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	return user
}

func testCard(id, lessonID, sentenceID, front, back string, fsrs []byte) Card {
	card := Card{Id: id, Front: front, Back: back, Fsrs: fsrs}
	card.Source.LessonId = lessonID
	card.Source.SentenceId = sentenceID
	return card
}

func syncState(t *testing.T, repo *Repository, userID string, in State) State {
	t.Helper()
	out, err := repo.SyncState(context.Background(), userID, in)
	if err != nil {
		t.Fatalf("SyncState() error = %v", err)
	}
	return out
}

func emptyState() State {
	return State{
		Cards:            []Card{},
		PracticeDays:     []PracticeDay{},
		LessonCompletion: []LessonCompletion{},
	}
}

func TestCardRoundTripPreservesFSRSBytes(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "card@example.com")
	wantFSRS := []byte(`{ "due": "2026-09-22T10:00:00.000Z", "last_review": "2026-09-21T10:00:00.000Z", "stability": 2.5, "difficulty": 4.2, "elapsed_days": 1, "scheduled_days": 2, "reps": 3, "lapses": 0, "state": 2 }`)
	want := testCard("greetings-basics:greetings-basics-1", "greetings-basics", "greetings-basics-1", "Good morning", "Buenos días", wantFSRS)

	gotState := syncState(t, repo, user.Id, State{Cards: []Card{want}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if len(gotState.Cards) != 1 {
		t.Fatalf("SyncState() returned %d cards, want 1", len(gotState.Cards))
	}
	got := gotState.Cards[0]
	if got.Id != want.Id || got.Front != want.Front || got.Back != want.Back || got.Source != want.Source {
		t.Fatalf("card metadata = %#v, want %#v", got, want)
	}
	if !bytes.Equal(got.Fsrs, wantFSRS) {
		t.Fatalf("Fsrs = %q, want byte-equal %q", got.Fsrs, wantFSRS)
	}
}

func TestCardUpsertOverwrites(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "upsert@example.com")
	first := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "first", "one", []byte(`{"due":"2026-01-01T00:00:00Z","last_review":"2026-01-02T00:00:00Z","reps":1}`))
	newer := testCard("lesson-1:sentence-1", "lesson-new", "sentence-new", "newer", "value", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":2}`))

	syncState(t, repo, user.Id, State{Cards: []Card{first}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.Id, State{Cards: []Card{newer}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{newer}) {
		t.Fatalf("newer card = %#v, want %#v", got.Cards, []Card{newer})
	}
}

func TestCardUpsertOlderDoesNotRegress(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "older@example.com")
	stored := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "stored", "reviewed", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":4}`))
	stale := testCard("lesson-1:sentence-1", "lesson-old", "sentence-old", "stale", "value", []byte(`{"due":"2026-01-01T00:00:00Z","last_review":"2026-01-02T00:00:00Z","reps":1}`))

	syncState(t, repo, user.Id, State{Cards: []Card{stored}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.Id, State{Cards: []Card{stale}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{stored}) {
		t.Fatalf("stale card = %#v, want stored %#v", got.Cards, []Card{stored})
	}
}

func TestCardUpsertEqualIsNoOp(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "equal@example.com")
	stored := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "stored", "reviewed", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":4}`))
	equalClock := testCard("lesson-1:sentence-1", "lesson-equal", "sentence-equal", "equal", "value", []byte(`{"due":"2026-01-05T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":9}`))

	syncState(t, repo, user.Id, State{Cards: []Card{stored}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.Id, State{Cards: []Card{equalClock}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{stored}) {
		t.Fatalf("equal-clock card = %#v, want stored %#v", got.Cards, []Card{stored})
	}
}

func TestUnreviewedCardDoesNotOverwriteReviewedCard(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "unreviewed@example.com")
	reviewed := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "reviewed", "card", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z"}`))
	unreviewed := testCard("lesson-1:sentence-1", "lesson-old", "sentence-old", "unreviewed", "card", []byte(`{"due":"2026-01-05T00:00:00Z"}`))

	syncState(t, repo, user.Id, State{Cards: []Card{reviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.Id, State{Cards: []Card{unreviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{reviewed}) {
		t.Fatalf("unreviewed card = %#v, want reviewed %#v", got.Cards, []Card{reviewed})
	}
}

func TestReviewedCardOverwritesNeverReviewedCard(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "reviewed@example.com")
	unreviewed := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "new", "card", []byte(`{"due":"2026-01-01T00:00:00Z"}`))
	reviewed := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "reviewed", "card", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z"}`))

	syncState(t, repo, user.Id, State{Cards: []Card{unreviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.Id, State{Cards: []Card{reviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{reviewed}) {
		t.Fatalf("reviewed card = %#v, want %#v", got.Cards, []Card{reviewed})
	}
}

func TestNeverReviewedCardsWithSameIDDoNotUpdateEachOther(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "never-reviewed@example.com")
	first := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "first", "card", []byte(`{"due":"2026-01-01T00:00:00Z"}`))
	second := testCard("lesson-1:sentence-1", "lesson-new", "sentence-new", "second", "card", []byte(`{"due":"2026-01-02T00:00:00Z"}`))

	syncState(t, repo, user.Id, State{Cards: []Card{first}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.Id, State{Cards: []Card{second}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{first}) {
		t.Fatalf("never-reviewed card = %#v, want first %#v", got.Cards, []Card{first})
	}
}

func TestSyncStateRejectsUncastableLastReview(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "uncastable@example.com")
	poisoned := testCard("lesson-11:sentence-11", "lesson-11", "sentence-11", "front", "back", []byte(`{"due":"2026-09-22T00:00:00Z","last_review":"0000-01-01T00:00:00Z"}`))
	if _, err := repo.SyncState(context.Background(), user.Id, State{Cards: []Card{poisoned}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}}); err == nil {
		t.Fatal("SyncState() error = nil, want uncastable last_review error")
	}
	got := syncState(t, repo, user.Id, emptyState())
	if len(got.Cards) != 0 {
		t.Fatalf("cards after rejected uncastable card = %#v, want empty", got.Cards)
	}
}

func TestPracticeDaysAndLessonCompletionUnion(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "union@example.com")
	first := State{
		Cards:            []Card{},
		PracticeDays:     []PracticeDay{{Date: "2026-09-22"}},
		LessonCompletion: []LessonCompletion{{LessonID: "lesson-x"}},
	}
	second := State{
		Cards:            []Card{},
		PracticeDays:     []PracticeDay{{Date: "2026-09-23"}},
		LessonCompletion: []LessonCompletion{{LessonID: "lesson-y"}},
	}
	want := State{
		Cards:            []Card{},
		PracticeDays:     []PracticeDay{{Date: "2026-09-22"}, {Date: "2026-09-23"}},
		LessonCompletion: []LessonCompletion{{LessonID: "lesson-x"}, {LessonID: "lesson-y"}},
	}

	syncState(t, repo, user.Id, first)
	got := syncState(t, repo, user.Id, second)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("union state = %#v, want %#v", got, want)
	}
	got = syncState(t, repo, user.Id, second)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("idempotent union state = %#v, want %#v", got, want)
	}
}

func TestUserStateIsolatedByUser(t *testing.T) {
	repo := newTestRepo(t)
	userA := createTestUser(t, repo, "a@example.com")
	userB := createTestUser(t, repo, "b@example.com")
	stateA := State{
		Cards:            []Card{testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "A", "card", []byte(`{"due":"2026-01-01T00:00:00Z"}`))},
		PracticeDays:     []PracticeDay{{Date: "2026-09-22"}},
		LessonCompletion: []LessonCompletion{{LessonID: "lesson-a"}},
	}
	stateB := State{
		Cards:            []Card{testCard("lesson-2:sentence-2", "lesson-2", "sentence-2", "B", "card", []byte(`{"due":"2026-01-01T00:00:00Z"}`))},
		PracticeDays:     []PracticeDay{{Date: "2026-09-23"}},
		LessonCompletion: []LessonCompletion{{LessonID: "lesson-b"}},
	}

	gotA := syncState(t, repo, userA.Id, stateA)
	gotB := syncState(t, repo, userB.Id, State{Cards: []Card{}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(gotA, stateA) {
		t.Fatalf("user A state = %#v, want %#v", gotA, stateA)
	}
	if !reflect.DeepEqual(gotB, emptyState()) {
		t.Fatalf("user B initial state = %#v, want empty", gotB)
	}

	gotB = syncState(t, repo, userB.Id, stateB)
	gotA = syncState(t, repo, userA.Id, State{Cards: []Card{}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(gotB, stateB) {
		t.Fatalf("user B state = %#v, want %#v", gotB, stateB)
	}
	if !reflect.DeepEqual(gotA, stateA) {
		t.Fatalf("user A final state = %#v, want %#v", gotA, stateA)
	}
}

func TestCreateUserDuplicateEmail(t *testing.T) {
	repo := newTestRepo(t)
	createTestUser(t, repo, "duplicate@example.com")
	if _, err := repo.CreateUser(context.Background(), "duplicate@example.com", "hash"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("duplicate CreateUser() error = %v, want ErrEmailTaken", err)
	}
}

func TestSessionRoundTripAndInvalidation(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "session@example.com")
	if err := repo.CreateSession(context.Background(), user.Id, "active", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	gotUserID, err := repo.GetSession(context.Background(), "active")
	if err != nil || gotUserID != user.Id {
		t.Fatalf("GetSession() = %q, %v; want %q, nil", gotUserID, err, user.Id)
	}
	if err := repo.CreateSession(context.Background(), user.Id, "expired", time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("CreateSession(expired) error = %v", err)
	}
	if _, err := repo.GetSession(context.Background(), "expired"); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("expired GetSession() error = %v, want ErrSessionInvalid", err)
	}
	if err := repo.DeleteSession(context.Background(), "active"); err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
	if _, err := repo.GetSession(context.Background(), "active"); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("deleted GetSession() error = %v, want ErrSessionInvalid", err)
	}
	if err := repo.DeleteSession(context.Background(), "missing"); err != nil {
		t.Fatalf("missing DeleteSession() error = %v, want nil", err)
	}
}

func TestSessionStoresHashNotRawToken(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "hash@example.com")
	rawToken := "raw-token"
	digest := sha256.Sum256([]byte(rawToken))
	storedHash := hex.EncodeToString(digest[:])
	if err := repo.CreateSession(context.Background(), user.Id, storedHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	var tokenHash string
	if err := repo.pool.QueryRow(context.Background(), "SELECT token_hash FROM sessions").Scan(&tokenHash); err != nil {
		t.Fatalf("query token hash: %v", err)
	}
	if tokenHash == rawToken {
		t.Fatal("session stored the raw token")
	}
	if tokenHash != storedHash {
		t.Fatalf("token_hash = %q, want stored hash %q", tokenHash, storedHash)
	}
}
