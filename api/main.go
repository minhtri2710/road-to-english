package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/road-to-english/api/internal/library"
	"github.com/road-to-english/api/internal/storage"
)

const defaultCORSOrigin = "http://localhost:5173"

func healthzHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func newMux(store *library.Store) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthzHandler)
	mux.HandleFunc("GET /lessons", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, store.Summaries())
	})
	mux.HandleFunc("GET /lessons/{id}", func(w http.ResponseWriter, r *http.Request) {
		lesson, ok := store.Lesson(r.PathValue("id"))
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusOK, lesson)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func corsMiddleware(next http.Handler, configuredOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Origin") == configuredOrigin {
			w.Header().Set("Access-Control-Allow-Origin", configuredOrigin)
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type responseBuffer struct {
	target      http.ResponseWriter
	header      http.Header
	body        bytes.Buffer
	status      int
	wroteHeader bool
}

func newResponseBuffer(target http.ResponseWriter) *responseBuffer {
	header := make(http.Header, len(target.Header()))
	for key, values := range target.Header() {
		header[key] = append([]string(nil), values...)
	}
	return &responseBuffer{target: target, header: header}
}

func (w *responseBuffer) Header() http.Header {
	return w.header
}

func (w *responseBuffer) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
}

func (w *responseBuffer) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(body)
}

func (w *responseBuffer) flush() {
	if !w.wroteHeader {
		w.status = http.StatusOK
	}
	if w.status == http.StatusNotFound && w.header.Get("Content-Type") != "application/json" {
		w.body.Reset()
		_ = json.NewEncoder(&w.body).Encode(map[string]string{"error": "not found"})
	}
	if w.status == http.StatusMethodNotAllowed && w.header.Get("Content-Type") != "application/json" {
		w.body.Reset()
		_ = json.NewEncoder(&w.body).Encode(map[string]string{"error": "method not allowed"})
	}
	w.header.Set("Content-Type", "application/json")
	for key := range w.target.Header() {
		w.target.Header().Del(key)
	}
	for key, values := range w.header {
		w.target.Header()[key] = append([]string(nil), values...)
	}
	w.target.WriteHeader(w.status)
	_, _ = w.target.Write(w.body.Bytes())
}

func jsonResponseMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buffer := newResponseBuffer(w)
		next.ServeHTTP(buffer, r)
		buffer.flush()
	})
}

func main() {
	store, err := library.LoadSeed()
	if err != nil {
		log.Fatalf("load lesson library: %v", err)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL must be set")
	}
	repo, err := storage.Open(context.Background(), dsn)
	if err != nil {
		log.Fatalf("open storage: %v", err)
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

	handler := corsMiddleware(jsonResponseMiddleware(newMux(store)), origin)
	log.Printf("API server listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}
