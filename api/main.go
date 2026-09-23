package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/road-to-english/api/internal/auth"
	"github.com/road-to-english/api/internal/library"
	"github.com/road-to-english/api/internal/storage"
)

const defaultCORSOrigin = "http://localhost:5173"
const sessionCookieName = "session"

const authBodyMaxBytes int64 = 4 * 1024

// ponytail: full-state push ceiling; upgrade = delta sync.
const syncBodyMaxBytes int64 = 4 * 1024 * 1024

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
	limiter := newAuthLimiter()
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
		if !limiter.allowIP(w, r) {
			return
		}
		credentials, ok := decodeCredentials(w, r)
		if !ok {
			return
		}
		credentials.Email = normalizeEmail(credentials.Email)
		if !validText(credentials.Email) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid email"})
			return
		}
		passwordHash, err := auth.HashPassword(credentials.Password)
		if err != nil {
			switch {
			case errors.Is(err, auth.ErrPasswordTooShort):
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password too short"})
				return
			case errors.Is(err, auth.ErrPasswordTooLong):
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password too long"})
				return
			default:
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
				return
			}
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
		if !setSessionCookie(w, r, repo, user.ID) {
			return
		}
		writeUser(w, user)
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		if !limiter.allowIP(w, r) {
			return
		}
		credentials, ok := decodeCredentials(w, r)
		if !ok {
			return
		}
		credentials.Email = normalizeEmail(credentials.Email)
		if !validLoginCredentials(credentials) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid credentials"})
			return
		}
		if !limiter.allowAccount(w, credentials.Email) {
			return
		}
		user, passwordHash, err := repo.GetUserByEmail(r.Context(), credentials.Email)
		if err != nil {
			if errors.Is(err, storage.ErrUserNotFound) {
				auth.CheckDummyPassword(credentials.Password)
				limiter.recordFailure(credentials.Email)
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		if !auth.CheckPassword(passwordHash, credentials.Password) {
			limiter.recordFailure(credentials.Email)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
			return
		}
		limiter.clearFailures(credentials.Email)
		if !setSessionCookie(w, r, repo, user.ID) {
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
	mux.Handle("POST /sync", authMiddleware(repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		syncHandler(w, r, repo)
	})))
	return mux
}

const (
	ipAttemptLimit     = 20
	ipAttemptWindow    = time.Minute
	loginFailureLimit  = 10
	loginFailureWindow = 15 * time.Minute
	limiterMaxEntries  = 10000
)

type limitWindow struct {
	start time.Time
	count int
}

// ponytail: in-memory, single-instance limiter; move to a shared store if the api runs more than one instance.
type authLimiter struct {
	mu       sync.Mutex
	ips      map[string]*limitWindow
	failures map[string]*limitWindow
}

func newAuthLimiter() *authLimiter {
	return &authLimiter{ips: map[string]*limitWindow{}, failures: map[string]*limitWindow{}}
}

// current returns key's live window, dropping expired entries; nil when none is live.
func current(windows map[string]*limitWindow, key string, length time.Duration, now time.Time) *limitWindow {
	entry := windows[key]
	if entry != nil && !now.Before(entry.start.Add(length)) {
		delete(windows, key)
		return nil
	}
	return entry
}

// admit starts a window for key, sweeping expired entries when the map is full. It fails closed when every entry is live.
func admit(windows map[string]*limitWindow, key string, length time.Duration, now time.Time) *limitWindow {
	if len(windows) >= limiterMaxEntries {
		for other, entry := range windows {
			if !now.Before(entry.start.Add(length)) {
				delete(windows, other)
			}
		}
		if len(windows) >= limiterMaxEntries {
			return nil
		}
	}
	entry := &limitWindow{start: now}
	windows[key] = entry
	return entry
}

func writeTooManyAttempts(w http.ResponseWriter, retryAfter time.Duration) {
	seconds := int((retryAfter + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many attempts"})
}

// allowIP counts one auth request for the client's RemoteAddr host; X-Forwarded-For is not trusted.
func (l *authLimiter) allowIP(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry := current(l.ips, host, ipAttemptWindow, now)
	if entry == nil {
		entry = admit(l.ips, host, ipAttemptWindow, now)
		if entry == nil {
			writeTooManyAttempts(w, ipAttemptWindow)
			return false
		}
	}
	if entry.count >= ipAttemptLimit {
		writeTooManyAttempts(w, entry.start.Add(ipAttemptWindow).Sub(now))
		return false
	}
	entry.count++
	return true
}

func (l *authLimiter) allowAccount(w http.ResponseWriter, email string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry := current(l.failures, email, loginFailureWindow, now)
	if entry != nil && entry.count >= loginFailureLimit {
		writeTooManyAttempts(w, entry.start.Add(loginFailureWindow).Sub(now))
		return false
	}
	return true
}

func (l *authLimiter) recordFailure(email string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	entry := current(l.failures, email, loginFailureWindow, now)
	if entry == nil {
		entry = admit(l.failures, email, loginFailureWindow, now)
		if entry == nil {
			return
		}
	}
	entry.count++
}

func (l *authLimiter) clearFailures(email string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, email)
}

func decodeCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var input credentials
	if !decodeJSONBody(w, r, &input, authBodyMaxBytes, "invalid credentials") {
		return credentials{}, false
	}
	return input, true
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validLoginCredentials(input credentials) bool {
	return validText(input.Email) && len(input.Password) > 0 && len(input.Password) <= 72
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64, invalidMessage string) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "unsupported media type"})
		return false
	}

	writeDecodeError := func(err error) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body too large"})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": invalidMessage})
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

