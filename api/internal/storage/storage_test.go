package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/road-to-english/api/internal/testdb"
)

func newTestRepo(t *testing.T) *Repository {
	t.Helper()
	var repo *Repository
	testdb.Open(t, func(dsn string) {
		var err error
		if repo, err = Open(context.Background(), dsn); err != nil {
			t.Fatalf("Open() error = %v", err)
		}
		t.Cleanup(repo.Close)
	})
	return repo
}

// fsrs returns a complete FSRS object the sync contract accepts.
func fsrs(due string, reps int) []byte {
	return []byte(`{"due":"` + due + `","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":` + strconv.Itoa(reps) + `,"lapses":0,"state":0}`)
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
	card := Card{ID: id, Front: front, Back: back, Fsrs: fsrs, UpdatedAt: "2026-01-01T00:00:00Z", DeletedAt: DeletedAt{Present: true}}
	card.Source.LessonID = lessonID
	card.Source.SentenceID = sentenceID
	card.Source.Word = new(string)
	return card
}

// syncState sends in with every card that sets no dirty flag marked dirty, as a local write would.
func syncState(t *testing.T, repo *Repository, userID string, in State) State {
	t.Helper()
	in.Cards = slices.Clone(in.Cards)
	for i := range in.Cards {
		if in.Cards[i].Dirty == nil {
			in.Cards[i] = dirtyCard(in.Cards[i])
		}
	}
	out, err := repo.SyncState(context.Background(), userID, in)
	if err != nil {
		t.Fatalf("SyncState() error = %v", err)
	}
	return out.State
}

func dirtyCard(card Card) Card {
	card.Dirty = new(true)
	return card
}

func cleanCard(card Card) Card {
	card.Dirty = new(false)
	return card
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
	wantFSRS := []byte(`{ "due": "2026-09-22T10:00:00.000Z", "last_review": "2026-09-21T10:00:00.000Z", "stability": 2.5, "difficulty": 4.2, "elapsed_days": 1, "scheduled_days": 2, "learning_steps": 0, "reps": 3, "lapses": 0, "state": 2 }`)
	want := testCard("greetings-basics:greetings-basics-1", "greetings-basics", "greetings-basics-1", "Good morning", "Buenos días", wantFSRS)

	gotState := syncState(t, repo, user.ID, State{Cards: []Card{want}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if len(gotState.Cards) != 1 {
		t.Fatalf("SyncState() returned %d cards, want 1", len(gotState.Cards))
	}
	got := gotState.Cards[0]
	if got.ID != want.ID || got.Front != want.Front || got.Back != want.Back || got.Source.LessonID != want.Source.LessonID || got.Source.SentenceID != want.Source.SentenceID || *got.Source.Word != *want.Source.Word {
		t.Fatalf("card metadata = %#v, want %#v", got, want)
	}
	if !bytes.Equal(got.Fsrs, wantFSRS) {
		t.Fatalf("Fsrs = %q, want byte-equal %q", got.Fsrs, wantFSRS)
	}
}

func TestWordCardRoundTripPreservesWord(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "word-card@example.com")
	sentence := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "Good morning", "", fsrs("2026-09-22T10:00:00Z", 0))
	word := testCard("lesson-1:sentence-1:morning", "lesson-1", "sentence-1", "morning", "Good morning — Chào buổi sáng", fsrs("2026-09-22T10:00:00Z", 0))
	*word.Source.Word = "morning"

	got := syncState(t, repo, user.ID, State{Cards: []Card{sentence, word}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if len(got.Cards) != 2 {
		t.Fatalf("SyncState() returned %d cards, want 2", len(got.Cards))
	}
	if got.Cards[0].ID != sentence.ID || *got.Cards[0].Source.Word != "" {
		t.Fatalf("sentence card = %q word %q, want %q word \"\"", got.Cards[0].ID, *got.Cards[0].Source.Word, sentence.ID)
	}
	if got.Cards[1].ID != word.ID || *got.Cards[1].Source.Word != "morning" {
		t.Fatalf("word card = %q word %q, want %q word \"morning\"", got.Cards[1].ID, *got.Cards[1].Source.Word, word.ID)
	}
}

func TestUnicodeWordCardRoundTrips(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "unicode-word-card@example.com")
	card := wordSyncCard("caf\u00e9")

	got := syncState(t, repo, user.ID, oneCardState(card))
	if len(got.Cards) != 1 || got.Cards[0].ID != "lesson-1:sentence-1:caf\u00e9" || *got.Cards[0].Source.Word != "caf\u00e9" {
		t.Fatalf("SyncState() cards = %+v, want the caf\u00e9 word card", got.Cards)
	}
}

func TestSyncStateRejectsNilWordWithoutWriting(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "nil-word@example.com")
	valid := dirtyCard(testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "", fsrs("2026-09-22T10:00:00Z", 0)))
	nilWord := dirtyCard(testCard("lesson-1:sentence-2", "lesson-1", "sentence-2", "front", "", fsrs("2026-09-22T10:00:00Z", 0)))
	nilWord.Source.Word = nil

	if _, err := repo.SyncState(context.Background(), user.ID, State{Cards: []Card{valid, nilWord}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("SyncState() error = %v, want ErrInvalidState", err)
	}
	var count int
	if err := repo.pool.QueryRow(context.Background(), "SELECT count(*) FROM cards WHERE user_id = $1", user.ID).Scan(&count); err != nil {
		t.Fatalf("count cards: %v", err)
	}
	if count != 0 {
		t.Fatalf("cards rows = %d, want 0", count)
	}
}

// Validation runs before Begin: on a closed pool, invalid input still returns ErrInvalidState, while valid input fails at Begin.
func TestSyncStateValidatesBeforeBegin(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "closed-pool@example.com")
	repo.pool.Close()

	invalid := emptyState()
	invalid.Cards = []Card{dirtyCard(testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "", fsrs("2026-09-22T10:00:00Z", 0)))}
	invalid.Cards[0].Source.Word = nil
	if _, err := repo.SyncState(context.Background(), user.ID, invalid); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("SyncState(invalid) error = %v, want ErrInvalidState", err)
	}
	if _, err := repo.SyncState(context.Background(), user.ID, emptyState()); err == nil || errors.Is(err, ErrInvalidState) {
		t.Fatalf("SyncState(valid) error = %v, want a begin error", err)
	}
}

