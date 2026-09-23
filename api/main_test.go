package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/road-to-english/api/internal/auth"
	"github.com/road-to-english/api/internal/library"
	"github.com/road-to-english/api/internal/storage"
)

type testAPI struct {
	handler http.Handler
	repo    *storage.Repository
	pool    *pgxpool.Pool
}

func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Fatal("DATABASE_URL must be set to a local Postgres for API tests; run: docker compose -f api/compose.yaml up -d --wait")
	}
	repo, err := storage.Open(context.Background(), dsn)
	if err != nil {
		t.Fatalf("storage.Open() error = %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		repo.Close()
		t.Fatalf("pgxpool.New() error = %v", err)
	}
	lockConn, err := pool.Acquire(context.Background())
	if err != nil {
		pool.Close()
		repo.Close()
		t.Fatalf("acquire test database lock: %v", err)
	}
	if _, err := lockConn.Exec(context.Background(), `SELECT pg_advisory_lock(hashtextextended('road-to-english-api-tests', 0))`); err != nil {
		lockConn.Release()
		pool.Close()
		repo.Close()
		t.Fatalf("lock test database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtextextended('road-to-english-api-tests', 0))`)
		lockConn.Release()
		pool.Close()
		repo.Close()
	})
	if _, err := pool.Exec(context.Background(), "TRUNCATE users, sessions, cards, practice_days, lesson_completion RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
	store, err := library.LoadSeed()
	if err != nil {
		t.Fatalf("library.LoadSeed() error = %v", err)
	}
	return &testAPI{
		handler: corsMiddleware(jsonResponseMiddleware(newMux(store, repo)), defaultCORSOrigin),
		repo:    repo,
		pool:    pool,
	}
}

func TestNewServerTimeouts(t *testing.T) {
	server := newServer(":8080", http.NotFoundHandler())
	if server.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("ReadHeaderTimeout = %v, want %v", server.ReadHeaderTimeout, 5*time.Second)
	}
	if server.ReadTimeout != 30*time.Second {
		t.Fatalf("ReadTimeout = %v, want %v", server.ReadTimeout, 30*time.Second)
	}
	if server.WriteTimeout != 30*time.Second {
		t.Fatalf("WriteTimeout = %v, want %v", server.WriteTimeout, 30*time.Second)
	}
	if server.IdleTimeout != 120*time.Second {
		t.Fatalf("IdleTimeout = %v, want %v", server.IdleTimeout, 120*time.Second)
	}
}

func TestHealthzHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recorder := httptest.NewRecorder()

	healthzHandler(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %q", contentType)
	}
	if body := recorder.Body.String(); body != "{\"status\":\"ok\"}\n" {
		t.Fatalf("expected JSON body %q, got %q", "{\"status\":\"ok\"}\n", body)
	}
}

func TestMuxLibraryEndpoints(t *testing.T) {
	api := newTestAPI(t)
	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantBody   string
	}{
		{name: "lesson summaries", method: http.MethodGet, path: "/lessons", wantStatus: http.StatusOK},
		{name: "fixture lesson", method: http.MethodGet, path: "/lessons/greetings-basics", wantStatus: http.StatusOK},
		{name: "unknown lesson", method: http.MethodGet, path: "/lessons/does-not-exist", wantStatus: http.StatusNotFound, wantBody: `{"error":"not found"}`},
		{name: "wrong method collection", method: http.MethodPost, path: "/lessons", wantStatus: http.StatusMethodNotAllowed},
		{name: "wrong method item", method: http.MethodPost, path: "/lessons/greetings-basics", wantStatus: http.StatusMethodNotAllowed},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			req.Header.Set("Origin", defaultCORSOrigin)
			recorder := httptest.NewRecorder()
			api.handler.ServeHTTP(recorder, req)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			if contentType := recorder.Header().Get("Content-Type"); contentType != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", contentType)
			}
			if test.wantBody != "" && compactJSON(t, recorder.Body.Bytes()) != test.wantBody {
				t.Fatalf("body = %s, want %s", recorder.Body.String(), test.wantBody)
			}
		})
	}
}

func TestSignupAndMe(t *testing.T) {
	api := newTestAPI(t)
	signup := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"signup@example.com","password":"correct horse"}`)
	if signup.Code != http.StatusOK {
		t.Fatalf("signup status = %d, body = %s", signup.Code, signup.Body.String())
	}
	cookie := responseCookie(t, signup)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Secure || cookie.MaxAge <= 0 {
		t.Fatalf("session cookie attributes = %#v", cookie)
	}
	var user map[string]string
	decodeJSON(t, signup, &user)
	if user["email"] != "signup@example.com" || user["id"] == "" {
		t.Fatalf("signup user = %#v", user)
	}

	me := httptest.NewRequest(http.MethodGet, "/me", nil)
	me.AddCookie(cookie)
	meResponse := httptest.NewRecorder()
	api.handler.ServeHTTP(meResponse, me)
	if meResponse.Code != http.StatusOK {
		t.Fatalf("authenticated /me status = %d, body = %s", meResponse.Code, meResponse.Body.String())
	}
	var meUser map[string]string
	decodeJSON(t, meResponse, &meUser)
	if meUser["id"] != user["id"] || meUser["email"] != user["email"] {
		t.Fatalf("/me user = %#v, signup user = %#v", meUser, user)
	}

	unauthenticated := httptest.NewRequest(http.MethodGet, "/me", nil)
	unauthenticatedResponse := httptest.NewRecorder()
	api.handler.ServeHTTP(unauthenticatedResponse, unauthenticated)
	if unauthenticatedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /me status = %d, want 401", unauthenticatedResponse.Code)
	}
}

func TestLoginFailuresAndDuplicateSignup(t *testing.T) {
	api := newTestAPI(t)
	first := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"login@example.com","password":"correct password"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("initial signup status = %d, body = %s", first.Code, first.Body.String())
	}
	duplicate := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"login@example.com","password":"another password"}`)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate signup status = %d, want 409", duplicate.Code)
	}

	login := doJSON(api.handler, http.MethodPost, "/login", `{"email":"login@example.com","password":"correct password"}`)
	if login.Code != http.StatusOK || responseCookie(t, login).Value == "" {
		t.Fatalf("login status = %d, body = %s", login.Code, login.Body.String())
	}
	wrong := doJSON(api.handler, http.MethodPost, "/login", `{"email":"login@example.com","password":"wrong password"}`)
	unknown := doJSON(api.handler, http.MethodPost, "/login", `{"email":"missing@example.com","password":"wrong password"}`)
	if wrong.Code != http.StatusUnauthorized || unknown.Code != http.StatusUnauthorized {
		t.Fatalf("wrong status = %d, unknown status = %d", wrong.Code, unknown.Code)
	}
	if compactJSON(t, wrong.Body.Bytes()) != compactJSON(t, unknown.Body.Bytes()) {
		t.Fatalf("login failure bodies differ: wrong=%s unknown=%s", wrong.Body.String(), unknown.Body.String())
	}
}

