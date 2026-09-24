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
	"testing"
	"time"

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
	valid := testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "", fsrs("2026-09-22T10:00:00Z", 0))
	nilWord := testCard("lesson-1:sentence-2", "lesson-1", "sentence-2", "front", "", fsrs("2026-09-22T10:00:00Z", 0))
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
	invalid.Cards = []Card{testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "", fsrs("2026-09-22T10:00:00Z", 0))}
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
			Cards:            []Card{testCard("lesson-1:sentence-1", "lesson-1", "sentence-1", "front", "", fsrs("2026-09-22T10:00:00Z", 0))},
			PracticeDays:     []PracticeDay{{Date: "2026-09-22"}},
			LessonCompletion: []LessonCompletion{{LessonID: "lesson-1"}},
		}
	}
	addCard := func(state *State, mutate func(*Card)) {
		card := testCard("lesson-1:sentence-2", "lesson-1", "sentence-2", "front", "", fsrs("2026-09-22T10:00:00Z", 0))
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
	return State{Cards: []Card{card}, PracticeDays: []PracticeDay{}, LessonCompletion: []LessonCompletion{}}
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
	deleted := tombstone(testCard("lesson-1:sentence-2", "lesson-1", "sentence-2", "deleted", "card", fsrs("2026-01-01T00:00:00Z", 0)), "2026-01-03T00:00:00.5Z")

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
	want := time.Date(2026, 1, 3, 0, 0, 0, 500_000_000, time.UTC)
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
	const earlier, later = "2026-01-02T00:00:00Z", "2026-01-04T00:00:00Z"
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
			forward.Cards = append(forward.Cards, testCard(lessonID+":s", lessonID, "s", "front", "back", fsrs("2026-09-22T10:00:00Z", 0)))
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
