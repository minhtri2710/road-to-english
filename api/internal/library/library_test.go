package library

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLoadSeed(t *testing.T) {
	store, err := LoadSeed()
	if err != nil {
		t.Fatalf("LoadSeed() error = %v", err)
	}

	summaries := store.Summaries()
	if len(summaries) != 31 {
		t.Fatalf("LoadSeed() returned %d lessons, want 31", len(summaries))
	}
	levels := make(map[Level]int)
	sentenceCount := 0
	for _, summary := range summaries {
		levels[summary.Level]++
		lesson, _ := store.Lesson(summary.ID)
		if len(lesson.Sentences) != 9 {
			t.Errorf("lesson %q has %d sentences, want 9", lesson.ID, len(lesson.Sentences))
		}
		for _, sentence := range lesson.Sentences {
			sentenceCount++
			if sentence.VI == "" {
				t.Errorf("sentence %q has empty vi", sentence.ID)
			}
			if sentence.VIStatus != VIStatusDraft {
				t.Errorf("sentence %q has viStatus %q, want %q", sentence.ID, sentence.VIStatus, VIStatusDraft)
			}
		}
	}
	if sentenceCount < 279 {
		t.Errorf("seed has %d sentences, want at least 279", sentenceCount)
	}
	for level, want := range map[Level]int{LevelA1: 8, LevelA2: 9, LevelB1: 7, LevelB2: 7} {
		if levels[level] != want {
			t.Errorf("seed has %d lessons at level %q, want %d", levels[level], level, want)
		}
	}
}

func TestNewStoreValidation(t *testing.T) {
	validLesson := Lesson{
		ID:        "lesson-1",
		Title:     "A Lesson",
		Level:     LevelA2,
		TargetWPM: 90,
		Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VI: "Một câu hữu ích.", VIStatus: VIStatusDraft}},
	}

	tests := []struct {
		name    string
		lessons []Lesson
		wantErr bool
	}{
		{
			name:    "valid",
			lessons: []Lesson{validLesson},
		},
		{
			name: "duplicate lesson id",
			lessons: []Lesson{
				validLesson,
				validLesson,
			},
			wantErr: true,
		},
		{
			name: "duplicate sentence id",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     validLesson.Level,
				TargetWPM: validLesson.TargetWPM,
				Sentences: []Sentence{
					{ID: "same", Text: "First sentence.", VI: "Câu thứ nhất.", VIStatus: VIStatusDraft},
					{ID: "same", Text: "Second sentence.", VI: "Câu thứ hai.", VIStatus: VIStatusDraft},
				},
			}},
			wantErr: true,
		},
		{
			name: "empty text",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     validLesson.Level,
				TargetWPM: validLesson.TargetWPM,
				Sentences: []Sentence{{ID: "sentence-1", VI: "Một câu hữu ích.", VIStatus: VIStatusDraft}},
			}},
			wantErr: true,
		},
		{
			name: "empty vi",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     validLesson.Level,
				TargetWPM: validLesson.TargetWPM,
				Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VIStatus: VIStatusDraft}},
			}},
			wantErr: true,
		},
		{
			name: "missing viStatus",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     validLesson.Level,
				TargetWPM: validLesson.TargetWPM,
				Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VI: "Một câu hữu ích."}},
			}},
			wantErr: true,
		},
		{
			name: "unknown viStatus",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     validLesson.Level,
				TargetWPM: validLesson.TargetWPM,
				Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VI: "Một câu hữu ích.", VIStatus: VIStatusDraft + "x"}},
			}},
			wantErr: true,
		},
		{
			name: "checked viStatus",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     validLesson.Level,
				TargetWPM: validLesson.TargetWPM,
				Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VI: "Một câu hữu ích.", VIStatus: VIStatusChecked}},
			}},
		},
		{
			name: "A1 level",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     LevelA1,
				TargetWPM: 80,
				Sentences: validLesson.Sentences,
			}},
		},
		{
			name: "bad level",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     Level("C1"),
				TargetWPM: validLesson.TargetWPM,
				Sentences: validLesson.Sentences,
			}},
			wantErr: true,
		},
		{
			name: "non-positive target wpm",
			lessons: []Lesson{{
				ID:        validLesson.ID,
				Title:     validLesson.Title,
				Level:     validLesson.Level,
				TargetWPM: 0,
				Sentences: validLesson.Sentences,
			}},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store, err := NewStore(test.lessons)
			if test.wantErr {
				if err == nil {
					t.Fatal("NewStore() error = nil, want validation error")
				}
				return
			}
			if err != nil {
				t.Fatalf("NewStore() error = %v", err)
			}
			if store == nil {
				t.Fatal("NewStore() returned nil store")
			}
		})
	}
}

func TestStoreSummariesAndLesson(t *testing.T) {
	lesson := Lesson{
		ID:        "lesson-1",
		Title:     "A Lesson",
		Level:     LevelB1,
		TargetWPM: 110,
		Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VI: "Một câu hữu ích.", VIStatus: VIStatusDraft, Notes: "practice"}},
	}
	store, err := NewStore([]Lesson{lesson})
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}

	summaries := store.Summaries()
	if len(summaries) != 1 || summaries[0] != (Summary{
		ID:            lesson.ID,
		Title:         lesson.Title,
		Level:         lesson.Level,
		SentenceCount: 1,
		TargetWPM:     lesson.TargetWPM,
	}) {
		t.Fatalf("Summaries() = %#v, want summary for %#v", summaries, lesson)
	}

	got, ok := store.Lesson(lesson.ID)
	if !ok || got.ID != lesson.ID || len(got.Sentences) != 1 || got.Sentences[0] != lesson.Sentences[0] {
		t.Fatalf("Lesson(%q) = %#v, %v; want %#v, true", lesson.ID, got, ok, lesson)
	}
	got.Sentences[0].Text = "changed"
	if again, _ := store.Lesson(lesson.ID); again.Sentences[0] != lesson.Sentences[0] {
		t.Fatalf("Lesson(%q) after mutating a returned lesson = %#v, want %#v", lesson.ID, again.Sentences[0], lesson.Sentences[0])
	}
	if _, ok := store.Lesson("missing"); ok {
		t.Fatal(`Lesson("missing") found a lesson`)
	}
}

func TestSentenceJSONIncludesVI(t *testing.T) {
	data, err := json.Marshal(Sentence{ID: "s-1", Text: "Hello.", VI: "Xin chào.", VIStatus: VIStatusDraft})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if !strings.Contains(string(data), `"vi":"Xin chào."`) {
		t.Fatalf("Sentence JSON = %s, want vi field", data)
	}
	if !strings.Contains(string(data), `"viStatus":"draft"`) {
		t.Fatalf("Sentence JSON = %s, want viStatus field", data)
	}
}