func TestEmailNormalizationAcrossAuthEndpoints(t *testing.T) {
	api := newTestAPI(t)
	signup := doJSON(api.handler, http.MethodPost, "/signup", `{"email":" A@X.com ","password":"password"}`)
	if signup.Code != http.StatusOK {
		t.Fatalf("signup status = %d, body = %s", signup.Code, signup.Body.String())
	}
	var signupUser map[string]string
	decodeJSON(t, signup, &signupUser)
	if signupUser["email"] != "a@x.com" {
		t.Fatalf("signup email = %q, want normalized email", signupUser["email"])
	}
	cookie := responseCookie(t, signup)

	meRequest := httptest.NewRequest(http.MethodGet, "/me", nil)
	meRequest.AddCookie(cookie)
	meResponse := httptest.NewRecorder()
	api.handler.ServeHTTP(meResponse, meRequest)
	var meUser map[string]string
	decodeJSON(t, meResponse, &meUser)
	if meResponse.Code != http.StatusOK || meUser["email"] != "a@x.com" {
		t.Fatalf("/me status = %d, email = %q, want normalized email", meResponse.Code, meUser["email"])
	}

	duplicate := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"a@x.com","password":"another password"}`)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate signup status = %d, want 409", duplicate.Code)
	}

	login := doJSON(api.handler, http.MethodPost, "/login", `{"email":" A@X.COM ","password":"password"}`)
	if login.Code != http.StatusOK {
		t.Fatalf("normalized login status = %d, body = %s", login.Code, login.Body.String())
	}
	var loginUser map[string]string
	decodeJSON(t, login, &loginUser)
	if loginUser["email"] != "a@x.com" {
		t.Fatalf("login email = %q, want normalized email", loginUser["email"])
	}
}

func TestSignupRejectsWhitespaceOnlyEmail(t *testing.T) {
	api := newTestAPI(t)
	response := doJSON(api.handler, http.MethodPost, "/signup", `{"email":" \t ","password":"password"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"invalid email"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestSignupPasswordPolicy(t *testing.T) {
	api := newTestAPI(t)
	short := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"short@example.com","password":"1234567"}`)
	if short.Code != http.StatusBadRequest || compactJSON(t, short.Body.Bytes()) != `{"error":"password too short"}` {
		t.Fatalf("short password status = %d, body = %s", short.Code, short.Body.String())
	}

	exact := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"exact@example.com","password":"12345678"}`)
	if exact.Code != http.StatusOK {
		t.Fatalf("exact minimum status = %d, body = %s", exact.Code, exact.Body.String())
	}

	multibyte := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"multibyte@example.com","password":"éééééééé"}`)
	if multibyte.Code != http.StatusOK {
		t.Fatalf("multibyte password status = %d, body = %s", multibyte.Code, multibyte.Body.String())
	}

	tooLong := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"too-long@example.com","password":"`+strings.Repeat("a", 73)+`"}`)
	if tooLong.Code != http.StatusBadRequest || compactJSON(t, tooLong.Body.Bytes()) != `{"error":"password too long"}` {
		t.Fatalf("long password status = %d, body = %s", tooLong.Code, tooLong.Body.String())
	}
}

func TestLoginDoesNotApplySignupPasswordMinimum(t *testing.T) {
	api := newTestAPI(t)
	response := doJSON(api.handler, http.MethodPost, "/login", `{"email":"missing@example.com","password":"short"}`)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body = %s", response.Code, response.Body.String())
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"invalid email or password"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestLogoutClearsSession(t *testing.T) {
	api := newTestAPI(t)
	signup := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"logout@example.com","password":"password"}`)
	cookie := responseCookie(t, signup)
	logoutRequest := httptest.NewRequest(http.MethodPost, "/logout", nil)
	logoutRequest.AddCookie(cookie)
	logoutResponse := httptest.NewRecorder()
	api.handler.ServeHTTP(logoutResponse, logoutRequest)
	if logoutResponse.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204", logoutResponse.Code)
	}
	cleared := responseCookie(t, logoutResponse)
	if cleared.MaxAge != -1 || cleared.Value != "" {
		t.Fatalf("cleared cookie = %#v", cleared)
	}

	meRequest := httptest.NewRequest(http.MethodGet, "/me", nil)
	meRequest.AddCookie(cookie)
	meResponse := httptest.NewRecorder()
	api.handler.ServeHTTP(meResponse, meRequest)
	if meResponse.Code != http.StatusUnauthorized {
		t.Fatalf("/me after logout status = %d, want 401", meResponse.Code)
	}
}

func TestCORSPreflight(t *testing.T) {
	api := newTestAPI(t)
	req := httptest.NewRequest(http.MethodOptions, "/login", nil)
	req.Header.Set("Origin", defaultCORSOrigin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "Content-Type")
	recorder := httptest.NewRecorder()

	api.handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != defaultCORSOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, defaultCORSOrigin)
	}
	if got := recorder.Header().Get("Content-Type"); got != "" {
		t.Fatalf("Content-Type = %q, want absent", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods = %q, want %q", got, "GET, POST, OPTIONS")
	}
	if got := recorder.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type" {
		t.Fatalf("Access-Control-Allow-Headers = %q, want Content-Type", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Access-Control-Allow-Credentials = %q, want true", got)
	}
}

func TestCORSPreflightSync(t *testing.T) {
	api := newTestAPI(t)
	req := httptest.NewRequest(http.MethodOptions, "/sync", nil)
	req.Header.Set("Origin", defaultCORSOrigin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "Content-Type")
	recorder := httptest.NewRecorder()

	api.handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != defaultCORSOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, defaultCORSOrigin)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods = %q, want %q", got, "GET, POST, OPTIONS")
	}
	if got := recorder.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type" {
		t.Fatalf("Access-Control-Allow-Headers = %q, want Content-Type", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Access-Control-Allow-Credentials = %q, want true", got)
	}
}

func TestSignupRequiresJSONContentType(t *testing.T) {
	api := newTestAPI(t)
	req := httptest.NewRequest(http.MethodPost, "/signup", strings.NewReader(`{"email":"missing-header@example.com","password":"password"}`))
	recorder := httptest.NewRecorder()
	api.handler.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnsupportedMediaType)
	}
	if compactJSON(t, recorder.Body.Bytes()) != `{"error":"unsupported media type"}` {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}

func TestSignupRejectsNULEmail(t *testing.T) {
	api := newTestAPI(t)
	response := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"bad\u0000email@example.com","password":"password"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"invalid email"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestSignupRejectsTrailingJSON(t *testing.T) {
	api := newTestAPI(t)
	response := doJSON(api.handler, http.MethodPost, "/signup", `{}{}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"invalid credentials"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestBadInputSignup(t *testing.T) {
	api := newTestAPI(t)
	missingEmail := doJSON(api.handler, http.MethodPost, "/signup", `{"password":"password"}`)
	if missingEmail.Code != http.StatusBadRequest {
		t.Fatalf("missing email status = %d, want 400", missingEmail.Code)
	}
	if compactJSON(t, missingEmail.Body.Bytes()) != `{"error":"invalid email"}` {
		t.Fatalf("missing email body = %s", missingEmail.Body.String())
	}
	tooLong := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"long@example.com","password":"`+strings.Repeat("a", 73)+`"}`)
	if tooLong.Code != http.StatusBadRequest {
		t.Fatalf("long password status = %d, want 400", tooLong.Code)
	}
	if compactJSON(t, tooLong.Body.Bytes()) != `{"error":"password too long"}` {
		t.Fatalf("long password body = %s", tooLong.Body.String())
	}
}

func doJSON(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	return doJSONWithCookie(handler, method, path, body, nil)
}

func doJSONWithCookie(handler http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func syncWithCookie(handler http.Handler, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	return doJSONWithCookie(handler, http.MethodPost, "/sync", body, cookie)
}

func signupForSync(t *testing.T, api *testAPI, email string) *http.Cookie {
	t.Helper()
	signup := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"`+email+`","password":"correct password"}`)
	if signup.Code != http.StatusOK {
		t.Fatalf("signup status = %d, body = %s", signup.Code, signup.Body.String())
	}
	return responseCookie(t, signup)
}