// Each invalid class is rejected with ErrInvalidState and writes nothing, even when it comes after valid items.
func TestSyncStateRejectsEachInvalidClassWithoutWriting(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "invalid-classes@example.com")
	valid := func() State {
		return State{
			Cards:            []Card{dirtyCard(testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "", fsrs("2026-09-22T10:00:00Z", 0)))},
			PracticeDays:     []PracticeDay{{Date: "2026-09-22"}},
			LessonCompletion: []LessonCompletion{{LessonID: "lesson-1"}},
		}
	}
	addCard := func(state *State, mutate func(*Card)) {
		card := dirtyCard(testCard("lesson-1:sentence-2", "lesson-1", "sentence-2", "front", "", fsrs("2026-09-22T10:00:00Z", 0)))
		mutate(&card)
		state.Cards = append(state.Cards, card)
	}
	for name, mutate := range map[string]func(*State){
		"nil cards":             func(s *State) { s.Cards = nil },
		"nil practice days":     func(s *State) { s.PracticeDays = nil },
		"nil lesson completion": func(s *State) { s.LessonCompletion = nil },
		"card text":             func(s *State) { addCard(s, func(c *Card) { c.Front = "" }) },
		"card word":             func(s *State) { addCard(s, func(c *Card) { c.Source.Word = nil }) },
		"card id":               func(s *State) { addCard(s, func(c *Card) { c.ID = "wrong" }) },
		"duplicate card":        func(s *State) { s.Cards = append(s.Cards, s.Cards[0]) },
		"card fsrs":             func(s *State) { addCard(s, func(c *Card) { c.Fsrs = []byte(`{"due":"2026-09-22T10:00:00Z"}`) }) },
		"card updatedAt":        func(s *State) { addCard(s, func(c *Card) { c.UpdatedAt = "yesterday" }) },
		"card deletedAt":        func(s *State) { addCard(s, func(c *Card) { c.DeletedAt = DeletedAt{} }) },
		"practice day":          func(s *State) { s.PracticeDays = append(s.PracticeDays, PracticeDay{Date: "2026-02-30"}) },
		"lesson completion":     func(s *State) { s.LessonCompletion = append(s.LessonCompletion, LessonCompletion{LessonID: ""}) },
	} {
		t.Run(name, func(t *testing.T) {
			state := valid()
			mutate(&state)
			if _, err := repo.SyncState(context.Background(), user.ID, state); !errors.Is(err, ErrInvalidState) {
				t.Fatalf("SyncState() error = %v, want ErrInvalidState", err)
			}
			if got := syncState(t, repo, user.ID, emptyState()); !reflect.DeepEqual(got, emptyState()) {
				t.Fatalf("state after rejected sync = %#v, want empty", got)
			}
		})
	}
}

func wordSyncCard(word string) Card {
	card := testCard("lesson-1:sentence-1:"+word, "lesson-1", "sentence-1", word, "back", fsrs("2026-09-22T10:00:00Z", 0))
	card.UpdatedAt = "2026-09-22T10:00:00Z"
	*card.Source.Word = word
	return card
}

func oneCardState(card Card) State {
	return State{Cards: []Card{dirtyCard(card)}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}}
}

// testdata/card-words.json is shared with the web isCardWord test, so the two contracts cannot drift.
func TestValidCardWordSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/card-words.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct{ Accept, Reject []string }
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors.Accept) == 0 || len(vectors.Reject) == 0 {
		t.Fatal("empty card-word vectors")
	}
	for _, word := range vectors.Accept {
		if !validCardWord(word) {
			t.Errorf("validCardWord(%q) = false, want true", word)
		}
	}
	for _, word := range vectors.Reject {
		if validCardWord(word) {
			t.Errorf("validCardWord(%q) = true, want false", word)
		}
	}
	if !validCardWord("") {
		t.Error("validCardWord(\"\") = false, want true for a sentence card")
	}
}

func TestValidateWordCards(t *testing.T) {
	sentence := wordSyncCard("")
	sentence.ID = "lesson-1:sentence-1"
	sentence.Front = "Hello there"
	if err := oneCardState(sentence).validate(); err != nil {
		t.Fatal("sentence card rejected")
	}
	for _, word := range []string{"hello42", "t-shirt"} {
		if err := oneCardState(wordSyncCard(word)).validate(); err != nil {
			t.Fatalf("word %q rejected", word)
		}
	}
	for _, word := range []string{"Hello", "a:b", "don't", "a b", "-a", "a-", "a--b", "T-shirt"} {
		if err := oneCardState(wordSyncCard(word)).validate(); err == nil {
			t.Fatalf("word %q accepted", word)
		}
	}
	mismatch := wordSyncCard("hello")
	mismatch.ID = "lesson-1:sentence-1"
	if err := oneCardState(mismatch).validate(); err == nil {
		t.Fatal("word card with sentence id accepted")
	}
	missing := sentence
	missing.Source.Word = nil
	if err := oneCardState(missing).validate(); err == nil {
		t.Fatal("card without word accepted")
	}
}

