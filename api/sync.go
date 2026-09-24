package main

import (
	"errors"
	"net/http"

	"github.com/road-to-english/api/internal/storage"
)

// ponytail: full-state push ceiling; upgrade = delta sync.
const syncBodyMaxBytes int64 = 4 * 1024 * 1024

func syncHandler(w http.ResponseWriter, r *http.Request, repo *storage.Repository) {
	var input storage.State
	if !decodeJSONBody(w, r, &input, syncBodyMaxBytes, "invalid sync state") {
		return
	}
	state, err := repo.SyncState(r.Context(), requestUserID(r), input)
	if errors.Is(err, storage.ErrInvalidState) {
		writeError(w, http.StatusBadRequest, "invalid sync state")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, state)
}