const validSyncState = `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00.000Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"lapses":0,"state":0,"last_review":"2026-09-21T10:00:00.000Z","reps":1}}],"practiceDays":[{"date":"2026-09-22"}],"lessonCompletion":[{"lessonId":"lesson-1"}]}`

func TestSyncRequiresSession(t *testing.T) {
	api := newTestAPI(t)
	response := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestSyncAcceptsNullLastReview(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-null-last-review@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00.000Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":null}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
}

func TestSyncAcceptsEmptyCardBackAndRoundTrips(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-empty-back@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	var state storage.State
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(state.Cards) != 1 || state.Cards[0].Back != "" {
		t.Fatalf("response cards = %#v, want one card with empty back", state.Cards)
	}
}

func TestSyncMergesAndReturnsFullState(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-merge@example.com")

	first := syncWithCookie(api.handler, validSyncState, cookie)
	if first.Code != http.StatusOK {
		t.Fatalf("first sync status = %d, body = %s", first.Code, first.Body.String())
	}
	second := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if second.Code != http.StatusOK {
		t.Fatalf("second sync status = %d, body = %s", second.Code, second.Body.String())
	}
	if compactJSON(t, second.Body.Bytes()) != compactJSON(t, []byte(validSyncState)) {
		t.Fatalf("second sync body = %s, want %s", second.Body.String(), validSyncState)
	}
}

func wordSyncCard(word string) storage.Card {
	card := storage.Card{ID: "lesson-1:sentence-1:" + word, Front: word, Back: "back", Fsrs: json.RawMessage(`{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}`), UpdatedAt: "2026-09-22T10:00:00Z", DeletedAt: storage.DeletedAt{Present: true}}
	card.Source.LessonID = "lesson-1"
	card.Source.SentenceID = "sentence-1"
	card.Source.Word = &word
	return card
}

func TestValidateSyncStateWordCards(t *testing.T) {
	sentence := wordSyncCard("")
	sentence.ID = "lesson-1:sentence-1"
	sentence.Front = "Hello there"
	state := func(card storage.Card) storage.State {
		return storage.State{Cards: []storage.Card{card}, PracticeDays: []storage.PracticeDay{}, LessonCompletion: []storage.LessonCompletion{}}
	}
	if !validateSyncState(state(sentence)) {
		t.Fatal("sentence card rejected")
	}
	if !validateSyncState(state(wordSyncCard("hello42"))) {
		t.Fatal("word card rejected")
	}
	for _, word := range []string{"Hello", "a:b", "don't", "a b"} {
		if validateSyncState(state(wordSyncCard(word))) {
			t.Fatalf("word %q accepted", word)
		}
	}
	mismatch := wordSyncCard("hello")
	mismatch.ID = "lesson-1:sentence-1"
	if validateSyncState(state(mismatch)) {
		t.Fatal("word card with sentence id accepted")
	}
	missing := sentence
	missing.Source.Word = nil
	if validateSyncState(state(missing)) {
		t.Fatal("card without word accepted")
	}
}

func TestValidateSyncStateCardTimestamps(t *testing.T) {
	state := func(card storage.Card) storage.State {
		return storage.State{Cards: []storage.Card{card}, PracticeDays: []storage.PracticeDay{}, LessonCompletion: []storage.LessonCompletion{}}
	}
	deletedAt := "2026-09-23T10:00:00.123Z"
	tombstone := wordSyncCard("hello")
	tombstone.DeletedAt = storage.DeletedAt{Present: true, Value: &deletedAt}
	if !validateSyncState(state(wordSyncCard("hello"))) {
		t.Fatal("live card rejected")
	}
	if !validateSyncState(state(tombstone)) {
		t.Fatal("tombstone card rejected")
	}

	badDeletedAt := "2026-09-23T10:00:00+07:00"
	for name, mutate := range map[string]func(*storage.Card){
		"missing updatedAt": func(card *storage.Card) { card.UpdatedAt = "" },
		"non-UTC updatedAt": func(card *storage.Card) { card.UpdatedAt = "2026-09-22T10:00:00+07:00" },
		"invalid updatedAt": func(card *storage.Card) { card.UpdatedAt = "yesterday" },
		"missing deletedAt": func(card *storage.Card) { card.DeletedAt = storage.DeletedAt{} },
		"non-UTC deletedAt": func(card *storage.Card) { card.DeletedAt = storage.DeletedAt{Present: true, Value: &badDeletedAt} },
	} {
		card := wordSyncCard("hello")
		mutate(&card)
		if validateSyncState(state(card)) {
			t.Fatalf("%s accepted", name)
		}
	}
}

func syncCardsJSON(t *testing.T, api *testAPI, cookie *http.Cookie, cards string) []storage.Card {
	t.Helper()
	response := syncWithCookie(api.handler, `{"cards":[`+cards+`],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("sync status = %d, body = %s", response.Code, response.Body.String())
	}
	var state storage.State
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return state.Cards
}

func TestSyncDeletePropagatesAndUndoWins(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-delete@example.com")
	card := func(updatedAt, deletedAt string, reps int) string {
		return `{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"lapses":0,"state":0,"reps":` + strconv.Itoa(reps) + `},"updatedAt":"` + updatedAt + `","deletedAt":` + deletedAt + `}`
	}
	only := func(cards []storage.Card) storage.Card {
		t.Helper()
		if len(cards) != 1 {
			t.Fatalf("cards = %#v, want one", cards)
		}
		return cards[0]
	}

	// Both devices hold the live card; device A deletes it.
	syncCardsJSON(t, api, cookie, card("2026-09-22T10:00:00Z", "null", 1))
	syncCardsJSON(t, api, cookie, card("2026-09-23T10:00:00Z", `"2026-09-23T10:00:00Z"`, 1))

	// Device B syncs its older live copy: the tombstone survives and is returned.
	got := only(syncCardsJSON(t, api, cookie, card("2026-09-22T10:00:00Z", "null", 1)))
	if got.DeletedAt.Value == nil || *got.DeletedAt.Value != "2026-09-23T10:00:00Z" || got.UpdatedAt != "2026-09-23T10:00:00Z" {
		t.Fatalf("after older live copy = %#v, want the tombstone", got)
	}

	// Device A undoes with a newer updatedAt: the live card wins.
	got = only(syncCardsJSON(t, api, cookie, card("2026-09-24T10:00:00Z", "null", 1)))
	if got.DeletedAt.Value != nil || got.UpdatedAt != "2026-09-24T10:00:00Z" {
		t.Fatalf("after undo = %#v, want live at the undo time", got)
	}

	// Equal updatedAt: the tombstone wins over the live card.
	got = only(syncCardsJSON(t, api, cookie, card("2026-09-24T10:00:00Z", `"2026-09-24T10:00:00Z"`, 1)))
	if got.DeletedAt.Value == nil {
		t.Fatalf("after equal-time tombstone = %#v, want the tombstone", got)
	}
	// ...and an equal-time live copy does not revive it.
	got = only(syncCardsJSON(t, api, cookie, card("2026-09-24T10:00:00Z", "null", 9)))
	if got.DeletedAt.Value == nil || string(got.Fsrs) != `{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"lapses":0,"state":0,"reps":1}` {
		t.Fatalf("after equal-time live copy = %#v, want the tombstone kept", got)
	}
}

func TestSyncRoundTripsWordCard(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-word-card@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"Hello there","back":"","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}},{"id":"lesson-1:sentence-1:hello","front":"hello","back":"Hello there — Xin chào","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"hello"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`
	if first := syncWithCookie(api.handler, body, cookie); first.Code != http.StatusOK {
		t.Fatalf("first sync status = %d, body = %s", first.Code, first.Body.String())
	}
	second := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if second.Code != http.StatusOK {
		t.Fatalf("second sync status = %d, body = %s", second.Code, second.Body.String())
	}
	if compactJSON(t, second.Body.Bytes()) != compactJSON(t, []byte(body)) {
		t.Fatalf("second sync body = %s, want %s", second.Body.String(), body)
	}
}

func TestSyncValidatesCardWord(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-card-word@example.com")
	body := func(word string) string {
		return `{"cards":[{"id":"lesson-1:sentence-1:` + word + `","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"` + word + `"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`
	}
	for word, want := range map[string]int{
		"t-shirt": http.StatusOK,
		"-a":      http.StatusBadRequest,
		"a-":      http.StatusBadRequest,
		"a--b":    http.StatusBadRequest,
		"T-shirt": http.StatusBadRequest,
	} {
		t.Run(word, func(t *testing.T) {
			if got := cardWordPattern.MatchString(word); got != (want == http.StatusOK) {
				t.Fatalf("cardWordPattern.MatchString(%q) = %v", word, got)
			}
			if response := syncWithCookie(api.handler, body(word), cookie); response.Code != want {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, want, response.Body.String())
			}
		})
	}
}