func TestValidateCardTimestamps(t *testing.T) {
	deletedAt := "2026-09-23T10:00:00.123Z"
	tombstone := wordSyncCard("hello")
	tombstone.DeletedAt = DeletedAt{Present: true, Value: &deletedAt}
	if err := oneCardState(wordSyncCard("hello")).validate(); err != nil {
		t.Fatal("live card rejected")
	}
	if err := oneCardState(tombstone).validate(); err != nil {
		t.Fatal("tombstone card rejected")
	}

	badDeletedAt := "2026-09-23T10:00:00+07:00"
	for name, mutate := range map[string]func(*Card){
		"missing updatedAt": func(card *Card) { card.UpdatedAt = "" },
		"non-UTC updatedAt": func(card *Card) { card.UpdatedAt = "2026-09-22T10:00:00+07:00" },
		"invalid updatedAt": func(card *Card) { card.UpdatedAt = "yesterday" },
		"missing deletedAt": func(card *Card) { card.DeletedAt = DeletedAt{} },
		"non-UTC deletedAt": func(card *Card) { card.DeletedAt = DeletedAt{Present: true, Value: &badDeletedAt} },
	} {
		card := wordSyncCard("hello")
		mutate(&card)
		if err := oneCardState(card).validate(); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

// inWindow is a whole-second instant well inside TombstoneRetention, for tombstones the purge must keep.
func inWindow() time.Time {
	return time.Now().UTC().Add(-30 * 24 * time.Hour).Truncate(time.Second)
}

func tombstone(card Card, deletedAt string) Card {
	card.UpdatedAt = deletedAt
	card.DeletedAt = DeletedAt{Present: true, Value: &deletedAt}
	return card
}

func TestParseTimestampGrammar(t *testing.T) {
	for value, valid := range map[string]bool{
		"2026-01-01T00:00:00Z":      true,
		"2026-01-01T00:00:00.5Z":    true,
		"2026-01-01T00:00:00.123Z":  true,
		"2026-01-01T00:00:00,5Z":    false,
		"2026-01-01T00:00:00.1234Z": false,
		"2026-01-01T00:00:00.Z":     false,
		"2026-01-01T00:00:00+00:00": false,
		"2026-02-30T00:00:00Z":      false,
	} {
		if _, err := parseTimestamp(value); (err == nil) != valid {
			t.Errorf("parseTimestamp(%q) error = %v, want valid %v", value, err, valid)
		}
	}
}

func TestCardRoundTripPreservesUpdatedAtAndDeletedAt(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "card-times@example.com")
	live := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "live", "card", fsrs("2026-01-01T00:00:00Z", 0))
	live.UpdatedAt = "2026-01-02T03:04:05.123Z"
	deletedInstant := inWindow().Add(-24*time.Hour + 500*time.Millisecond)
	deleted := tombstone(testCard("lesson-1:sentence-2", "lesson-1", "sentence-2", "deleted", "card", fsrs("2026-01-01T00:00:00Z", 0)), deletedInstant.Format("2006-01-02T15:04:05.0Z"))

	got := syncState(t, repo, user.ID, State{Cards: []Card{live, deleted}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if !reflect.DeepEqual(got.Cards, []Card{live, deleted}) {
		t.Fatalf("cards = %#v, want %#v", got.Cards, []Card{live, deleted})
	}
	for _, card := range got.Cards {
		if _, err := parseTimestamp(card.UpdatedAt); err != nil {
			t.Fatalf("stored updatedAt %q fails the grammar: %v", card.UpdatedAt, err)
		}
	}
	if _, err := parseTimestamp(*got.Cards[1].DeletedAt.Value); err != nil {
		t.Fatalf("stored deletedAt fails the grammar: %v", err)
	}

	var updatedAt time.Time
	var deletedAt *time.Time
	if err := repo.pool.QueryRow(context.Background(), "SELECT updated_at, deleted_at FROM cards WHERE user_id = $1 AND id = $2", user.ID, deleted.ID).Scan(&updatedAt, &deletedAt); err != nil {
		t.Fatalf("query tombstone columns: %v", err)
	}
	want := deletedInstant
	if !updatedAt.Equal(want) || deletedAt == nil || !deletedAt.Equal(want) {
		t.Fatalf("tombstone columns = %v, %v, want %v, %v", updatedAt, deletedAt, want, want)
	}
	if err := repo.pool.QueryRow(context.Background(), "SELECT deleted_at FROM cards WHERE user_id = $1 AND id = $2", user.ID, live.ID).Scan(&deletedAt); err != nil {
		t.Fatalf("query live deleted_at: %v", err)
	}
	if deletedAt != nil {
		t.Fatalf("live deleted_at = %v, want NULL", deletedAt)
	}
}

// Timestamps reach Postgres as text cast to timestamptz: each stored instant must equal parseTimestamp of the wire string.
func TestCardTimestampTextStoresExactInstant(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "timestamp-text@example.com")
	day := inWindow().Add(-24 * time.Hour).Format("2006-01-02T15:04:05")
	values := []string{day + "Z", day + ".1Z", day + ".12Z", day + ".123Z"}
	in := emptyState()
	for i, value := range values {
		sentenceID := "sentence-" + strconv.Itoa(i)
		in.Cards = append(in.Cards, tombstone(testCard("lesson-1:"+sentenceID, "lesson-1", sentenceID, "front", "back", fsrs("2026-01-01T00:00:00Z", 0)), value))
	}

	got := syncState(t, repo, user.ID, in)
	if !reflect.DeepEqual(got.Cards, in.Cards) {
		t.Fatalf("cards = %#v, want %#v", got.Cards, in.Cards)
	}
	for _, card := range in.Cards {
		want, err := parseTimestamp(card.UpdatedAt)
		if err != nil {
			t.Fatalf("parseTimestamp(%q) error = %v", card.UpdatedAt, err)
		}
		var updatedAt, deletedAt time.Time
		if err := repo.pool.QueryRow(context.Background(), "SELECT updated_at, deleted_at FROM cards WHERE user_id = $1 AND id = $2", user.ID, card.ID).Scan(&updatedAt, &deletedAt); err != nil {
			t.Fatalf("query %s: %v", card.ID, err)
		}
		if !updatedAt.Equal(want) || !deletedAt.Equal(want) || formatTimestamp(updatedAt) != card.UpdatedAt {
			t.Fatalf("%s stored %v, %v, want %v", card.UpdatedAt, updatedAt.UTC(), deletedAt.UTC(), want)
		}
	}

	// Year 1 is older than the tombstone retention, so it round-trips on a live card.
	live := testCard("lesson-1:year-1", "lesson-1", "year-1", "front", "back", fsrs("2026-01-01T00:00:00Z", 0))
	live.UpdatedAt = "0001-01-01T00:00:00Z"
	syncState(t, repo, user.ID, oneCardState(live))
	var updatedAt time.Time
	var deletedAt *time.Time
	if err := repo.pool.QueryRow(context.Background(), "SELECT updated_at, deleted_at FROM cards WHERE user_id = $1 AND id = $2", user.ID, live.ID).Scan(&updatedAt, &deletedAt); err != nil {
		t.Fatalf("query %s: %v", live.ID, err)
	}
	if !updatedAt.Equal(time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)) || formatTimestamp(updatedAt) != live.UpdatedAt || deletedAt != nil {
		t.Fatalf("year-1 live card stored %v, %v, want %s and NULL", updatedAt.UTC(), deletedAt, live.UpdatedAt)
	}
}

