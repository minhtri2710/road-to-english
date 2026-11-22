package main

import (
	"errors"
	"net/http"

	"github.com/road-to-english/api/internal/storage"
)

// Bounds one push of changed cards and progress; the server returns the full account state.
const syncBodyMaxBytes int64 = 4 * 1024 * 1024

func syncHandler(w http.ResponseWriter, r *http.Request, repo *storage.Repository) {
	owner := r.Header.Get("X-RTE-Sync-Owner")
	if owner == "" {
		writeError(w, http.StatusBadRequest, "missing sync owner")
		return
	}
	if owner != requestUserID(r) {
		writeError(w, http.StatusConflict, "sync owner mismatch")
		return
	}
	var input storage.State
	if !decodeJSONBody(w, r, &input, syncBodyMaxBytes, "invalid sync state") {
		return
	}
	state, err := repo.SyncState(r.Context(), requestUserID(r), input)
	if errors.Is(err, storage.ErrInvalidState) {
		writeError(w, http.StatusBadRequest, "invalid sync state")
		return
	}
	if errors.Is(err, storage.ErrTooManyCards) {
		writeError(w, http.StatusRequestEntityTooLarge, "too many cards")
		return
	}
	if errors.Is(err, storage.ErrTooManyPracticeDays) {
		writeError(w, http.StatusRequestEntityTooLarge, "too many practice days")
		return
	}
	if errors.Is(err, storage.ErrTooManyLessonCompletions) {
		writeError(w, http.StatusRequestEntityTooLarge, "too many lesson completions")
		return
	}
	if errors.Is(err, storage.ErrTooManyLearnProgress) {
		writeError(w, http.StatusRequestEntityTooLarge, "too many learn progress entries")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, state)
}
