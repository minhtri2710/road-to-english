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

func TestCardRoundTripPreservesFSRSBytes(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "card@example.com")
	wantFSRS := []byte(`{ "due": "2026-09-22T10:00:00.000Z", "last_review": "2026-09-21T10:00:00.000Z", "stability": 2.5, "difficulty": 4.2, "elapsed_days": 1, "scheduled_days": 2, "reps": 3, "lapses": 0, "state": 2 }`)
	want := Card{
		Id:    "card-1",
		Front: "Good morning",
		Back:  "Buenos días",
		Fsrs:  wantFSRS,
	}
	want.Source.LessonId = "greetings-basics"
	want.Source.SentenceId = "greetings-basics-1"

	if err := repo.UpsertCard(context.Background(), user.Id, want); err != nil {
		t.Fatalf("UpsertCard() error = %v", err)
	}

	cards, err := repo.ListCards(context.Background(), user.Id)
	if err != nil {
		t.Fatalf("ListCards() error = %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("ListCards() returned %d cards, want 1", len(cards))
	}
	got := cards[0]
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
	first := Card{Id: "card-1", Front: "first", Back: "one", Fsrs: []byte(`{"reps":1}`)}
	first.Source.LessonId = "lesson-1"
	first.Source.SentenceId = "sentence-1"
	second := Card{Id: "card-1", Front: "second", Back: "two", Fsrs: []byte(`{"reps":2}`)}
	second.Source.LessonId = "lesson-2"
	second.Source.SentenceId = "sentence-2"

	if err := repo.UpsertCard(context.Background(), user.Id, first); err != nil {
		t.Fatalf("first UpsertCard() error = %v", err)
	}
	if err := repo.UpsertCard(context.Background(), user.Id, second); err != nil {
		t.Fatalf("second UpsertCard() error = %v", err)
	}

	cards, err := repo.ListCards(context.Background(), user.Id)
	if err != nil {
		t.Fatalf("ListCards() error = %v", err)
	}
	if len(cards) != 1 {
		t.Fatalf("ListCards() returned %d cards, want 1", len(cards))
	}
	if !reflect.DeepEqual(cards[0], second) {
		t.Fatalf("card = %#v, want %#v", cards[0], second)
	}
}

func TestPracticeDayIsIdempotent(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "practice@example.com")
	for range 2 {
		if err := repo.AddPracticeDay(context.Background(), user.Id, "2026-09-22"); err != nil {
			t.Fatalf("AddPracticeDay() error = %v", err)
		}
	}

	dates, err := repo.ListPracticeDays(context.Background(), user.Id)
	if err != nil {
		t.Fatalf("ListPracticeDays() error = %v", err)
	}
	if !reflect.DeepEqual(dates, []string{"2026-09-22"}) {
		t.Fatalf("dates = %#v, want %#v", dates, []string{"2026-09-22"})
	}
}

func TestLessonCompletionIsIdempotent(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "lessons@example.com")
	for range 2 {
		if err := repo.MarkLessonComplete(context.Background(), user.Id, "greetings-basics"); err != nil {
			t.Fatalf("MarkLessonComplete() error = %v", err)
		}
	}

	lessons, err := repo.ListCompletedLessons(context.Background(), user.Id)
	if err != nil {
		t.Fatalf("ListCompletedLessons() error = %v", err)
	}
	if !reflect.DeepEqual(lessons, []string{"greetings-basics"}) {
		t.Fatalf("lessons = %#v, want %#v", lessons, []string{"greetings-basics"})
	}
}

func TestUserStateIsolatedByUser(t *testing.T) {
	repo := newTestRepo(t)
	userA := createTestUser(t, repo, "a@example.com")
	userB := createTestUser(t, repo, "b@example.com")
	card := Card{Id: "card-1", Front: "front", Back: "back", Fsrs: []byte(`{"state":2}`)}
	card.Source.LessonId = "lesson-1"
	card.Source.SentenceId = "sentence-1"
	if err := repo.UpsertCard(context.Background(), userA.Id, card); err != nil {
		t.Fatalf("UpsertCard() error = %v", err)
	}
	if err := repo.AddPracticeDay(context.Background(), userA.Id, "2026-09-22"); err != nil {
		t.Fatalf("AddPracticeDay() error = %v", err)
	}
	if err := repo.MarkLessonComplete(context.Background(), userA.Id, "lesson-1"); err != nil {
		t.Fatalf("MarkLessonComplete() error = %v", err)
	}

	cards, err := repo.ListCards(context.Background(), userB.Id)
	if err != nil || len(cards) != 0 {
		t.Fatalf("user B cards = %#v, err = %v; want empty", cards, err)
	}
	dates, err := repo.ListPracticeDays(context.Background(), userB.Id)
	if err != nil || len(dates) != 0 {
		t.Fatalf("user B practice days = %#v, err = %v; want empty", dates, err)
	}
	lessons, err := repo.ListCompletedLessons(context.Background(), userB.Id)
	if err != nil || len(lessons) != 0 {
		t.Fatalf("user B lessons = %#v, err = %v; want empty", lessons, err)
	}

	if err := repo.UpsertCard(context.Background(), userB.Id, card); err != nil {
		t.Fatalf("user B UpsertCard() error = %v", err)
	}
	if err := repo.AddPracticeDay(context.Background(), userB.Id, "2026-09-23"); err != nil {
		t.Fatalf("user B AddPracticeDay() error = %v", err)
	}
	if err := repo.MarkLessonComplete(context.Background(), userB.Id, "lesson-2"); err != nil {
		t.Fatalf("user B MarkLessonComplete() error = %v", err)
	}
	cards, err = repo.ListCards(context.Background(), userA.Id)
	if err != nil || len(cards) != 1 {
		t.Fatalf("user A cards = %#v, err = %v; want one", cards, err)
	}
	dates, err = repo.ListPracticeDays(context.Background(), userA.Id)
	if err != nil || !reflect.DeepEqual(dates, []string{"2026-09-22"}) {
		t.Fatalf("user A practice days = %#v, err = %v", dates, err)
	}
	lessons, err = repo.ListCompletedLessons(context.Background(), userA.Id)
	if err != nil || !reflect.DeepEqual(lessons, []string{"lesson-1"}) {
		t.Fatalf("user A lessons = %#v, err = %v", lessons, err)
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