// SyncState on a done context returns the context's error and writes nothing.
func TestSyncStateDoneContextReturnsContextError(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "done-context@example.com")
	in := emptyState()
	in.Cards = []Card{dirtyCard(testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "back", fsrs("2026-01-01T00:00:00Z", 0)))}

	expired, cancelExpired := context.WithTimeout(context.Background(), 0)
	defer cancelExpired()
	if _, err := repo.SyncState(expired, user.ID, in); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("SyncState(expired) error = %v, want context.DeadlineExceeded", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.SyncState(cancelled, user.ID, in); !errors.Is(err, context.Canceled) {
		t.Fatalf("SyncState(cancelled) error = %v, want context.Canceled", err)
	}
	if got := syncState(t, repo, user.ID, emptyState()); len(got.Cards) != 0 {
		t.Fatalf("cards = %#v, want none", got.Cards)
	}
}

// A Postgres error in the middle batch group is returned with that item's message and rolls back the cards before it.
func TestSyncStateBatchErrorRollsBack(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "batch-error@example.com")
	ctx := context.Background()
	if _, err := repo.pool.Exec(ctx, "ALTER TABLE practice_days ADD CONSTRAINT test_reject_day CHECK (date <> '1999-12-31') NOT VALID"); err != nil {
		t.Fatalf("add constraint: %v", err)
	}
	t.Cleanup(func() {
		if _, err := repo.pool.Exec(ctx, "ALTER TABLE practice_days DROP CONSTRAINT test_reject_day"); err != nil {
			t.Errorf("drop constraint: %v", err)
		}
	})

	in := emptyState()
	in.Cards = []Card{dirtyCard(testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "back", fsrs("2026-01-01T00:00:00Z", 0)))}
	in.PracticeDays = []PracticeDay{{Date: "1999-12-30"}, {Date: "1999-12-31"}}
	in.LessonCompletion = []LessonCompletion{{LessonID: "lesson-1"}}
	_, err := repo.SyncState(ctx, user.ID, in)
	if err == nil || !strings.Contains(err.Error(), `sync practice day "1999-12-31": `) || errors.Is(err, ErrInvalidState) {
		t.Fatalf("SyncState() error = %v, want the practice day's Postgres error", err)
	}
	var rows int
	if err := repo.pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM cards) + (SELECT count(*) FROM practice_days) + (SELECT count(*) FROM lesson_completion)").Scan(&rows); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if rows != 0 {
		t.Fatalf("rows = %d, want 0", rows)
	}
}

func TestSyncStateCapsStoredCards(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "card-cap@example.com")
	ctx := context.Background()
	capCard := func(i int) Card {
		sentenceID := "s" + strconv.Itoa(i)
		return testCard(cardID("l", sentenceID, ""), "l", sentenceID, "front", "back", fsrs("2026-01-01T00:00:00Z", 0))
	}
	in := emptyState()
	for i := range MaxCards {
		in.Cards = append(in.Cards, capCard(i))
	}
	if out := syncState(t, repo, user.ID, in); len(out.Cards) != MaxCards {
		t.Fatalf("cards = %d, want %d", len(out.Cards), MaxCards)
	}
	storedCards := func() int {
		t.Helper()
		var count int
		if err := repo.pool.QueryRow(ctx, "SELECT count(*) FROM cards WHERE user_id = $1", user.ID).Scan(&count); err != nil {
			t.Fatalf("count cards: %v", err)
		}
		return count
	}

	over := emptyState()
	over.Cards = []Card{dirtyCard(capCard(MaxCards))}
	if _, err := repo.SyncState(ctx, user.ID, over); !errors.Is(err, ErrTooManyCards) {
		t.Fatalf("SyncState() error = %v, want ErrTooManyCards", err)
	}
	if count := storedCards(); count != MaxCards {
		t.Fatalf("stored cards = %d, want %d", count, MaxCards)
	}

	update := capCard(0)
	update.Front = "updated"
	update.UpdatedAt = "2026-02-01T00:00:00Z"
	out := syncState(t, repo, user.ID, oneCardState(update))
	if len(out.Cards) != MaxCards {
		t.Fatalf("cards = %d, want %d", len(out.Cards), MaxCards)
	}
	var front string
	if err := repo.pool.QueryRow(ctx, "SELECT front FROM cards WHERE user_id = $1 AND id = $2", user.ID, update.ID).Scan(&front); err != nil {
		t.Fatalf("read card: %v", err)
	}
	if front != "updated" {
		t.Fatalf("front = %q, want updated", front)
	}
}

func TestSyncStateCapsPracticeDaysAndLessonCompletion(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()
	day := func(i int) PracticeDay {
		return PracticeDay{Date: time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, i).Format("2006-01-02")}
	}
	completion := func(i int) LessonCompletion { return LessonCompletion{LessonID: "l" + strconv.Itoa(i)} }
	for _, list := range []struct {
		name  string
		max   int
		err   error
		table string
		add   func(in *State, i int)
	}{
		{"practiceDays", MaxPracticeDays, ErrTooManyPracticeDays, "practice_days", func(in *State, i int) { in.PracticeDays = append(in.PracticeDays, day(i)) }},
		{"lessonCompletion", MaxLessonCompletions, ErrTooManyLessonCompletions, "lesson_completion", func(in *State, i int) { in.LessonCompletion = append(in.LessonCompletion, completion(i)) }},
	} {
		t.Run(list.name, func(t *testing.T) {
			user := createTestUser(t, repo, list.name+"-cap@example.com")
			in := emptyState()
			for i := range list.max {
				list.add(&in, i)
			}
			syncState(t, repo, user.ID, in)
			stored := func() int {
				t.Helper()
				var count int
				if err := repo.pool.QueryRow(ctx, "SELECT count(*) FROM "+list.table+" WHERE user_id = $1", user.ID).Scan(&count); err != nil {
					t.Fatalf("count %s: %v", list.table, err)
				}
				return count
			}
			if count := stored(); count != list.max {
				t.Fatalf("stored = %d, want %d", count, list.max)
			}
			over := emptyState()
			list.add(&over, list.max)
			if _, err := repo.SyncState(ctx, user.ID, over); !errors.Is(err, list.err) {
				t.Fatalf("SyncState() error = %v, want %v", err, list.err)
			}
			if count := stored(); count != list.max {
				t.Fatalf("stored after refused sync = %d, want %d", count, list.max)
			}
		})
	}
}

