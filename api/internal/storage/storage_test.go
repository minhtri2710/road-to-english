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

	"github.com/jackc/pgx/v5/pgtype"
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
	card := Card{ID: id, Front: front, Back: back, Fsrs: fsrs}
	card.Source.LessonID = lessonID
	card.Source.SentenceID = sentenceID
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

	gotState := syncState(t, repo, user.ID, State{Cards: []Card{want}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if len(gotState.Cards) != 1 {
		t.Fatalf("SyncState() returned %d cards, want 1", len(gotState.Cards))
	}
	got := gotState.Cards[0]
	if got.ID != want.ID || got.Front != want.Front || got.Back != want.Back || got.Source != want.Source {
		t.Fatalf("card metadata = %#v, want %#v", got, want)
	}
	if !bytes.Equal(got.Fsrs, wantFSRS) {
		t.Fatalf("Fsrs = %q, want byte-equal %q", got.Fsrs, wantFSRS)
	}
}

func TestCardLastReviewColumnDerived(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "derived-last-review@example.com")
	reviewed := testCard("lesson-reviewed:sentence-1", "lesson-reviewed", "sentence-1", "reviewed", "card", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z"}`))
	nullReview := testCard("lesson-null:sentence-1", "lesson-null", "sentence-1", "null", "review", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":null}`))
	absentReview := testCard("lesson-absent:sentence-1", "lesson-absent", "sentence-1", "absent", "review", []byte(`{"due":"2026-01-03T00:00:00Z"}`))

	syncState(t, repo, user.ID, State{Cards: []Card{reviewed, nullReview, absentReview}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	var gotReviewed pgtype.Timestamptz
	if err := repo.pool.QueryRow(context.Background(), "SELECT last_review FROM cards WHERE user_id = $1 AND id = $2", user.ID, reviewed.ID).Scan(&gotReviewed); err != nil {
		t.Fatalf("query reviewed last_review: %v", err)
	}
	expected, err := ParseFSRSTimestamp("2026-01-04T00:00:00Z")
	if err != nil {
		t.Fatalf("ParseFSRSTimestamp() error = %v", err)
	}
	if !gotReviewed.Valid || !gotReviewed.Time.Equal(expected) {
		t.Fatalf("reviewed last_review = %#v, want %v", gotReviewed, expected)
	}

	for _, card := range []Card{nullReview, absentReview} {
		var got pgtype.Timestamptz
		if err := repo.pool.QueryRow(context.Background(), "SELECT last_review FROM cards WHERE user_id = $1 AND id = $2", user.ID, card.ID).Scan(&got); err != nil {
			t.Fatalf("query %s last_review: %v", card.ID, err)
		}
		if got.Valid {
			t.Fatalf("%s last_review = %#v, want NULL", card.ID, got)
		}
	}
}

func TestCardUpsertOverwrites(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "upsert@example.com")
	first := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "first", "one", []byte(`{"due":"2026-01-01T00:00:00Z","last_review":"2026-01-02T00:00:00Z","reps":1}`))
	newer := testCard("lesson-1:sentence-1", "lesson-new", "sentence-new", "newer", "value", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":2}`))

	syncState(t, repo, user.ID, State{Cards: []Card{first}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.ID, State{Cards: []Card{newer}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{newer}) {
		t.Fatalf("newer card = %#v, want %#v", got.Cards, []Card{newer})
	}
}

func TestCardUpsertOlderDoesNotRegress(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "older@example.com")
	stored := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "stored", "reviewed", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":4}`))
	stale := testCard("lesson-1:sentence-1", "lesson-old", "sentence-old", "stale", "value", []byte(`{"due":"2026-01-01T00:00:00Z","last_review":"2026-01-02T00:00:00Z","reps":1}`))

	syncState(t, repo, user.ID, State{Cards: []Card{stored}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.ID, State{Cards: []Card{stale}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{stored}) {
		t.Fatalf("stale card = %#v, want stored %#v", got.Cards, []Card{stored})
	}
}

func TestCardUpsertEqualIsNoOp(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "equal@example.com")
	stored := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "stored", "reviewed", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":4}`))
	equalClock := testCard("lesson-1:sentence-1", "lesson-equal", "sentence-equal", "equal", "value", []byte(`{"due":"2026-01-05T00:00:00Z","last_review":"2026-01-04T00:00:00Z","reps":9}`))

	syncState(t, repo, user.ID, State{Cards: []Card{stored}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.ID, State{Cards: []Card{equalClock}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{stored}) {
		t.Fatalf("equal-clock card = %#v, want stored %#v", got.Cards, []Card{stored})
	}
}

func TestUnreviewedCardDoesNotOverwriteReviewedCard(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "unreviewed@example.com")
	reviewed := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "reviewed", "card", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z"}`))
	unreviewed := testCard("lesson-1:sentence-1", "lesson-old", "sentence-old", "unreviewed", "card", []byte(`{"due":"2026-01-05T00:00:00Z"}`))

	syncState(t, repo, user.ID, State{Cards: []Card{reviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.ID, State{Cards: []Card{unreviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{reviewed}) {
		t.Fatalf("unreviewed card = %#v, want reviewed %#v", got.Cards, []Card{reviewed})
	}
}

func TestReviewedCardOverwritesNeverReviewedCard(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "reviewed@example.com")
	unreviewed := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "new", "card", []byte(`{"due":"2026-01-01T00:00:00Z"}`))
	reviewed := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "reviewed", "card", []byte(`{"due":"2026-01-03T00:00:00Z","last_review":"2026-01-04T00:00:00Z"}`))

	syncState(t, repo, user.ID, State{Cards: []Card{unreviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.ID, State{Cards: []Card{reviewed}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{reviewed}) {
		t.Fatalf("reviewed card = %#v, want %#v", got.Cards, []Card{reviewed})
	}
}

func TestNeverReviewedCardsWithSameIDDoNotUpdateEachOther(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "never-reviewed@example.com")
	first := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "first", "card", []byte(`{"due":"2026-01-01T00:00:00Z"}`))
	second := testCard("lesson-1:sentence-1", "lesson-new", "sentence-new", "second", "card", []byte(`{"due":"2026-01-02T00:00:00Z"}`))

	syncState(t, repo, user.ID, State{Cards: []Card{first}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	got := syncState(t, repo, user.ID, State{Cards: []Card{second}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{first}) {
		t.Fatalf("never-reviewed card = %#v, want first %#v", got.Cards, []Card{first})
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

	syncState(t, repo, user.ID, first)
	got := syncState(t, repo, user.ID, second)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("union state = %#v, want %#v", got, want)
	}
	got = syncState(t, repo, user.ID, second)
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

	gotA := syncState(t, repo, userA.ID, stateA)
	gotB := syncState(t, repo, userB.ID, State{Cards: []Card{}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(gotA, stateA) {
		t.Fatalf("user A state = %#v, want %#v", gotA, stateA)
	}
	if !reflect.DeepEqual(gotB, emptyState()) {
		t.Fatalf("user B initial state = %#v, want empty", gotB)
	}

	gotB = syncState(t, repo, userB.ID, stateB)
	gotA = syncState(t, repo, userA.ID, State{Cards: []Card{}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
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
	if err := repo.CreateSession(context.Background(), user.ID, "active", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}
	gotUserID, err := repo.GetSession(context.Background(), "active")
	if err != nil || gotUserID != user.ID {
		t.Fatalf("GetSession() = %q, %v; want %q, nil", gotUserID, err, user.ID)
	}
	if err := repo.CreateSession(context.Background(), user.ID, "expired", time.Now().Add(-time.Hour)); err != nil {
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

func TestCreateSessionPurgesExpiredSessionsAcrossUsers(t *testing.T) {
	repo := newTestRepo(t)
	expiredUser := createTestUser(t, repo, "expired-session@example.com")
	activeUser := createTestUser(t, repo, "active-session@example.com")
	if _, err := repo.pool.Exec(context.Background(), `
		INSERT INTO sessions (token_hash, user_id, expires_at)
		VALUES ($1, $2, now() - interval '1 hour')
	`, "expired", expiredUser.ID); err != nil {
		t.Fatalf("insert expired session: %v", err)
	}
	if err := repo.CreateSession(context.Background(), activeUser.ID, "active", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession() error = %v", err)
	}

	var expiredCount, activeCount int
	if err := repo.pool.QueryRow(context.Background(), "SELECT count(*) FROM sessions WHERE token_hash = $1", "expired").Scan(&expiredCount); err != nil {
		t.Fatalf("count expired session: %v", err)
	}
	if err := repo.pool.QueryRow(context.Background(), "SELECT count(*) FROM sessions WHERE token_hash = $1 AND user_id = $2", "active", activeUser.ID).Scan(&activeCount); err != nil {
		t.Fatalf("count active session: %v", err)
	}
	if expiredCount != 0 {
		t.Fatalf("expired session count = %d, want 0", expiredCount)
	}
	if activeCount != 1 {
		t.Fatalf("active session count = %d, want 1", activeCount)
	}
}

func TestSessionStoresHashNotRawToken(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "hash@example.com")
	rawToken := "raw-token"
	digest := sha256.Sum256([]byte(rawToken))
	storedHash := hex.EncodeToString(digest[:])
	if err := repo.CreateSession(context.Background(), user.ID, storedHash, time.Now().Add(time.Hour)); err != nil {
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
