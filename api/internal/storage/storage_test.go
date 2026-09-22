package storage

import (
	"bytes"
	"context"
	"os"
	"reflect"
	"testing"
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

	if _, err := repo.pool.Exec(context.Background(), "TRUNCATE cards, practice_days, lesson_completion RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
	return repo
}

func TestCardRoundTripPreservesFSRSBytes(t *testing.T) {
	repo := newTestRepo(t)
	wantFSRS := []byte(`{ "due": "2026-09-22T10:00:00.000Z", "last_review": "2026-09-21T10:00:00.000Z", "stability": 2.5, "difficulty": 4.2, "elapsed_days": 1, "scheduled_days": 2, "reps": 3, "lapses": 0, "state": 2 }`)
	want := Card{
		Id:    "card-1",
		Front: "Good morning",
		Back:  "Buenos días",
		Fsrs:  wantFSRS,
	}
	want.Source.LessonId = "greetings-basics"
	want.Source.SentenceId = "greetings-basics-1"

	if err := repo.UpsertCard(context.Background(), want); err != nil {
		t.Fatalf("UpsertCard() error = %v", err)
	}

	cards, err := repo.ListCards(context.Background())
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
	first := Card{Id: "card-1", Front: "first", Back: "one", Fsrs: []byte(`{"reps":1}`)}
	first.Source.LessonId = "lesson-1"
	first.Source.SentenceId = "sentence-1"
	second := Card{Id: "card-1", Front: "second", Back: "two", Fsrs: []byte(`{"reps":2}`)}
	second.Source.LessonId = "lesson-2"
	second.Source.SentenceId = "sentence-2"

	if err := repo.UpsertCard(context.Background(), first); err != nil {
		t.Fatalf("first UpsertCard() error = %v", err)
	}
	if err := repo.UpsertCard(context.Background(), second); err != nil {
		t.Fatalf("second UpsertCard() error = %v", err)
	}

	cards, err := repo.ListCards(context.Background())
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
	for range 2 {
		if err := repo.AddPracticeDay(context.Background(), "2026-09-22"); err != nil {
			t.Fatalf("AddPracticeDay() error = %v", err)
		}
	}

	dates, err := repo.ListPracticeDays(context.Background())
	if err != nil {
		t.Fatalf("ListPracticeDays() error = %v", err)
	}
	if !reflect.DeepEqual(dates, []string{"2026-09-22"}) {
		t.Fatalf("dates = %#v, want %#v", dates, []string{"2026-09-22"})
	}
}

func TestLessonCompletionIsIdempotent(t *testing.T) {
	repo := newTestRepo(t)
	for range 2 {
		if err := repo.MarkLessonComplete(context.Background(), "greetings-basics"); err != nil {
			t.Fatalf("MarkLessonComplete() error = %v", err)
		}
	}

	lessons, err := repo.ListCompletedLessons(context.Background())
	if err != nil {
		t.Fatalf("ListCompletedLessons() error = %v", err)
	}
	if !reflect.DeepEqual(lessons, []string{"greetings-basics"}) {
		t.Fatalf("lessons = %#v, want %#v", lessons, []string{"greetings-basics"})
	}
}