// Mirrors web mergeCard.test.ts case for case.
func TestCardUpsertMergeRule(t *testing.T) {
	fresh := fsrs("2026-01-01T00:00:00Z", 0)
	reviewed := fsrs("2026-01-09T00:00:00Z", 3)
	reviewedMore := fsrs("2026-01-20T00:00:00Z", 5)
	card := func(front, updatedAt string, fsrs []byte) Card {
		value := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", front, "card", fsrs)
		value.UpdatedAt = updatedAt
		return value
	}
	base := inWindow()
	earlier, later := base.Add(-48*time.Hour).Format(time.RFC3339), base.Add(-24*time.Hour).Format(time.RFC3339)
	tests := []struct {
		name             string
		stored, incoming Card
		want             Card
		// False only for the equal-time both-live or both-tombstone tie, where the stored copy wins.
		symmetric bool
	}{
		{"newer updatedAt wins", card("a", earlier, reviewed), card("b", later, reviewed), card("b", later, reviewed), true},
		{"older updatedAt loses", card("a", later, reviewed), card("b", earlier, reviewed), card("a", later, reviewed), true},
		{"older live copy never resurrects a tombstone", tombstone(card("a", "", reviewed), later), card("b", earlier, reviewed), tombstone(card("a", "", reviewed), later), true},
		{"newer live copy replaces a tombstone", tombstone(card("a", "", reviewed), earlier), card("b", later, reviewed), card("b", later, reviewed), true},
		{"equal time: incoming tombstone wins", card("a", later, reviewed), tombstone(card("b", "", reviewed), later), tombstone(card("b", "", reviewed), later), true},
		{"equal time: stored tombstone kept", tombstone(card("a", "", reviewed), later), card("b", later, reviewed), tombstone(card("a", "", reviewed), later), true},
		{"equal live cards: stored kept", card("a", later, reviewed), card("b", later, fresh), card("a", later, reviewed), false},
		{"equal tombstones: stored kept", tombstone(card("a", "", reviewed), later), tombstone(card("b", "", reviewedMore), later), tombstone(card("a", "", reviewed), later), false},
		{"newer fresh save over reviewed history keeps the history", card("a", earlier, reviewed), card("b", later, fresh), card("b", later, reviewed), true},
		{"older reviewed copy gives its history to a newer fresh save", card("a", later, fresh), card("b", earlier, reviewed), card("a", later, reviewed), true},
		{"older fresh save loses", card("a", later, reviewed), card("b", earlier, fresh), card("a", later, reviewed), true},
		{"reviewed beats reviewed by time", card("a", earlier, reviewedMore), card("b", later, reviewed), card("b", later, reviewed), true},
		{"tombstone with history + newer fresh save: live, history kept", tombstone(card("a", "", reviewed), earlier), card("b", later, fresh), card("b", later, reviewed), true},
	}
	run := func(t *testing.T, stored, incoming, want Card) {
		repo := newTestRepo(t)
		user := createTestUser(t, repo, "merge@example.com")
		syncState(t, repo, user.ID, State{Cards: []Card{stored}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
		got := syncState(t, repo, user.ID, State{Cards: []Card{incoming}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
		if !reflect.DeepEqual(got.Cards, []Card{want}) {
			t.Fatalf("cards = %#v, want %#v", got.Cards, []Card{want})
		}
		var fsrs []byte
		if err := repo.pool.QueryRow(context.Background(), "SELECT fsrs FROM cards WHERE user_id = $1 AND id = $2", user.ID, want.ID).Scan(&fsrs); err != nil {
			t.Fatalf("query stored fsrs: %v", err)
		}
		if !bytes.Equal(fsrs, want.Fsrs) {
			t.Fatalf("stored fsrs = %s, want %s", fsrs, want.Fsrs)
		}
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			run(t, test.stored, test.incoming, test.want)
		})
		if test.symmetric {
			t.Run(test.name+" (swapped)", func(t *testing.T) {
				run(t, test.incoming, test.stored, test.want)
			})
		}
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
		Cards:            []Card{testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "A", "card", fsrs("2026-01-01T00:00:00Z", 0))},
		PracticeDays:     []PracticeDay{{Date: "2026-09-22"}},
		LessonCompletion: []LessonCompletion{{LessonID: "lesson-a"}},
	}
	stateB := State{
		Cards:            []Card{testCard("lesson-2:sentence-2", "lesson-2", "sentence-2", "B", "card", fsrs("2026-01-01T00:00:00Z", 0))},
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
	got, err := repo.GetSession(context.Background(), "active")
	if err != nil || got.UserID != user.ID {
		t.Fatalf("GetSession() = %#v, %v; want %q, nil", got, err, user.ID)
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

func insertSession(t *testing.T, repo *Repository, userID, tokenHash, createdAgo, expiresIn string) {
	t.Helper()
	if _, err := repo.pool.Exec(context.Background(), `
		INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
		VALUES ($1, $2, now() - $3::interval, now() + $4::interval)
	`, tokenHash, userID, createdAgo, expiresIn); err != nil {
		t.Fatalf("insert session: %v", err)
	}
}

func sessionExpiresAt(t *testing.T, repo *Repository, tokenHash string) time.Time {
	t.Helper()
	var expiresAt time.Time
	if err := repo.pool.QueryRow(context.Background(), `SELECT expires_at FROM sessions WHERE token_hash = $1`, tokenHash).Scan(&expiresAt); err != nil {
		t.Fatalf("query expires_at: %v", err)
	}
	return expiresAt
}

func TestGetSessionExtendsAtMostOncePer24Hours(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "rolling@example.com")
	insertSession(t, repo, user.ID, "stale", "2 days", "27 days")
	insertSession(t, repo, user.ID, "recent", "1 hour", "29 days 1 hour")
	before := time.Now()

	first, err := repo.GetSession(context.Background(), "stale")
	if err != nil || !first.Extended {
		t.Fatalf("first GetSession() = %#v, %v; want extended", first, err)
	}
	extended := sessionExpiresAt(t, repo, "stale")
	if !extended.Equal(first.ExpiresAt) || extended.Before(before.Add(30*24*time.Hour-time.Minute)) {
		t.Fatalf("expires_at = %v, returned %v; want about now + 30 days", extended, first.ExpiresAt)
	}

	second, err := repo.GetSession(context.Background(), "stale")
	if err != nil || second.Extended {
		t.Fatalf("second GetSession() = %#v, %v; want not extended", second, err)
	}
	if got := sessionExpiresAt(t, repo, "stale"); !got.Equal(extended) {
		t.Fatalf("expires_at after second lookup = %v, want unchanged %v", got, extended)
	}

	recentBefore := sessionExpiresAt(t, repo, "recent")
	recent, err := repo.GetSession(context.Background(), "recent")
	if err != nil || recent.Extended {
		t.Fatalf("recent GetSession() = %#v, %v; want not extended", recent, err)
	}
	if got := sessionExpiresAt(t, repo, "recent"); !got.Equal(recentBefore) {
		t.Fatalf("recent expires_at = %v, want unchanged %v", got, recentBefore)
	}
}

func TestGetSessionExtensionCapsAt90DaysFromCreation(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "cap@example.com")
	insertSession(t, repo, user.ID, "old", "80 days", "1 day")

	session, err := repo.GetSession(context.Background(), "old")
	if err != nil || !session.Extended {
		t.Fatalf("GetSession() = %#v, %v; want extended", session, err)
	}
	var capped bool
	if err := repo.pool.QueryRow(context.Background(), `
		SELECT expires_at = created_at + interval '90 days' FROM sessions WHERE token_hash = 'old'
	`).Scan(&capped); err != nil {
		t.Fatalf("query cap: %v", err)
	}
	if !capped {
		t.Fatalf("expires_at = %v, want created_at + 90 days", sessionExpiresAt(t, repo, "old"))
	}
}

func TestGetSessionRejectsSessionPast90Days(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "past-cap@example.com")
	insertSession(t, repo, user.ID, "past-cap", "91 days", "1 day")
	if _, err := repo.GetSession(context.Background(), "past-cap"); !errors.Is(err, ErrSessionInvalid) {
		t.Fatalf("GetSession() error = %v, want ErrSessionInvalid", err)
	}
}

// Two syncs of one user with the same new keys in opposite orders must not deadlock.
func TestSyncStateConcurrentOppositeOrders(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "concurrent@example.com")
	for round := range 20 {
		forward := emptyState()
		for i := range 30 {
			lessonID := "lesson-" + strconv.Itoa(round) + "-" + strconv.Itoa(i)
			forward.Cards = append(forward.Cards, dirtyCard(testCard(lessonID+":s", lessonID, "s", "front", "back", fsrs("2026-09-22T10:00:00Z", 0))))
			forward.PracticeDays = append(forward.PracticeDays, PracticeDay{Date: time.Date(2000+round, 1, 1+i, 0, 0, 0, 0, time.UTC).Format("2006-01-02")})
			forward.LessonCompletion = append(forward.LessonCompletion, LessonCompletion{LessonID: lessonID})
		}
		backward := State{Cards: slices.Clone(forward.Cards), PracticeDays: slices.Clone(forward.PracticeDays), LessonCompletion: slices.Clone(forward.LessonCompletion)}
		slices.Reverse(backward.Cards)
		slices.Reverse(backward.PracticeDays)
		slices.Reverse(backward.LessonCompletion)

		errs := make(chan error, 2)
		for _, in := range []State{forward, backward} {
			go func() {
				_, err := repo.SyncState(context.Background(), user.ID, in)
				errs <- err
			}()
		}
		for range 2 {
			if err := <-errs; err != nil {
				t.Fatalf("round %d: SyncState() error = %v", round, err)
			}
		}
	}
}

