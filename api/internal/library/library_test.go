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
	if len(summaries) < 12 {
		t.Fatalf("LoadSeed() returned %d lessons, want at least 12", len(summaries))
	}
	levels := make(map[Level]int)
	sentenceCount := 0
	for _, summary := range summaries {
		levels[summary.Level]++
		lesson, _ := store.Lesson(summary.ID)
		for _, sentence := range lesson.Sentences {
			sentenceCount++
			if sentence.VI == "" {
				t.Errorf("sentence %q has empty vi", sentence.ID)
			}
		}
	}
	if sentenceCount < 100 {
		t.Errorf("seed has %d sentences, want at least 100", sentenceCount)
	}
	for _, level := range []Level{LevelA2, LevelB1, LevelB2} {
		if levels[level] < 3 {
			t.Errorf("seed has %d lessons at level %q, want at least 3", levels[level], level)
		}
	}
}

func TestNewStoreValidation(t *testing.T) {
	validLesson := Lesson{
		ID:        "lesson-1",
		Title:     "A Lesson",
		Level:     LevelA2,
		TargetWPM: 90,
		Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VI: "Một câu hữu ích."}},
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
					{ID: "same", Text: "First sentence.", VI: "Câu thứ nhất."},
					{ID: "same", Text: "Second sentence.", VI: "Câu thứ hai."},
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
				Sentences: []Sentence{{ID: "sentence-1", VI: "Một câu hữu ích."}},
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
				Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence."}},
			}},
			wantErr: true,
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
		Sentences: []Sentence{{ID: "sentence-1", Text: "A useful sentence.", VI: "Một câu hữu ích.", Notes: "practice"}},
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
	if _, ok := store.Lesson("missing"); ok {
		t.Fatal(`Lesson("missing") found a lesson`)
	}
}

func TestSentenceJSONIncludesVI(t *testing.T) {
	data, err := json.Marshal(Sentence{ID: "s-1", Text: "Hello.", VI: "Xin chào."})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if !strings.Contains(string(data), `"vi":"Xin chào."`) {
		t.Fatalf("Sentence JSON = %s, want vi field", data)
	}
}
