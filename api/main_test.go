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

func TestBadInputSignup(t *testing.T) {
	api := newTestAPI(t)
	missingEmail := doJSON(api.handler, http.MethodPost, "/signup", `{"password":"password"}`)
	if missingEmail.Code != http.StatusBadRequest {
		t.Fatalf("missing email status = %d, want 400", missingEmail.Code)
	}
	tooLong := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"long@example.com","password":"`+strings.Repeat("a", 73)+`"}`)
	if tooLong.Code != http.StatusBadRequest {
		t.Fatalf("long password status = %d, want 400", tooLong.Code)
	}
}

func doJSON(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
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