func syncCards(t *testing.T, repo *Repository, userID string, cards ...Card) Synced {
	t.Helper()
	out, err := repo.SyncState(context.Background(), userID, State{Cards: append([]Card{}, cards...), PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}})
	if err != nil {
		t.Fatalf("SyncState() error = %v", err)
	}
	return out
}

func storedCardIDs(t *testing.T, repo *Repository, userID string) []string {
	t.Helper()
	rows, err := repo.pool.Query(context.Background(), "SELECT id FROM cards WHERE user_id = $1 ORDER BY id", userID)
	if err != nil {
		t.Fatalf("list card ids: %v", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("scan card ids: %v", err)
	}
	return ids
}

func responseIDs(cards []Card) []string {
	ids := []string{}
	for _, card := range cards {
		ids = append(ids, card.ID)
	}
	return ids
}

// G1: a clean card never inserts, whatever its updatedAt; a dirty one does.
func TestSyncCleanCardWithoutRowIsNotInserted(t *testing.T) {
	repo := newTestRepo(t)
	now := time.Now().UTC().Truncate(time.Second)
	for name, updatedAt := range map[string]time.Time{"past": now.Add(-time.Hour), "now": now, "future": now.Add(time.Hour)} {
		t.Run(name, func(t *testing.T) {
			user := createTestUser(t, repo, "clean-"+name+"@example.com")
			card := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "back", fsrs("2026-01-01T00:00:00Z", 0))
			card.UpdatedAt = updatedAt.Format(time.RFC3339)
			if out := syncCards(t, repo, user.ID, cleanCard(card)); len(out.Cards) != 0 {
				t.Fatalf("clean response cards = %v, want none", responseIDs(out.Cards))
			}
			if ids := storedCardIDs(t, repo, user.ID); len(ids) != 0 {
				t.Fatalf("clean stored = %v, want none", ids)
			}
			if out := syncCards(t, repo, user.ID, dirtyCard(card)); !slices.Equal(responseIDs(out.Cards), []string{card.ID}) {
				t.Fatalf("dirty response cards = %v, want %s", responseIDs(out.Cards), card.ID)
			}
		})
	}
}