func syncHandler(w http.ResponseWriter, r *http.Request, repo *storage.Repository) {
	var input storage.State
	if !decodeJSONBody(w, r, &input, syncBodyMaxBytes, "invalid sync state") {
		return
	}
	if !validateSyncState(input) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid sync state"})
		return
	}

	userID, ok := r.Context().Value(userIDContextKey).(string)
	if !ok || userID == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}
	state, err := repo.SyncState(r.Context(), userID, input)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func validateSyncState(state storage.State) bool {
	if state.Cards == nil || state.PracticeDays == nil || state.LessonCompletion == nil {
		return false
	}

	cardIDs := make(map[string]struct{}, len(state.Cards))
	for _, card := range state.Cards {
		if !validText(card.ID) || !validText(card.Front) || !validTextOrEmpty(card.Back) || !validText(card.Source.LessonID) || !validText(card.Source.SentenceID) {
			return false
		}
		if card.Source.Word == nil || !validCardWord(*card.Source.Word) {
			return false
		}
		if card.ID != cardID(card.Source.LessonID, card.Source.SentenceID, *card.Source.Word) {
			return false
		}
		if _, exists := cardIDs[card.ID]; exists {
			return false
		}
		cardIDs[card.ID] = struct{}{}
		if !validFSRS(card.Fsrs) {
			return false
		}
		if _, err := storage.ParseTimestamp(card.UpdatedAt); err != nil {
			return false
		}
		if !card.DeletedAt.Present {
			return false
		}
		if card.DeletedAt.Value != nil {
			if _, err := storage.ParseTimestamp(*card.DeletedAt.Value); err != nil {
				return false
			}
		}
	}

	for _, practiceDay := range state.PracticeDays {
		date, err := time.Parse("2006-01-02", practiceDay.Date)
		if err != nil || date.Year() < 1 || date.Format("2006-01-02") != practiceDay.Date {
			return false
		}
	}
	for _, completion := range state.LessonCompletion {
		if !validText(completion.LessonID) {
			return false
		}
	}
	return true
}

var cardWordPattern = regexp.MustCompile(`^[a-z0-9]+$`)

func validCardWord(word string) bool {
	return word == "" || cardWordPattern.MatchString(word)
}

func cardID(lessonID, sentenceID, word string) string {
	if word == "" {
		return lessonID + ":" + sentenceID
	}
	return lessonID + ":" + sentenceID + ":" + word
}

func validText(value string) bool {
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
	if _, err := storage.ParseTimestamp(due); err != nil {
		return false
	}
	if _, err := storage.FSRSLastReview(raw); err != nil {
		return false
	}
	return true
}

func writeUser(w http.ResponseWriter, user storage.User) {
	writeJSON(w, http.StatusOK, map[string]string{"id": user.ID, "email": user.Email})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, repo *storage.Repository, userID string) bool {
	rawToken, tokenHash := auth.NewSessionToken()
	expiresAt := time.Now().Add(auth.SessionTTL)
	if err := repo.CreateSession(r.Context(), userID, tokenHash, expiresAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return false
	}
	writeSessionCookie(w, rawToken, expiresAt, auth.SessionTTL)
	return true
}

func writeSessionCookie(w http.ResponseWriter, rawToken string, expiresAt time.Time, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    rawToken,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(maxAge / time.Second),
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	})
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
		session, err := repo.GetSession(r.Context(), auth.HashSessionToken(cookie.Value))
		if err != nil {
			if errors.Is(err, storage.ErrSessionInvalid) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			return
		}
		if session.Extended {
			writeSessionCookie(w, cookie.Value, session.ExpiresAt, time.Until(session.ExpiresAt))
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDContextKey, session.UserID)))
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func corsMiddleware(next http.Handler, configuredOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func newServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
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
