package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"time"

	"github.com/road-to-english/api/internal/library"
	"github.com/road-to-english/api/internal/storage"
)

const defaultCORSOrigin = "http://localhost:5173"

func healthzHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func newMux(store *library.Store, repo *storage.Repository) *http.ServeMux {
	limiter := newAuthLimiter()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthzHandler)
	mux.HandleFunc("GET /lessons", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Summaries())
	})
	mux.HandleFunc("GET /lessons/{id}", func(w http.ResponseWriter, r *http.Request) {
		lesson, ok := store.Lesson(r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeJSON(w, http.StatusOK, lesson)
	})
	mux.HandleFunc("POST /signup", func(w http.ResponseWriter, r *http.Request) {
		signupHandler(w, r, repo, limiter)
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		loginHandler(w, r, repo, limiter)
	})
	mux.HandleFunc("POST /logout", func(w http.ResponseWriter, r *http.Request) {
		logoutHandler(w, r, repo)
	})
	mux.Handle("GET /me", authMiddleware(repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		meHandler(w, r, repo)
	})))
	mux.Handle("POST /sync", authMiddleware(repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		syncHandler(w, r, repo)
	})))
	return mux
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64, invalidMessage string) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported media type")
		return false
	}

	writeDecodeError := func(err error) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		} else {
			writeError(w, http.StatusBadRequest, invalidMessage)
		}
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	if err := decoder.Decode(dst); err != nil {
		writeDecodeError(err)
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeDecodeError(err)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// requestTimeout is 5 s under WriteTimeout so a timed-out handler can still write its error.
const requestTimeout = 25 * time.Second

func withRequestTimeout(next http.Handler, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func newServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           withRequestTimeout(handler, requestTimeout),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

func run() error {
	store, err := library.LoadSeed()
	if err != nil {
		return fmt.Errorf("load lesson library: %w", err)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL must be set")
	}
	repo, err := storage.Open(context.Background(), dsn)
	if err != nil {
		return fmt.Errorf("open storage: %w", err)
	}
	defer repo.Close()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	origin := os.Getenv("CORS_ORIGIN")
	if origin == "" {
		origin = defaultCORSOrigin
	}

	handler := corsMiddleware(jsonResponseMiddleware(newMux(store, repo)), origin)
	log.Printf("API server listening on :%s", port)
	return newServer(":"+port, handler).ListenAndServe()
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