// G2: a clean card on an existing row merges exactly as the dirty upsert does.
func TestSyncCleanCardMergesLikeDirty(t *testing.T) {
	fresh := fsrs("2026-01-01T00:00:00Z", 0)
	reviewed := fsrs("2026-01-09T00:00:00Z", 3)
	base := inWindow()
	earlier, later := base.Add(-48*time.Hour).Format(time.RFC3339), base.Add(-24*time.Hour).Format(time.RFC3339)
	card := func(front, updatedAt string, fsrs []byte) Card {
		value := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", front, "card", fsrs)
		value.UpdatedAt = updatedAt
		return value
	}
	tests := []struct {
		name             string
		stored, incoming Card
	}{
		{"newer wins", card("a", earlier, reviewed), card("b", later, reviewed)},
		{"older loses", card("a", later, reviewed), card("b", earlier, reviewed)},
		{"older live vs tombstone", tombstone(card("a", "", reviewed), later), card("b", earlier, reviewed)},
		{"newer live vs tombstone", tombstone(card("a", "", reviewed), earlier), card("b", later, reviewed)},
		{"equal time incoming tombstone", card("a", later, reviewed), tombstone(card("b", "", reviewed), later)},
		{"equal time stored tombstone", tombstone(card("a", "", reviewed), later), card("b", later, reviewed)},
		{"newer fresh keeps stored history", card("a", earlier, reviewed), card("b", later, fresh)},
		{"older reviewed gives history", card("a", later, fresh), card("b", earlier, reviewed)},
	}
	repo := newTestRepo(t)
	result := func(t *testing.T, email string, stored, incoming Card) ([]Card, string) {
		user := createTestUser(t, repo, email)
		syncCards(t, repo, user.ID, dirtyCard(stored))
		out := syncCards(t, repo, user.ID, incoming)
		var storedFSRS []byte
		if err := repo.pool.QueryRow(context.Background(), "SELECT fsrs FROM cards WHERE user_id = $1", user.ID).Scan(&storedFSRS); err != nil {
			t.Fatalf("query fsrs: %v", err)
		}
		return out.Cards, string(storedFSRS)
	}
	for i, test := range tests {
		for j, pair := range [][2]Card{{test.stored, test.incoming}, {test.incoming, test.stored}} {
			t.Run(test.name+[]string{"", " (swapped)"}[j], func(t *testing.T) {
				prefix := "g2-" + strconv.Itoa(i) + "-" + strconv.Itoa(j)
				dirty, dirtyFSRS := result(t, prefix+"-dirty@example.com", pair[0], dirtyCard(pair[1]))
				clean, cleanFSRS := result(t, prefix+"-clean@example.com", pair[0], cleanCard(pair[1]))
				if !reflect.DeepEqual(clean, dirty) || cleanFSRS != dirtyFSRS {
					t.Fatalf("clean = %#v / %s, dirty = %#v / %s", clean, cleanFSRS, dirty, dirtyFSRS)
				}
			})
		}
	}
}

func purgeAge(t *testing.T, repo *Repository, userID, id, age string) {
	t.Helper()
	if _, err := repo.pool.Exec(context.Background(), "UPDATE cards SET deleted_at = now() - $3::interval, updated_at = now() - $3::interval WHERE user_id = $1 AND id = $2", userID, id, age); err != nil {
		t.Fatalf("age tombstone: %v", err)
	}
}

// G3: the three measured cases, and the documented residual.
func TestSyncTombstoneResurrectCases(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "resurrect@example.com")
	live := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "back", fsrs("2026-01-01T00:00:00Z", 0))
	live.UpdatedAt = inWindow().Add(-48 * time.Hour).Format(time.RFC3339)
	deleted := tombstone(live, inWindow().Format(time.RFC3339))
	syncCards(t, repo, user.ID, dirtyCard(live))
	syncCards(t, repo, user.ID, dirtyCard(deleted))

	// 1: no purge; B re-sends its stale clean live copy and receives the tombstone.
	out := syncCards(t, repo, user.ID, cleanCard(live))
	if len(out.Cards) != 1 || out.Cards[0].DeletedAt.Value == nil {
		t.Fatalf("case 1 cards = %#v, want the tombstone", out.Cards)
	}

	purgeAge(t, repo, user.ID, live.ID, "181 days")
	if out := syncCards(t, repo, user.ID); len(out.Cards) != 0 {
		t.Fatalf("after purge cards = %v, want none", responseIDs(out.Cards))
	}
	// 2: A re-sends its clean tombstone; the purge holds.
	if out := syncCards(t, repo, user.ID, cleanCard(deleted)); len(out.Cards) != 0 || len(storedCardIDs(t, repo, user.ID)) != 0 {
		t.Fatalf("case 2 cards = %v, want none", responseIDs(out.Cards))
	}
	// 3: B re-sends its clean stale live copy; the purge holds.
	if out := syncCards(t, repo, user.ID, cleanCard(live)); len(out.Cards) != 0 || len(storedCardIDs(t, repo, user.ID)) != 0 {
		t.Fatalf("case 3 cards = %v, want none", responseIDs(out.Cards))
	}
	// Residual: a dirty live copy after the purge is inserted.
	if out := syncCards(t, repo, user.ID, dirtyCard(live)); len(out.Cards) != 1 || out.Cards[0].DeletedAt.Value != nil {
		t.Fatalf("residual cards = %#v, want the live card", out.Cards)
	}
}

