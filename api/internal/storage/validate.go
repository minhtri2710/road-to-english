package storage

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// validate checks the whole sync input against the wire contract web validateCard also enforces.
func (s State) validate() error {
	if s.Cards == nil || s.PracticeDays == nil || s.LessonCompletion == nil {
		return ErrInvalidState
	}

	cardIDs := make(map[string]struct{}, len(s.Cards))
	for _, card := range s.Cards {
		if !ValidText(card.ID) || !ValidText(card.Front) || !validTextOrEmpty(card.Back) || !ValidText(card.Source.LessonID) || !ValidText(card.Source.SentenceID) {
			return ErrInvalidState
		}
		if card.Source.Word == nil || !validCardWord(*card.Source.Word) {
			return ErrInvalidState
		}
		if card.ID != cardID(card.Source.LessonID, card.Source.SentenceID, *card.Source.Word) {
			return ErrInvalidState
		}
		if _, exists := cardIDs[card.ID]; exists {
			return ErrInvalidState
		}
		cardIDs[card.ID] = struct{}{}
		if !validFSRS(card.Fsrs) {
			return ErrInvalidState
		}
		if _, err := parseTimestamp(card.UpdatedAt); err != nil {
			return ErrInvalidState
		}
		if !card.DeletedAt.Present {
			return ErrInvalidState
		}
		if card.DeletedAt.Value != nil {
			if _, err := parseTimestamp(*card.DeletedAt.Value); err != nil {
				return ErrInvalidState
			}
		}
	}

	for _, practiceDay := range s.PracticeDays {
		date, err := time.Parse("2006-01-02", practiceDay.Date)
		if err != nil || date.Year() < 1 || date.Format("2006-01-02") != practiceDay.Date {
			return ErrInvalidState
		}
	}
	for _, completion := range s.LessonCompletion {
		if !ValidText(completion.LessonID) {
			return ErrInvalidState
		}
	}
	return nil
}

var cardWordPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

func validCardWord(word string) bool {
	return word == "" || cardWordPattern.MatchString(word)
}

func cardID(lessonID, sentenceID, word string) string {
	if word == "" {
		return lessonID + ":" + sentenceID
	}
	return lessonID + ":" + sentenceID + ":" + word
}

// ValidText reports a non-empty string Postgres TEXT can store: it holds no NUL.
func ValidText(value string) bool {
	return value != "" && validTextOrEmpty(value)
}

func validTextOrEmpty(value string) bool {
	return !strings.ContainsRune(value, 0)
}

func validFSRS(raw json.RawMessage) bool {
	if !utf8.Valid(raw) {
		return false
	}
	var object map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &object) != nil || object == nil {
		return false
	}
	var due string
	if rawDue, ok := object["due"]; !ok || json.Unmarshal(rawDue, &due) != nil {
		return false
	}
	if _, err := parseTimestamp(due); err != nil {
		return false
	}
	if !validLastReview(object["last_review"]) {
		return false
	}
	for _, key := range []string{"stability", "difficulty"} {
		if !fsrsNumber(object[key], false, math.MaxFloat64) {
			return false
		}
	}
	for _, key := range []string{"elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses"} {
		if !fsrsNumber(object[key], true, maxSafeInteger) {
			return false
		}
	}
	return fsrsNumber(object["state"], true, 3)
}

// validLastReview accepts a missing or null last_review, or a timestamp string.
func validLastReview(raw json.RawMessage) bool {
	if raw == nil || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return true
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return false
	}
	_, err := parseTimestamp(value)
	return err == nil
}

// JavaScript's Number.MAX_SAFE_INTEGER: web validateCard accepts the same integers.
const maxSafeInteger = 1<<53 - 1

// A required FSRS number in [0, max]; JSON has no NaN or Infinity, so a decoded float64 is finite.
func fsrsNumber(raw json.RawMessage, integer bool, max float64) bool {
	var value *float64
	if raw == nil || json.Unmarshal(raw, &value) != nil || value == nil {
		return false
	}
	return *value >= 0 && *value <= max && (!integer || *value == math.Trunc(*value))
}
