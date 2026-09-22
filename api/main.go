package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/road-to-english/api/internal/auth"
	"github.com/road-to-english/api/internal/library"
	"github.com/road-to-english/api/internal/storage"
)

const defaultCORSOrigin = "http://localhost:5173"
const sessionCookieName = "session"

type contextKey string

const userIDContextKey contextKey = "userID"

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func healthzHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func newMux(store *library.Store, repo *storage.Repository) *http.ServeMux {
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
	mux.HandleFunc("POST /signup", func(w http.ResponseWriter, r *http.Request) {
		credentials, ok := decodeCredentials(w, r)
		if !ok {
			return
		}
		passwordHash, err := auth.HashPassword(credentials.Password)
		if err != nil {
			if errors.Is(err, auth.ErrPasswordTooLong) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid credentials"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		user, err := repo.CreateUser(r.Context(), credentials.Email, passwordHash)
		if err != nil {
			if errors.Is(err, storage.ErrEmailTaken) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		if !setSessionCookie(w, r, repo, user.Id) {
			return
		}
		writeUser(w, user)
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		credentials, ok := decodeCredentials(w, r)
		if !ok {
			return
		}
		user, passwordHash, err := repo.GetUserByEmail(r.Context(), credentials.Email)
		if err != nil {
			if errors.Is(err, storage.ErrUserNotFound) {
				auth.CheckDummyPassword(credentials.Password)
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		if !auth.CheckPassword(passwordHash, credentials.Password) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
			return
		}
		if !setSessionCookie(w, r, repo, user.Id) {
			return
		}
		writeUser(w, user)
	})
	mux.HandleFunc("POST /logout", func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
			if err := repo.DeleteSession(r.Context(), auth.HashSessionToken(cookie.Value)); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
				return
			}
		}
		clearSessionCookie(w, r)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle("GET /me", authMiddleware(repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := repo.GetUserByID(r.Context(), r.Context().Value(userIDContextKey).(string))
		if err != nil {
			if errors.Is(err, storage.ErrUserNotFound) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		writeUser(w, user)
	})))
	return mux
}

func decodeCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var input credentials
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Email == "" || len(input.Password) == 0 || len(input.Password) > 72 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid credentials"})
		return credentials{}, false
	}
	return input, true
}

func writeUser(w http.ResponseWriter, user storage.User) {
	writeJSON(w, http.StatusOK, map[string]string{"id": user.Id, "email": user.Email})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, repo *storage.Repository, userID string) bool {
	rawToken, tokenHash := auth.NewSessionToken()
	expiresAt := time.Now().Add(auth.SessionTTL)
	if err := repo.CreateSession(r.Context(), userID, tokenHash, expiresAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    rawToken,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(auth.SessionTTL / time.Second),
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	})
	return true
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	})
}

func authMiddleware(repo *storage.Repository, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil || cookie.Value == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		userID, err := repo.GetSession(r.Context(), auth.HashSessionToken(cookie.Value))
		if err != nil {
			if errors.Is(err, storage.ErrSessionInvalid) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDContextKey, userID)))
	})
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
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
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

	handler := corsMiddleware(jsonResponseMiddleware(newMux(store, repo)), origin)
	log.Printf("API server listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}
