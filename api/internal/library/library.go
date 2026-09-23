package library

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// Level is the CEFR level assigned to a lesson.
type Level string

const (
	LevelA1 Level = "A1"
	LevelA2 Level = "A2"
	LevelB1 Level = "B1"
	LevelB2 Level = "B2"
)

type Sentence struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	VI    string `json:"vi"`
	Notes string `json:"notes,omitempty"`
}

type Lesson struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Level     Level      `json:"level"`
	TargetWPM int        `json:"targetWpm"`
	Sentences []Sentence `json:"sentences"`
}

type Summary struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Level         Level  `json:"level"`
	SentenceCount int    `json:"sentenceCount"`
	TargetWPM     int    `json:"targetWpm"`
}

type Store struct {
	lessonsByID map[string]Lesson
	lessons     []Lesson
}

//go:embed seed.json
var seedJSON []byte

func LoadSeed() (*Store, error) {
	var lessons []Lesson
	if err := json.Unmarshal(seedJSON, &lessons); err != nil {
		return nil, fmt.Errorf("decode seed: %w", err)
	}
	return NewStore(lessons)
}

func NewStore(lessons []Lesson) (*Store, error) {
	if len(lessons) == 0 {
		return nil, fmt.Errorf("library must contain at least one lesson")
	}

	store := &Store{
		lessonsByID: make(map[string]Lesson, len(lessons)),
		lessons:     make([]Lesson, 0, len(lessons)),
	}
	for lessonIndex, lesson := range lessons {
		if lesson.ID == "" {
			return nil, fmt.Errorf("lesson %d has an empty id", lessonIndex)
		}
		if lesson.Title == "" {
			return nil, fmt.Errorf("lesson %q has an empty title", lesson.ID)
		}
		if _, exists := store.lessonsByID[lesson.ID]; exists {
			return nil, fmt.Errorf("duplicate lesson id %q", lesson.ID)
		}
		if !validLevel(lesson.Level) {
			return nil, fmt.Errorf("lesson %q has invalid level %q", lesson.ID, lesson.Level)
		}
		if lesson.TargetWPM <= 0 {
			return nil, fmt.Errorf("lesson %q has non-positive targetWpm", lesson.ID)
		}

		sentenceIDs := make(map[string]struct{}, len(lesson.Sentences))
		for sentenceIndex, sentence := range lesson.Sentences {
			if sentence.ID == "" {
				return nil, fmt.Errorf("lesson %q sentence %d has an empty id", lesson.ID, sentenceIndex)
			}
			if sentence.Text == "" {
				return nil, fmt.Errorf("lesson %q sentence %q has empty text", lesson.ID, sentence.ID)
			}
			if sentence.VI == "" {
				return nil, fmt.Errorf("lesson %q sentence %q has empty vi", lesson.ID, sentence.ID)
			}
			if _, exists := sentenceIDs[sentence.ID]; exists {
				return nil, fmt.Errorf("lesson %q has duplicate sentence id %q", lesson.ID, sentence.ID)
			}
			sentenceIDs[sentence.ID] = struct{}{}
		}

		lesson.Sentences = append([]Sentence(nil), lesson.Sentences...)
		store.lessons = append(store.lessons, lesson)
		store.lessonsByID[lesson.ID] = lesson
	}

	return store, nil
}

func (s *Store) Summaries() []Summary {
	summaries := make([]Summary, 0, len(s.lessons))
	for _, lesson := range s.lessons {
		summaries = append(summaries, Summary{
			ID:            lesson.ID,
			Title:         lesson.Title,
			Level:         lesson.Level,
			SentenceCount: len(lesson.Sentences),
			TargetWPM:     lesson.TargetWPM,
		})
	}
	return summaries
}

func (s *Store) Lesson(id string) (Lesson, bool) {
	lesson, ok := s.lessonsByID[id]
	if !ok {
		return Lesson{}, false
	}
	lesson.Sentences = append([]Sentence(nil), lesson.Sentences...)
	return lesson, true
}

func validLevel(level Level) bool {
	switch level {
	case LevelA1, LevelA2, LevelB1, LevelB2:
		return true
	default:
		return false
	}
}