// G4: the purge boundary, measured on the database clock.
func TestSyncPurgeBoundary(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "purge-boundary@example.com")
	ctx := context.Background()
	mk := func(sentenceID string) Card {
		card := testCard("lesson-1:"+sentenceID, "lesson-1", sentenceID, "front", "back", fsrs("2026-01-01T00:00:00Z", 0))
		return dirtyCard(tombstone(card, inWindow().Format(time.RFC3339)))
	}
	liveCard := dirtyCard(testCard("lesson-1:live", "lesson-1", "live", "front", "back", fsrs("2026-01-01T00:00:00Z", 0)))
	liveCard.UpdatedAt = "0001-01-01T00:00:00Z"
	syncCards(t, repo, user.ID, mk("over"), mk("under"), mk("year-1"), liveCard)
	purgeAge(t, repo, user.ID, "lesson-1:over", "180 days 1 minute")
	purgeAge(t, repo, user.ID, "lesson-1:under", "179 days 23 hours 59 minutes")
	if _, err := repo.pool.Exec(ctx, "UPDATE cards SET deleted_at = '0001-01-01T00:00:00Z', updated_at = '0001-01-01T00:00:00Z' WHERE user_id = $1 AND id = 'lesson-1:year-1'", user.ID); err != nil {
		t.Fatalf("age year-1: %v", err)
	}
	want := []string{"lesson-1:live", "lesson-1:under"}
	if out := syncCards(t, repo, user.ID); !slices.Equal(responseIDs(out.Cards), want) {
		t.Fatalf("response = %v, want %v", responseIDs(out.Cards), want)
	}
	if ids := storedCardIDs(t, repo, user.ID); !slices.Equal(ids, want) {
		t.Fatalf("stored = %v, want %v", ids, want)
	}
}

// G4: a user's purge never touches another user's tombstones.
func TestSyncPurgeLeavesOtherUsersTombstones(t *testing.T) {
	repo := newTestRepo(t)
	a := createTestUser(t, repo, "purge-scope-a@example.com")
	b := createTestUser(t, repo, "purge-scope-b@example.com")
	live := dirtyCard(testCard("lesson-1:live", "lesson-1", "live", "front", "back", fsrs("2026-01-01T00:00:00Z", 0)))
	deleted := dirtyCard(tombstone(testCard("lesson-1:deleted", "lesson-1", "deleted", "front", "back", fsrs("2026-01-01T00:00:00Z", 0)), inWindow().Format(time.RFC3339)))
	for _, user := range []User{a, b} {
		syncCards(t, repo, user.ID, live, deleted)
	}
	for _, user := range []User{a, b} {
		purgeAge(t, repo, user.ID, deleted.ID, "181 days")
	}
	want := []string{live.ID}
	if out := syncCards(t, repo, b.ID); !slices.Equal(responseIDs(out.Cards), want) {
		t.Fatalf("B response = %v, want %v", responseIDs(out.Cards), want)
	}
	if ids := storedCardIDs(t, repo, b.ID); !slices.Equal(ids, want) {
		t.Fatalf("B stored = %v, want %v", ids, want)
	}
	if ids := storedCardIDs(t, repo, a.ID); !slices.Equal(ids, []string{deleted.ID, live.ID}) {
		t.Fatalf("A stored after B's purge = %v, want %v", ids, []string{deleted.ID, live.ID})
	}
	syncCards(t, repo, a.ID)
	if ids := storedCardIDs(t, repo, a.ID); !slices.Equal(ids, want) {
		t.Fatalf("A stored after own purge = %v, want %v", ids, want)
	}
}

// G4: tombstones past retention do not count toward MaxCards.
func TestSyncPurgedTombstonesDoNotCountTowardMaxCards(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "purge-cap@example.com")
	if _, err := repo.pool.Exec(context.Background(), `
		INSERT INTO cards (user_id, id, front, back, lesson_id, sentence_id, word, fsrs, updated_at, deleted_at)
		SELECT $1, 'l:s' || g, 'front', 'back', 'l', 's' || g, '', $2::json, now(),
			CASE WHEN g >= $3 THEN now() - interval '181 days' END
		FROM generate_series(0, $3 + 2) AS g
	`, user.ID, fsrs("2026-01-01T00:00:00Z", 0), MaxCards); err != nil {
		t.Fatalf("seed cards: %v", err)
	}
	out := syncCards(t, repo, user.ID)
	if len(out.Cards) != MaxCards {
		t.Fatalf("cards = %d, want %d", len(out.Cards), MaxCards)
	}
	for _, card := range out.Cards {
		if card.DeletedAt.Value != nil {
			t.Fatalf("purged tombstone %s in response", card.ID)
		}
	}
}

// G6: the epoch is stable while its row exists; losing the row yields a new one; deleting the user removes it.
func TestSyncEpoch(t *testing.T) {
	repo := newTestRepo(t)
	user := createTestUser(t, repo, "epoch@example.com")
	ctx := context.Background()
	first := syncCards(t, repo, user.ID, dirtyCard(testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "back", fsrs("2026-01-01T00:00:00Z", 0))))
	if first.SyncEpoch == "" {
		t.Fatal("empty syncEpoch")
	}
	if again := syncCards(t, repo, user.ID); again.SyncEpoch != first.SyncEpoch {
		t.Fatalf("epoch changed: %s -> %s", first.SyncEpoch, again.SyncEpoch)
	}
	if _, err := repo.pool.Exec(ctx, "DELETE FROM cards WHERE user_id = $1", user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.pool.Exec(ctx, "DELETE FROM sync_epochs WHERE user_id = $1", user.ID); err != nil {
		t.Fatal(err)
	}
	wiped := syncCards(t, repo, user.ID)
	if wiped.SyncEpoch == "" || wiped.SyncEpoch == first.SyncEpoch {
		t.Fatalf("epoch after wipe = %q, want a new one (was %q)", wiped.SyncEpoch, first.SyncEpoch)
	}
	if _, err := repo.pool.Exec(ctx, "DELETE FROM users WHERE id = $1", user.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := repo.pool.QueryRow(ctx, "SELECT count(*) FROM sync_epochs WHERE user_id = $1", user.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("sync_epochs rows after user delete = %d, %v, want 0", count, err)
	}
}

// G1 + G5 wire: a request card without dirty is invalid.
func TestValidateRequiresDirty(t *testing.T) {
	card := wordSyncCard("hello")
	if err := (State{Cards: []Card{card}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}}).validate(); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("validate() = %v, want ErrInvalidState", err)
	}
}
