package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
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

const validSyncState = `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00.000Z","last_review":"2026-09-21T10:00:00.000Z","reps":1}}],"practiceDays":[{"date":"2026-09-22"}],"lessonCompletion":[{"lessonId":"lesson-1"}]}`

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
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00.000Z","last_review":null}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
}

func TestSyncAcceptsEmptyCardBackAndRoundTrips(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-empty-back@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`
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

func TestSyncRejectsInvalidState(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-invalid@example.com")
	tests := []struct {
		name string
		body string
	}{
		{name: "bad fsrs due", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"not-a-date"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs due non-UTC offset", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00+20:00"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs due year zero", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"0000-01-01T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing fsrs due", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong fsrs type", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":[] }],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "bad fsrs last review", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z","last_review":"not-a-date"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs last review non-UTC offset", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z","last_review":"2026-09-21T10:00:00+20:00"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs last review year zero", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z","last_review":"0000-01-01T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "invalid calendar day", body: `{"cards":[],"practiceDays":[{"date":"2026-02-30"}],"lessonCompletion":[]}`},
		{name: "practice day year zero", body: `{"cards":[],"practiceDays":[{"date":"0000-01-01"}],"lessonCompletion":[]}`},
		{name: "noncanonical calendar day", body: `{"cards":[],"practiceDays":[{"date":"2026-9-3"}],"lessonCompletion":[]}`},
		{name: "card id mismatch", body: `{"cards":[{"id":"wrong-id","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty card id", body: `{"cards":[{"id":"","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty card front", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card front contains NUL", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"a\u0000b","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card id contains NUL", body: `{"cards":[{"id":"lesson\u0000-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson\u0000-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card back contains NUL", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"a\u0000b","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty source lesson id", body: `{"cards":[{"id":":sentence-1","front":"front","back":"back","source":{"lessonId":"","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty source sentence id", body: `{"cards":[{"id":"lesson-1:","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":""},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "duplicate card id", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}},{"id":"lesson-1:sentence-1","front":"front 2","back":"back 2","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty lesson completion id", body: `{"cards":[],"practiceDays":[],"lessonCompletion":[{"lessonId":""}]}`},
		{name: "lesson completion contains NUL", body: `{"cards":[],"practiceDays":[],"lessonCompletion":[{"lessonId":"x\u0000y"}]}`},
		{name: "missing cards array", body: `{"practiceDays":[],"lessonCompletion":[]}`},
		{name: "null cards array", body: `{"cards":null,"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong cards type", body: `{"cards":{},"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing practice days array", body: `{"cards":[],"lessonCompletion":[]}`},
		{name: "null practice days array", body: `{"cards":[],"practiceDays":null,"lessonCompletion":[]}`},
		{name: "missing lesson completion array", body: `{"cards":[],"practiceDays":[]}`},
		{name: "null lesson completion array", body: `{"cards":[],"practiceDays":[],"lessonCompletion":null}`},
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

func TestSyncRejectsYearZeroLastReviewWithoutWriting(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-year-zero-last-review@example.com")
	invalid := `{"cards":[{"id":"lesson-11:sentence-11","front":"front","back":"back","source":{"lessonId":"lesson-11","sentenceId":"sentence-11"},"fsrs":{"due":"2026-09-22T00:00:00Z","last_review":"0000-01-01T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, invalid, cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid sync status = %d, want %d", response.Code, http.StatusBadRequest)
	}

	valid := `{"cards":[{"id":"lesson-11:sentence-11","front":"front","back":"back","source":{"lessonId":"lesson-11","sentenceId":"sentence-11"},"fsrs":{"due":"2026-09-22T00:00:00Z","last_review":"2026-09-21T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`
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
	body := []byte(`{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T00:00:00Z","note":"a`)
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
			body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T00:00:00Z","note":"` + test.note + `"}}],"practiceDays":[],"lessonCompletion":[]}`
			response := syncWithCookie(api.handler, body, cookie)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
			}
			var state storage.State
			decodeJSON(t, response, &state)
			if len(state.Cards) != 1 || string(state.Cards[0].Fsrs) != `{"due":"2026-09-22T00:00:00Z","note":"`+test.note+`"}` {
				t.Fatalf("fsrs = %q, want raw escape round trip", state.Cards[0].Fsrs)
			}
		})
	}
}

func TestSyncRejectsNULInLastReview(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-nul-last-review@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T00:00:00Z","last_review":"2026-09-21T00:00:00Z\u0000"}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestSyncRejectsNonUTCLastReviewWithoutWriting(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-non-utc-last-review@example.com")
	body := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z","last_review":"2026-09-21T10:00:00+20:00"}}],"practiceDays":[],"lessonCompletion":[]}`
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
	invalid := `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"fsrs":{"due":"2026-09-22T10:00:00Z"}}],"practiceDays":[{"date":"2026-02-30"}],"lessonCompletion":[]}`
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