func TestSyncRejectsInvalidState(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-invalid@example.com")
	tests := []struct {
		name string
		body string
	}{
		{name: "bad fsrs due", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"not-a-date","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs due non-UTC offset", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00+20:00","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs due year zero", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"0000-01-01T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing fsrs due", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong fsrs type", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":[] }],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "bad fsrs last review", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"not-a-date"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs last review non-UTC offset", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"2026-09-21T10:00:00+20:00"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs last review year zero", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"0000-01-01T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "invalid calendar day", body: `{"cards":[],"practiceDays":[{"date":"2026-02-30"}],"lessonCompletion":[]}`},
		{name: "practice day year zero", body: `{"cards":[],"practiceDays":[{"date":"0000-01-01"}],"lessonCompletion":[]}`},
		{name: "noncanonical calendar day", body: `{"cards":[],"practiceDays":[{"date":"2026-9-3"}],"lessonCompletion":[]}`},
		{name: "card id mismatch", body: `{"cards":[{"id":"wrong-id","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty card id", body: `{"cards":[{"id":"","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty card front", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card front contains NUL", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"a\u0000b","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card id contains NUL", body: `{"cards":[{"id":"lesson\u0000-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson\u0000-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card back contains NUL", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"a\u0000b","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty source lesson id", body: `{"cards":[{"id":":sentence-1","front":"front","back":"back","source":{"lessonId":"","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty source sentence id", body: `{"cards":[{"id":"lesson-1:","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "duplicate card id", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}},{"id":"lesson-1:sentence-1","front":"front 2","back":"back 2","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing source word", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "uppercase word", body: `{"cards":[{"id":"lesson-1:sentence-1:Hello","front":"Hello","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"Hello"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "word contains colon", body: `{"cards":[{"id":"lesson-1:sentence-1:a:b","front":"a","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"a:b"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "word card id without word", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"hello","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"hello"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty lesson completion id", body: `{"cards":[],"practiceDays":[],"lessonCompletion":[{"lessonId":""}]}`},
		{name: "lesson completion contains NUL", body: `{"cards":[],"practiceDays":[],"lessonCompletion":[{"lessonId":"x\u0000y"}]}`},
		{name: "missing cards array", body: `{"practiceDays":[],"lessonCompletion":[]}`},
		{name: "null cards array", body: `{"cards":null,"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong cards type", body: `{"cards":{},"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing practice days array", body: `{"cards":[],"lessonCompletion":[]}`},
		{name: "null practice days array", body: `{"cards":[],"practiceDays":null,"lessonCompletion":[]}`},
		{name: "missing lesson completion array", body: `{"cards":[],"practiceDays":[]}`},
		{name: "null lesson completion array", body: `{"cards":[],"practiceDays":[],"lessonCompletion":null}`},
		{name: "missing updatedAt", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "null updatedAt", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":null,"deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "invalid updatedAt", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-02-30T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "four-digit fraction updatedAt", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00.1234Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing deletedAt", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "invalid deletedAt", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":"yesterday","fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong deletedAt type", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":1,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "malformed json", body: `{"cards":[],"practiceDays":[],"lessonCompletion":[]`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := syncWithCookie(api.handler, test.body, cookie)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			if compactJSON(t, response.Body.Bytes()) != `{"error":"invalid sync state"}` {
				t.Fatalf("body = %s", response.Body.String())
			}
		})
	}
}

func TestSyncValidatesFSRSFields(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-fsrs-fields@example.com")
	fields := map[string]string{"stability": "2.5", "difficulty": "4.2", "elapsed_days": "1", "scheduled_days": "2", "learning_steps": "0", "reps": "3", "lapses": "0", "state": "2"}
	body := func(key, value string) string {
		parts := []string{`"due":"2026-09-22T10:00:00Z"`}
		for _, name := range []string{"stability", "difficulty", "elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses", "state"} {
			raw := fields[name]
			if name == key {
				if value == "" {
					continue
				}
				raw = value
			}
			parts = append(parts, `"`+name+`":`+raw)
		}
		return `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{` + strings.Join(parts, ",") + `}}],"practiceDays":[],"lessonCompletion":[]}`
	}
	invalid := map[string][]string{
		"stability":      {"", "-0.5", "null", `"1"`, "1e400"},
		"difficulty":     {"", "-1", "null", "true"},
		"elapsed_days":   {"", "-1", "1.5", "null"},
		"scheduled_days": {"", "-1", "0.5", `"2"`},
		"learning_steps": {"", "-1", "1.25", "null"},
		"reps":           {"", "-1", "1.5", "9007199254740992", "null"},
		"lapses":         {"", "-1", "2.5", "[]"},
		"state":          {"", "-1", "4", "1.5", "null"},
	}
	for key, values := range invalid {
		for _, value := range values {
			name := key + " missing"
			if value != "" {
				name = key + " " + value
			}
			t.Run(name, func(t *testing.T) {
				response := syncWithCookie(api.handler, body(key, value), cookie)
				if response.Code != http.StatusBadRequest || compactJSON(t, response.Body.Bytes()) != `{"error":"invalid sync state"}` {
					t.Fatalf("status = %d, body = %s, want 400 invalid sync state", response.Code, response.Body.String())
				}
			})
		}
	}
	if cards := syncCardsJSON(t, api, cookie, ""); len(cards) != 0 {
		t.Fatalf("cards after rejected pushes = %#v, want empty", cards)
	}
	for key, value := range map[string]string{"state": "3", "reps": "9007199254740991", "stability": "0", "difficulty": "10.75"} {
		if response := syncWithCookie(api.handler, body(key, value), cookie); response.Code != http.StatusOK {
			t.Fatalf("%s %s status = %d, body = %s, want 200", key, value, response.Code, response.Body.String())
		}
	}
}

// The stored card is a newer fresh save (reps 0); the incoming card loses by time but carries review history.
func TestSyncLosingCardWithHistoryUpdatesStoredFSRS(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-losing-history@example.com")
	card := func(front, updatedAt, fsrs string) string {
		return `{"id":"lesson-1:sentence-1","front":"` + front + `","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"fsrs":` + fsrs + `,"updatedAt":"` + updatedAt + `","deletedAt":null}`
	}
	const fresh = `{"due":"2026-09-23T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}`
	const reviewed = `{"due":"2026-09-30T10:00:00Z","last_review":"2026-09-22T10:00:00Z","stability":8.3,"difficulty":5.1,"elapsed_days":0,"scheduled_days":8,"learning_steps":0,"reps":2,"lapses":0,"state":2}`
	syncCardsJSON(t, api, cookie, card("stale save", "2026-09-23T10:00:00Z", fresh))

	got := syncCardsJSON(t, api, cookie, card("reviewed", "2026-09-22T10:00:00Z", reviewed))
	if len(got) != 1 || got[0].Front != "stale save" || got[0].UpdatedAt != "2026-09-23T10:00:00Z" || string(got[0].Fsrs) != reviewed {
		t.Fatalf("response cards = %#v, want the newer save carrying the reviewed fsrs", got)
	}
	if again := syncCardsJSON(t, api, cookie, ""); len(again) != 1 || string(again[0].Fsrs) != reviewed {
		t.Fatalf("stored cards = %#v, want the reviewed fsrs kept", again)
	}
}

func TestSyncRejectsYearZeroLastReviewWithoutWriting(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-year-zero-last-review@example.com")
	invalid := `{"cards":[{"id":"lesson-11:sentence-11","front":"front","back":"back","source":{"lessonId":"lesson-11","sentenceId":"sentence-11","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"0000-01-01T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, invalid, cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid sync status = %d, want %d", response.Code, http.StatusBadRequest)
	}

	valid := `{"cards":[{"id":"lesson-11:sentence-11","front":"front","back":"back","source":{"lessonId":"lesson-11","sentenceId":"sentence-11","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"2026-09-21T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`
	response = syncWithCookie(api.handler, valid, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("valid retry status = %d, body = %s", response.Code, response.Body.String())
	}
	var state storage.State
	decodeJSON(t, response, &state)
	if len(state.Cards) != 1 || state.Cards[0].ID != "lesson-11:sentence-11" {
		t.Fatalf("stored cards = %#v, want lesson-11:sentence-11", state.Cards)
	}
}

func TestSyncRejectsInvalidFSRSBytesWithoutWriting(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-invalid-fsrs-bytes@example.com")
	body := []byte(`{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"note":"a`)
	body = append(body, 0xff)
	body = append(body, []byte(`b"}}],"practiceDays":[],"lessonCompletion":[]}`)...)
	response := syncWithCookie(api.handler, string(body), cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}

	empty := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	var state storage.State
	decodeJSON(t, empty, &state)
	if len(state.Cards) != 0 {
		t.Fatalf("cards after invalid fsrs bytes = %#v, want empty", state.Cards)
	}
}

func TestSyncPreservesFSRSUnicodeEscapes(t *testing.T) {
	tests := []struct {
		name string
		note string
	}{
		{name: "nul escape", note: `a\u0000b`},
		{name: "lone surrogate escape", note: `x\ud800y`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := newTestAPI(t)
			cookie := signupForSync(t, api, "sync-"+strings.ReplaceAll(test.name, " ", "-")+"@example.com")
			body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"note":"` + test.note + `"}}],"practiceDays":[],"lessonCompletion":[]}`
			response := syncWithCookie(api.handler, body, cookie)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
			}
			var state storage.State
			decodeJSON(t, response, &state)
			if len(state.Cards) != 1 || string(state.Cards[0].Fsrs) != `{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"note":"`+test.note+`"}` {
				t.Fatalf("fsrs = %q, want raw escape round trip", state.Cards[0].Fsrs)
			}
		})
	}
}

func TestSyncRejectsNULInLastReview(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-nul-last-review@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"2026-09-21T00:00:00Z\u0000"}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestSyncRejectsNonUTCLastReviewWithoutWriting(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-non-utc-last-review@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"2026-09-21T10:00:00+20:00"}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}

	empty := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if empty.Code != http.StatusOK {
		t.Fatalf("empty sync status = %d, body = %s", empty.Code, empty.Body.String())
	}
	var state storage.State
	decodeJSON(t, empty, &state)
	if len(state.Cards) != 0 {
		t.Fatalf("cards after rejected non-UTC push = %#v, want empty", state.Cards)
	}
}

func TestSyncRejectsMissingOrWrongContentType(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-content-type@example.com")
	for _, contentType := range []string{"", "text/plain"} {
		t.Run(map[string]string{"": "missing", "text/plain": "text plain"}[contentType], func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/sync", strings.NewReader(validSyncState))
			req.AddCookie(cookie)
			if contentType != "" {
				req.Header.Set("Content-Type", contentType)
			}
			recorder := httptest.NewRecorder()
			api.handler.ServeHTTP(recorder, req)
			if recorder.Code != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnsupportedMediaType)
			}
			if compactJSON(t, recorder.Body.Bytes()) != `{"error":"unsupported media type"}` {
				t.Fatalf("body = %s", recorder.Body.String())
			}
		})
	}
}

func TestSyncRejectsOversizedBody(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-large@example.com")
	oversizedBody := `{"cards":[],"practiceDays":[],"lessonCompletion":[],"padding":"` + strings.Repeat("x", int(syncBodyMaxBytes)) + `"}`
	response := syncWithCookie(api.handler, oversizedBody, cookie)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusRequestEntityTooLarge)
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"request body too large"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestSyncValidationIsAtomic(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-atomic@example.com")
	invalid := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[{"date":"2026-02-30"}],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, invalid, cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid sync status = %d, want 400", response.Code)
	}

	empty := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if empty.Code != http.StatusOK {
		t.Fatalf("empty sync status = %d, body = %s", empty.Code, empty.Body.String())
	}
	var emptyState storage.State
	decodeJSON(t, empty, &emptyState)
	if len(emptyState.Cards) != 0 || len(emptyState.PracticeDays) != 0 || len(emptyState.LessonCompletion) != 0 {
		t.Fatalf("empty sync state = %#v, want no rows", emptyState)
	}
}

func responseCookie(t *testing.T, recorder *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("response cookies = %#v, want one cookie", cookies)
	}
	return cookies[0]
}

func compactJSON(t *testing.T, body []byte) string {
	t.Helper()
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	compact, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("compact JSON: %v", err)
	}
	return string(compact)
}

func decodeJSON(t *testing.T, recorder *httptest.ResponseRecorder, value any) {
	t.Helper()
	if err := json.NewDecoder(recorder.Body).Decode(value); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
}

func doAuthFrom(handler http.Handler, path, body, remoteAddr string, header http.Header) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	for key, values := range header {
		req.Header[key] = values
	}
	req.RemoteAddr = remoteAddr
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func assertTooManyAttempts(t *testing.T, response *httptest.ResponseRecorder, maxRetryAfter int) {
	t.Helper()
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body = %s", response.Code, response.Body.String())
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"too many attempts"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
	retryAfter, err := strconv.Atoi(response.Header().Get("Retry-After"))
	if err != nil || retryAfter < 1 || retryAfter > maxRetryAfter {
		t.Fatalf("Retry-After = %q, want 1..%d", response.Header().Get("Retry-After"), maxRetryAfter)
	}
}

func TestRequestExtendsSessionCookieOncePer24Hours(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "rolling-cookie@example.com")
	if _, err := api.pool.Exec(context.Background(), `UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() + interval '1 day'`); err != nil {
		t.Fatalf("age session: %v", err)
	}

	first := doJSONWithCookie(api.handler, http.MethodGet, "/me", "", cookie)
	if first.Code != http.StatusOK {
		t.Fatalf("/me status = %d, body = %s", first.Code, first.Body.String())
	}
	refreshed := responseCookie(t, first)
	ttl := int(auth.SessionTTL / time.Second)
	if refreshed.Name != sessionCookieName || refreshed.Value != cookie.Value || refreshed.Path != "/" || !refreshed.HttpOnly || refreshed.Secure || refreshed.SameSite != http.SameSiteLaxMode {
		t.Fatalf("refreshed cookie = %#v", refreshed)
	}
	if refreshed.MaxAge < ttl-60 || refreshed.MaxAge > ttl {
		t.Fatalf("refreshed MaxAge = %d, want about %d", refreshed.MaxAge, ttl)
	}
	var stored time.Time
	if err := api.pool.QueryRow(context.Background(), `SELECT expires_at FROM sessions`).Scan(&stored); err != nil {
		t.Fatalf("query expires_at: %v", err)
	}
	if !refreshed.Expires.Equal(stored.Truncate(time.Second)) {
		t.Fatalf("cookie Expires = %v, stored expires_at = %v", refreshed.Expires, stored)
	}

	second := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if second.Code != http.StatusOK {
		t.Fatalf("/sync status = %d, body = %s", second.Code, second.Body.String())
	}
	if cookies := second.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("second request cookies = %#v, want none", cookies)
	}
}

func TestExpiredOrCappedSessionIsRejected(t *testing.T) {
	api := newTestAPI(t)
	for _, update := range []string{
		`UPDATE sessions SET expires_at = now() - interval '1 second'`,
		`UPDATE sessions SET created_at = now() - interval '91 days', expires_at = now() + interval '1 day'`,
	} {
		cookie := signupForSync(t, api, "rejected-"+strconv.Itoa(len(update))+"@example.com")
		if _, err := api.pool.Exec(context.Background(), update+` WHERE token_hash = $1`, auth.HashSessionToken(cookie.Value)); err != nil {
			t.Fatalf("update session: %v", err)
		}
		if response := doJSONWithCookie(api.handler, http.MethodGet, "/me", "", cookie); response.Code != http.StatusUnauthorized {
			t.Fatalf("%s: /me status = %d, want 401", update, response.Code)
		}
	}
}

func TestAuthLimiterPerIP(t *testing.T) {
	api := newTestAPI(t)
	for i := 0; i < ipAttemptLimit; i++ {
		path := "/login"
		if i%2 == 0 {
			path = "/signup"
		}
		if response := doAuthFrom(api.handler, path, `{}`, "198.51.100.7:"+strconv.Itoa(1000+i), nil); response.Code != http.StatusBadRequest {
			t.Fatalf("request %d status = %d, want 400", i, response.Code)
		}
	}
	spoofed := http.Header{"X-Forwarded-For": {"203.0.113.9"}}
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{}`, "198.51.100.7:2000", spoofed), 60)

	blockedSignup := doAuthFrom(api.handler, "/signup", `{"email":"blocked@example.com","password":"correct password"}`, "198.51.100.7:2001", nil)
	assertTooManyAttempts(t, blockedSignup, 60)
	var users int
	if err := api.pool.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&users); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if users != 0 {
		t.Fatalf("users = %d, want 0: a limited signup must not hash or insert", users)
	}

	if response := doAuthFrom(api.handler, "/login", `{}`, "198.51.100.8:1000", nil); response.Code != http.StatusBadRequest {
		t.Fatalf("other IP status = %d, want 400", response.Code)
	}
}

func TestAuthLimiterKeysIPv6By64(t *testing.T) {
	limiter := newAuthLimiter()
	allow := func(remoteAddr string) bool {
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		req.RemoteAddr = remoteAddr
		return limiter.allowIP(httptest.NewRecorder(), req)
	}
	for i := 0; i < ipAttemptLimit; i++ {
		if !allow("[2001:db8:1:2::" + strconv.FormatInt(int64(i+1), 16) + "]:1000") {
			t.Fatalf("IPv6 request %d refused", i)
		}
	}
	if allow("[2001:db8:1:2:ffff:ffff:ffff:ffff]:1000") {
		t.Fatal("another address in the same /64 was allowed past the limit")
	}
	if !allow("[2001:db8:1:3::1]:1000") {
		t.Fatal("an address in a different /64 was refused")
	}
	for i := 0; i < ipAttemptLimit; i++ {
		if !allow("198.51.100.7:1000") {
			t.Fatalf("IPv4 request %d refused", i)
		}
	}
	if allow("198.51.100.7:1001") {
		t.Fatal("IPv4 address allowed past the limit")
	}
	if !allow("198.51.100.8:1000") {
		t.Fatal("a different IPv4 address was refused")
	}
}

func TestAuthLimiterPerAccountChecksBeforePassword(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "locked@example.com")
	for i := 0; i < loginFailureLimit; i++ {
		if response := doJSON(api.handler, http.MethodPost, "/login", `{"email":" LOCKED@example.com ","password":"wrong password"}`); response.Code != http.StatusUnauthorized {
			t.Fatalf("failure %d status = %d, want 401", i, response.Code)
		}
	}
	// The correct password would succeed, so a 429 proves the limit runs before password verification.
	assertTooManyAttempts(t, doJSON(api.handler, http.MethodPost, "/login", `{"email":"locked@example.com","password":"correct password"}`), 900)

	signupForSync(t, api, "other@example.com")
	if response := doJSON(api.handler, http.MethodPost, "/login", `{"email":"other@example.com","password":"correct password"}`); response.Code != http.StatusOK {
		t.Fatalf("other account status = %d, want 200", response.Code)
	}
}

func TestSuccessfulLoginClearsAccountFailures(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "clears@example.com")
	login := func(i int, password string) int {
		return doAuthFrom(api.handler, "/login", `{"email":"clears@example.com","password":"`+password+`"}`, "198.51.100.10:"+strconv.Itoa(1000+i), nil).Code
	}
	for i := 0; i < loginFailureLimit-1; i++ {
		if code := login(i, "wrong password"); code != http.StatusUnauthorized {
			t.Fatalf("failure %d status = %d, want 401", i, code)
		}
	}
	if code := login(20, "correct password"); code != http.StatusOK {
		t.Fatalf("login status = %d, want 200", code)
	}
	for i := 0; i < loginFailureLimit-1; i++ {
		if code := login(30+i, "wrong password"); code != http.StatusUnauthorized {
			t.Fatalf("failure after success %d status = %d, want 401", i, code)
		}
	}
	if code := login(50, "correct password"); code != http.StatusOK {
		t.Fatalf("login after cleared failures status = %d, want 200", code)
	}
}

func TestAuthLimiterPerAccountHoldsUnderConcurrentFailures(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "burst@example.com")
	const attempts = 2 * loginFailureLimit
	codes := make([]int, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"wrong password"}`, "198.51.100.7:"+strconv.Itoa(1000+i), nil).Code
		}(i)
	}
	wg.Wait()
	unauthorized, limited := 0, 0
	for i, code := range codes {
		switch code {
		case http.StatusUnauthorized:
			unauthorized++
		case http.StatusTooManyRequests:
			limited++
		default:
			t.Fatalf("attempt %d status = %d, want 401 or 429", i, code)
		}
	}
	if unauthorized != loginFailureLimit || limited != attempts-loginFailureLimit {
		t.Fatalf("401s = %d, 429s = %d; want %d and %d", unauthorized, limited, loginFailureLimit, attempts-loginFailureLimit)
	}

	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"correct password"}`, "198.51.100.7:2000", nil), 900)
	if code := doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"wrong password"}`, "198.51.100.8:1000", nil).Code; code != http.StatusUnauthorized {
		t.Fatalf("other IP key wrong password status = %d, want 401", code)
	}
	if code := doAuthFrom(api.handler, "/login", `{"email":"burst@example.com","password":"correct password"}`, "198.51.100.9:1000", nil).Code; code != http.StatusOK {
		t.Fatalf("fresh IP key correct password status = %d, want 200", code)
	}
}

func TestAuthLimiterPerAccountCapAcrossIPKeys(t *testing.T) {
	api := newTestAPI(t)
	signupForSync(t, api, "cap@example.com")
	wrong := `{"email":"cap@example.com","password":"wrong password"}`
	ips := accountFailureCap / loginFailureLimit
	for ip := 0; ip < ips; ip++ {
		for i := 0; i < loginFailureLimit; i++ {
			if code := doAuthFrom(api.handler, "/login", wrong, "198.51.100."+strconv.Itoa(10+ip)+":"+strconv.Itoa(1000+i), nil).Code; code != http.StatusUnauthorized {
				t.Fatalf("IP %d failure %d status = %d, want 401", ip, i, code)
			}
		}
	}
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", wrong, "203.0.113.1:1000", nil), 900)
	assertTooManyAttempts(t, doAuthFrom(api.handler, "/login", `{"email":"cap@example.com","password":"correct password"}`, "203.0.113.2:1000", nil), 900)
	if code := doAuthFrom(api.handler, "/login", `{"email":"other-cap@example.com","password":"wrong password"}`, "203.0.113.3:1000", nil).Code; code != http.StatusUnauthorized {
		t.Fatalf("other account status = %d, want 401", code)
	}
}

func TestAuthLimiterSuccessReturnsOnlyItsAccountSlot(t *testing.T) {
	limiter := newAuthLimiter()
	from := func(remoteAddr string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		req.RemoteAddr = remoteAddr
		return req
	}
	allow := func(req *http.Request) (*limitWindow, bool) {
		return limiter.allowAccount(httptest.NewRecorder(), req, "a@example.com")
	}
	for i := 0; i < accountFailureCap-1; i++ {
		if _, ok := allow(from("198.51.100." + strconv.Itoa(i/loginFailureLimit) + ":1000")); !ok {
			t.Fatalf("attempt %d refused", i)
		}
	}
	owner := from("203.0.113.1:1000")
	reserved, ok := allow(owner)
	if !ok {
		t.Fatal("owner's attempt refused below the cap")
	}
	limiter.clearFailures(owner, "a@example.com", reserved)
	if got := limiter.accounts["a@example.com"].count; got != accountFailureCap-1 {
		t.Fatalf("account count after success = %d, want %d", got, accountFailureCap-1)
	}
	if _, ok := allow(owner); !ok {
		t.Fatal("owner refused after a success returned its slot")
	}
	if _, ok := allow(from("203.0.113.2:1000")); ok {
		t.Fatal("attempt allowed past the account cap")
	}
}

func TestAuthLimiterFailsOpenWhenMapsAreFull(t *testing.T) {
	limiter := newAuthLimiter()
	fill := func(windows map[string]*limitWindow) {
		for i := 0; i < limiterMaxEntries; i++ {
			windows["filler-"+strconv.Itoa(i)] = &limitWindow{start: time.Now(), count: 1}
		}
	}
	fill(limiter.pairs)
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.RemoteAddr = "203.0.113.1:1000"
	recorder := httptest.NewRecorder()
	reserved, ok := limiter.allowAccount(recorder, req, "fresh@example.com")
	if !ok {
		t.Fatalf("login refused with a full pair map: status %d", recorder.Code)
	}
	if reserved == nil || reserved.count != 1 {
		t.Fatalf("account reservation = %#v, want count 1", reserved)
	}
	limiter.clearFailures(req, "fresh@example.com", reserved)
	if reserved.count != 0 {
		t.Fatalf("account count after success = %d, want 0", reserved.count)
	}

	fill(limiter.accounts)
	other := limiter.accounts["filler-0"]
	reserved, ok = limiter.allowAccount(httptest.NewRecorder(), req, "second@example.com")
	if !ok || reserved != nil {
		t.Fatalf("full account map: allowed = %v, reservation = %#v; want allowed with no reservation", ok, reserved)
	}
	limiter.clearFailures(req, "second@example.com", reserved)
	if other.count != 1 {
		t.Fatalf("an unrecorded reservation changed another account: count %d", other.count)
	}
}

func TestAuthLimiterSuccessDoesNotReturnASlotFromAnExpiredWindow(t *testing.T) {
	limiter := newAuthLimiter()
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	req.RemoteAddr = "203.0.113.1:1000"
	stale, ok := limiter.allowAccount(httptest.NewRecorder(), req, "a@example.com")
	if !ok {
		t.Fatal("first attempt refused")
	}
	stale.start = time.Now().Add(-loginFailureWindow)
	other := httptest.NewRequest(http.MethodPost, "/login", nil)
	other.RemoteAddr = "203.0.113.2:1000"
	fresh, ok := limiter.allowAccount(httptest.NewRecorder(), other, "a@example.com")
	if !ok || fresh == stale {
		t.Fatal("second attempt did not start a new account window")
	}
	limiter.clearFailures(req, "a@example.com", stale)
	if fresh.count != 1 {
		t.Fatalf("new window count = %d, want 1: a stale reservation was returned to it", fresh.count)
	}
}
