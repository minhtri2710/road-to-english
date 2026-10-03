package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/road-to-english/api/internal/auth"
	"github.com/road-to-english/api/internal/library"
	"github.com/road-to-english/api/internal/storage"
	"github.com/road-to-english/api/internal/testdb"
)

type testAPI struct {
	handler http.Handler
	pool    *pgxpool.Pool
	repo    *storage.Repository
}

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func newTestClock(now time.Time) *testClock {
	return &testClock{now: now}
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func newTestAPI(t *testing.T) *testAPI {
	return newTestAPIWithClock(t, newTestClock(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)))
}

func newTestAPIWithClock(t *testing.T, clock *testClock) *testAPI {
	t.Helper()
	var repo *storage.Repository
	pool := testdb.Open(t, func(dsn string) {
		var err error
		if repo, err = storage.Open(context.Background(), dsn); err != nil {
			t.Fatalf("storage.Open() error = %v", err)
		}
		t.Cleanup(repo.Close)
	})
	store, err := library.LoadSeed()
	if err != nil {
		t.Fatalf("library.LoadSeed() error = %v", err)
	}
	return &testAPI{
		handler: corsMiddleware(jsonResponseMiddleware(newMux(store, repo, clock.Now)), defaultCORSOrigin),
		pool:    pool,
		repo:    repo,
	}
}

func TestNewServerTimeouts(t *testing.T) {
	server := newServer(":8080", http.NotFoundHandler())
	if server.ReadHeaderTimeout <= 0 || server.ReadTimeout <= 0 || server.WriteTimeout <= 0 || server.IdleTimeout <= 0 {
		t.Fatalf("server timeouts must be positive: %#v", server)
	}
	if requestTimeout >= server.WriteTimeout {
		t.Fatalf("requestTimeout = %v, want below WriteTimeout %v", requestTimeout, server.WriteTimeout)
	}

	var ctx context.Context
	var deadline time.Time
	var hasDeadline bool
	probe := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		ctx = r.Context()
		deadline, hasDeadline = ctx.Deadline()
	})
	before := time.Now()
	newServer(":8080", probe).Handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	if !hasDeadline || deadline.After(time.Now().Add(requestTimeout)) || deadline.Before(before.Add(requestTimeout)) {
		t.Fatalf("deadline = %v (set %v), want about now + %v", deadline, hasDeadline, requestTimeout)
	}
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("context error after handler = %v, want context.Canceled", ctx.Err())
	}
}

// A sync with a canceled context reaches SyncState, returns 500, and writes nothing.
func TestSyncPastRequestDeadlineWritesNothing(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-deadline@example.com")
	deadContextSync := authMiddleware(api.repo, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithCancel(r.Context())
		cancel()
		syncHandler(w, r.WithContext(ctx), api.repo)
	}))

	expired := doJSONWithCookie(deadContextSync, http.MethodPost, "/sync", validSyncState, cookie)
	if expired.Code != http.StatusInternalServerError || compactJSON(t, expired.Body.Bytes()) != `{"error":"internal server error"}` {
		t.Fatalf("expired sync = %d %s, want 500 internal server error", expired.Code, expired.Body.String())
	}
	empty := `{"cards":[],"practiceDays":[],"lessonCompletion":[],"learnProgress":[]}`
	later := syncWithCookie(api.handler, empty, cookie)
	if later.Code != http.StatusOK {
		t.Fatalf("later sync = %d %s, want empty state", later.Code, later.Body.String())
	}
	if state, _ := stateJSON(t, later.Body.Bytes()); state != compactJSON(t, []byte(empty)) {
		t.Fatalf("later sync = %d %s, want empty state", later.Code, later.Body.String())
	}

	failedLookup := authMiddleware(api.repo, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler ran after the session lookup failed")
	}))
	request := httptest.NewRequest(http.MethodGet, "/me", nil)
	ctx, cancel := context.WithCancel(request.Context())
	cancel()
	request = request.WithContext(ctx)
	request.AddCookie(cookie)
	recorder := httptest.NewRecorder()
	failedLookup.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("failed session lookup status = %d, want 500 not 401", recorder.Code)
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
		{name: "wrong method collection", method: http.MethodPost, path: "/lessons", wantStatus: http.StatusMethodNotAllowed, wantBody: `{"error":"method not allowed"}`},
		{name: "wrong method item", method: http.MethodPost, path: "/lessons/greetings-basics", wantStatus: http.StatusMethodNotAllowed, wantBody: `{"error":"method not allowed"}`},
		{name: "unknown path", method: http.MethodGet, path: "/nope", wantStatus: http.StatusNotFound, wantBody: `{"error":"not found"}`},
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

	lessonResponse := httptest.NewRecorder()
	api.handler.ServeHTTP(lessonResponse, httptest.NewRequest(http.MethodGet, "/lessons/greetings-basics", nil))
	var lesson struct {
		TargetWPM int `json:"targetWpm"`
		Sentences []struct {
			VI string `json:"vi"`
		} `json:"sentences"`
	}
	if err := json.Unmarshal(lessonResponse.Body.Bytes(), &lesson); err != nil {
		t.Fatalf("decode lesson response: %v", err)
	}
	if len(lesson.Sentences) == 0 || lesson.Sentences[0].VI == "" || lesson.TargetWPM == 0 {
		t.Fatalf("lesson response = %#v, want client lesson fields", lesson)
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
	wantTokenHash := sha256.Sum256([]byte(cookie.Value))
	wantTokenHashHex := hex.EncodeToString(wantTokenHash[:])
	var storedTokenHash string
	if err := api.pool.QueryRow(context.Background(), `SELECT token_hash FROM sessions WHERE user_id = $1`, user["id"]).Scan(&storedTokenHash); err != nil {
		t.Fatalf("query session token hash: %v", err)
	}
	if storedTokenHash != wantTokenHashHex {
		t.Fatalf("stored token hash = %q, want sha256(cookie) %q", storedTokenHash, wantTokenHashHex)
	}
	if storedTokenHash == cookie.Value {
		t.Fatal("stored token hash equals bearer cookie")
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

func TestSignupRejectsInvalidEmail(t *testing.T) {
	api := newTestAPI(t)
	for name, body := range map[string]string{
		"missing":    `{"password":"password"}`,
		"whitespace": `{"email":" \t ","password":"password"}`,
		"nul":        `{"email":"bad\u0000email@example.com","password":"password"}`,
	} {
		t.Run(name, func(t *testing.T) {
			response := doJSON(api.handler, http.MethodPost, "/signup", body)
			if response.Code != http.StatusBadRequest || compactJSON(t, response.Body.Bytes()) != `{"error":"invalid email"}` {
				t.Fatalf("status = %d, body = %s; want 400 invalid email", response.Code, response.Body.String())
			}
		})
	}
}

// randomKey returns n bytes of random URL-safe base64: no repeats, so Postgres cannot compress it under its index limit.
func randomKey(n int) string {
	raw := make([]byte, n)
	_, _ = rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw)[:n]
}

func TestSignupRejectsOversizedEmail(t *testing.T) {
	api := newTestAPI(t)
	const domain = "@example.com"
	for _, n := range []int{storage.MaxKeyBytes + 1, 4000} {
		email := strings.ToLower(randomKey(n-len(domain))) + domain
		for _, path := range []string{"/signup", "/login"} {
			response := doJSON(api.handler, http.MethodPost, path, `{"email":"`+email+`","password":"password"}`)
			want := map[string]string{"/signup": `{"error":"invalid email"}`, "/login": `{"error":"invalid credentials"}`}[path]
			if response.Code != http.StatusBadRequest || compactJSON(t, response.Body.Bytes()) != want {
				t.Fatalf("%s with %d-byte email: status = %d, body = %s, want 400 %s", path, n, response.Code, response.Body.String(), want)
			}
		}
	}

	atCap := strings.ToLower(randomKey(storage.MaxKeyBytes-len(domain))) + domain
	if response := doJSON(api.handler, http.MethodPost, "/signup", `{"email":"`+atCap+`","password":"password"}`); response.Code != http.StatusOK {
		t.Fatalf("at-cap email status = %d, body = %s, want 200", response.Code, response.Body.String())
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
	if _, ok := logoutResponse.Header()["Content-Type"]; ok || logoutResponse.Body.Len() != 0 {
		t.Fatalf("logout response = headers %v, body %q; want no content type and empty body", logoutResponse.Header(), logoutResponse.Body.String())
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

const validSyncState = `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00.000Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"lapses":0,"state":0,"last_review":"2026-09-21T10:00:00.000Z","reps":1}}],"practiceDays":[{"date":"2026-09-22"}],"lessonCompletion":[{"lessonId":"lesson-1"}],"learnProgress":[{"lessonId":"lesson-1","passed":["sentence-1"],"skipsUsed":1,"updatedAt":"2026-09-22T10:00:00Z"}]}`

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
	body := `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00.000Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":null}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
}

func TestSyncAcceptsEmptyCardBackAndRoundTrips(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-empty-back@example.com")
	body := `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}},{"dirty":true,"id":"lesson-1:sentence-1:café","front":"café","back":"Hello there — Xin chào","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"café"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`
	response := syncWithCookie(api.handler, body, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	var state storage.State
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(state.Cards) != 2 || state.Cards[0].Back != "" || state.Cards[1].Front != "café" || state.Cards[1].Back != "Hello there — Xin chào" || state.Cards[1].Source.Word == nil || *state.Cards[1].Source.Word != "café" {
		t.Fatalf("response cards = %#v, want empty sentence back and round-tripped word card", state.Cards)
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
	state, secondEpoch := stateJSON(t, second.Body.Bytes())
	if state != withoutDirty(t, validSyncState) {
		t.Fatalf("second sync body = %s, want %s", second.Body.String(), validSyncState)
	}
	if _, firstEpoch := stateJSON(t, first.Body.Bytes()); firstEpoch != secondEpoch {
		t.Fatalf("syncEpoch = %s then %s, want equal", firstEpoch, secondEpoch)
	}
}

// A client that predates Learn mode sync sends no learnProgress; it is accepted, and the reply still carries the list.
func TestSyncAcceptsRequestWithoutLearnProgress(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-legacy@example.com")
	response := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if response.Code != http.StatusOK {
		t.Fatalf("legacy sync status = %d, body = %s", response.Code, response.Body.String())
	}
	if state, _ := stateJSON(t, response.Body.Bytes()); state != compactJSON(t, []byte(`{"cards":[],"practiceDays":[],"lessonCompletion":[],"learnProgress":[]}`)) {
		t.Fatalf("legacy sync state = %s, want empty lists including learnProgress", state)
	}
}

func TestSyncIsolatesUsersOverHTTP(t *testing.T) {
	api := newTestAPI(t)
	cookieA := signupForSync(t, api, "sync-isolation-a@example.com")
	cookieB := signupForSync(t, api, "sync-isolation-b@example.com")

	first := syncWithCookie(api.handler, validSyncState, cookieA)
	if first.Code != http.StatusOK {
		t.Fatalf("user A sync status = %d, body = %s", first.Code, first.Body.String())
	}

	empty := `{"cards":[],"practiceDays":[],"lessonCompletion":[],"learnProgress":[]}`
	responseB := syncWithCookie(api.handler, empty, cookieB)
	if responseB.Code != http.StatusOK {
		t.Fatalf("user B sync status = %d, body = %s", responseB.Code, responseB.Body.String())
	}
	if state, _ := stateJSON(t, responseB.Body.Bytes()); state != compactJSON(t, []byte(empty)) {
		t.Fatalf("user B state = %s, want empty state", responseB.Body.String())
	}

	responseA := syncWithCookie(api.handler, empty, cookieA)
	if responseA.Code != http.StatusOK {
		t.Fatalf("user A follow-up sync status = %d, body = %s", responseA.Code, responseA.Body.String())
	}
	if state, _ := stateJSON(t, responseA.Body.Bytes()); state != withoutDirty(t, validSyncState) {
		t.Fatalf("user A state = %s, want its original card unchanged", responseA.Body.String())
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
	card := func(updatedAt, deletedAt string) string {
		return `{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"lapses":0,"state":0,"reps":1},"updatedAt":"` + updatedAt + `","deletedAt":` + deletedAt + `}`
	}
	only := func(cards []storage.Card) storage.Card {
		t.Helper()
		if len(cards) != 1 {
			t.Fatalf("cards = %#v, want one", cards)
		}
		return cards[0]
	}

	// Both devices hold the live card; device A deletes it.
	syncCardsJSON(t, api, cookie, card("2026-09-22T10:00:00Z", "null"))
	syncCardsJSON(t, api, cookie, card("2026-09-23T10:00:00Z", `"2026-09-23T10:00:00Z"`))

	// Device B syncs its older live copy: the tombstone survives and is returned.
	got := only(syncCardsJSON(t, api, cookie, card("2026-09-22T10:00:00Z", "null")))
	if got.DeletedAt.Value == nil || *got.DeletedAt.Value != "2026-09-23T10:00:00Z" || got.UpdatedAt != "2026-09-23T10:00:00Z" {
		t.Fatalf("after older live copy = %#v, want the tombstone", got)
	}

	// Device A undoes with a newer updatedAt: the live card wins.
	got = only(syncCardsJSON(t, api, cookie, card("2026-09-24T10:00:00Z", "null")))
	if got.DeletedAt.Value != nil || got.UpdatedAt != "2026-09-24T10:00:00Z" {
		t.Fatalf("after undo = %#v, want live at the undo time", got)
	}
}

func TestSyncRejectsInvalidState(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-invalid@example.com")
	tests := []struct {
		name string
		body string
	}{
		{name: "dirty missing", body: `{"cards":[{"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "dirty string", body: `{"cards":[{"dirty":"yes","id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "dirty null", body: `{"cards":[{"dirty":null,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "bad fsrs due", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"not-a-date","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs due non-UTC offset", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00+20:00","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs due year zero", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"0000-01-01T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing fsrs due", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong fsrs type", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":[] }],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "bad fsrs last review", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"not-a-date"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs last review non-UTC offset", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"2026-09-21T10:00:00+20:00"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs last review year zero", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"0000-01-01T00:00:00Z"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "fsrs last review contains NUL", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"last_review":"2026-09-21T00:00:00Z\u0000"}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "invalid calendar day", body: `{"cards":[],"practiceDays":[{"date":"2026-02-30"}],"lessonCompletion":[]}`},
		{name: "practice day year zero", body: `{"cards":[],"practiceDays":[{"date":"0000-01-01"}],"lessonCompletion":[]}`},
		{name: "noncanonical calendar day", body: `{"cards":[],"practiceDays":[{"date":"2026-9-3"}],"lessonCompletion":[]}`},
		{name: "card id mismatch", body: `{"cards":[{"dirty":true,"id":"wrong-id","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty card id", body: `{"cards":[{"dirty":true,"id":"","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty card front", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card front contains NUL", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"a\u0000b","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card id contains NUL", body: `{"cards":[{"dirty":true,"id":"lesson\u0000-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson\u0000-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "card back contains NUL", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"a\u0000b","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty source lesson id", body: `{"cards":[{"dirty":true,"id":":sentence-1","front":"front","back":"back","source":{"lessonId":"","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty source sentence id", body: `{"cards":[{"dirty":true,"id":"lesson-1:","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "duplicate card id", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}},{"dirty":true,"id":"lesson-1:sentence-1","front":"front 2","back":"back 2","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing source word", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "uppercase word", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1:Hello","front":"Hello","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"Hello"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "word contains colon", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1:a:b","front":"a","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"a:b"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "word card id without word", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"hello","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":"hello"},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "empty lesson completion id", body: `{"cards":[],"practiceDays":[],"lessonCompletion":[{"lessonId":""}]}`},
		{name: "lesson completion contains NUL", body: `{"cards":[],"practiceDays":[],"lessonCompletion":[{"lessonId":"x\u0000y"}]}`},
		{name: "missing cards array", body: `{"practiceDays":[],"lessonCompletion":[]}`},
		{name: "null cards array", body: `{"cards":null,"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong cards type", body: `{"cards":{},"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing practice days array", body: `{"cards":[],"lessonCompletion":[]}`},
		{name: "null practice days array", body: `{"cards":[],"practiceDays":null,"lessonCompletion":[]}`},
		{name: "missing lesson completion array", body: `{"cards":[],"practiceDays":[]}`},
		{name: "null lesson completion array", body: `{"cards":[],"practiceDays":[],"lessonCompletion":null}`},
		{name: "missing updatedAt", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "null updatedAt", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":null,"deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "invalid updatedAt", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-02-30T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "four-digit fraction updatedAt", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00.1234Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "missing deletedAt", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "invalid deletedAt", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":"yesterday","fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
		{name: "wrong deletedAt type", body: `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":1,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[]}`},
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
		return `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{` + strings.Join(parts, ",") + `}}],"practiceDays":[],"lessonCompletion":[]}`
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

func TestSyncRejectsInvalidFSRSBytesWithoutWriting(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-invalid-fsrs-bytes@example.com")
	body := []byte(`{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"note":"a`)
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
			body := `{"cards":[{"dirty":true,"id":"lesson-1:sentence-1","front":"front","back":"back","source":{"lessonId":"lesson-1","sentenceId":"sentence-1","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T00:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0,"note":"` + test.note + `"}}],"practiceDays":[],"lessonCompletion":[]}`
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

func TestSyncRejectsCardsOverCap(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-card-cap@example.com")
	card := func(i int) string {
		sentenceID := "s" + strconv.Itoa(i)
		return `{"dirty":true,"id":"l:` + sentenceID + `","front":"f","back":"","source":{"lessonId":"l","sentenceId":"` + sentenceID + `","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}`
	}
	cards := make([]string, storage.MaxCards)
	for i := range cards {
		cards[i] = card(i)
	}
	half := storage.MaxCards / 2
	syncCardsJSON(t, api, cookie, strings.Join(cards[:half], ","))
	if got := syncCardsJSON(t, api, cookie, strings.Join(cards[half:], ",")); len(got) != storage.MaxCards {
		t.Fatalf("seeded cards = %d, want %d", len(got), storage.MaxCards)
	}

	response := syncWithCookie(api.handler, `{"cards":[`+card(storage.MaxCards)+`],"practiceDays":[],"lessonCompletion":[]}`, cookie)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusRequestEntityTooLarge, response.Body.String())
	}
	if compactJSON(t, response.Body.Bytes()) != `{"error":"too many cards"}` {
		t.Fatalf("body = %s", response.Body.String())
	}
	if got := syncCardsJSON(t, api, cookie, ""); len(got) != storage.MaxCards {
		t.Fatalf("cards after refused sync = %d, want %d", len(got), storage.MaxCards)
	}
}

func TestSyncRejectsListsOverCap(t *testing.T) {
	api := newTestAPI(t)
	for _, list := range []struct {
		name, over, body string
		seed             func(in *storage.State)
		count            func(state storage.State) int
		max              int
	}{
		{
			"practice-days", `{"cards":[],"practiceDays":[{"date":"9999-12-31"}],"lessonCompletion":[]}`, `{"error":"too many practice days"}`,
			func(in *storage.State) {
				for i := range storage.MaxPracticeDays {
					in.PracticeDays = append(in.PracticeDays, storage.PracticeDay{Date: time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, i).Format("2006-01-02")})
				}
			},
			func(state storage.State) int { return len(state.PracticeDays) }, storage.MaxPracticeDays,
		},
		{
			"lesson-completion", `{"cards":[],"practiceDays":[],"lessonCompletion":[{"lessonId":"over"}]}`, `{"error":"too many lesson completions"}`,
			func(in *storage.State) {
				for i := range storage.MaxLessonCompletions {
					in.LessonCompletion = append(in.LessonCompletion, storage.LessonCompletion{LessonID: "l" + strconv.Itoa(i)})
				}
			},
			func(state storage.State) int { return len(state.LessonCompletion) }, storage.MaxLessonCompletions,
		},
	} {
		t.Run(list.name, func(t *testing.T) {
			cookie := signupForSync(t, api, "sync-"+list.name+"-cap@example.com")
			me := doJSONWithCookie(api.handler, http.MethodGet, "/me", "", cookie)
			var user struct {
				ID string `json:"id"`
			}
			decodeJSON(t, me, &user)
			seed := storage.State{Cards: []storage.Card{}, PracticeDays: []storage.PracticeDay{}, LessonCompletion: []storage.LessonCompletion{}}
			list.seed(&seed)
			if _, err := api.repo.SyncState(context.Background(), user.ID, seed); err != nil {
				t.Fatalf("seed SyncState() error = %v", err)
			}

			response := syncWithCookie(api.handler, list.over, cookie)
			if response.Code != http.StatusRequestEntityTooLarge || compactJSON(t, response.Body.Bytes()) != list.body {
				t.Fatalf("status = %d, body = %s; want 413 %s", response.Code, response.Body.String(), list.body)
			}
			after := syncWithCookie(api.handler, `{"cards":[],"practiceDays":[],"lessonCompletion":[]}`, cookie)
			var state storage.State
			decodeJSON(t, after, &state)
			if list.count(state) != list.max {
				t.Fatalf("count after refused sync = %d, want %d", list.count(state), list.max)
			}
		})
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

// stateJSON returns a 200 sync body's compact JSON without its syncEpoch, and the epoch, which must be a non-empty string.
func stateJSON(t *testing.T, body []byte) (string, string) {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(body, &value); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	epoch, ok := value["syncEpoch"].(string)
	if !ok || epoch == "" {
		t.Fatalf("syncEpoch = %#v, want a non-empty string", value["syncEpoch"])
	}
	delete(value, "syncEpoch")
	compact, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("compact JSON: %v", err)
	}
	return string(compact), epoch
}

// withoutDirty returns a sync request body's compact JSON with each card's required dirty key removed.
func withoutDirty(t *testing.T, body string) string {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(body), &value); err != nil {
		t.Fatalf("invalid JSON body: %v", err)
	}
	for i, card := range value["cards"].([]any) {
		fields := card.(map[string]any)
		if _, ok := fields["dirty"]; !ok {
			t.Fatalf("request card %d has no dirty", i)
		}
		delete(fields, "dirty")
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

func TestSyncRejectsOversizedKeys(t *testing.T) {
	api := newTestAPI(t)
	cookie := signupForSync(t, api, "sync-oversized-keys@example.com")
	state := func(lessonID, sentenceID, completedLessonID string) string {
		id := lessonID + ":" + sentenceID
		return `{"cards":[{"dirty":true,"id":"` + id + `","front":"front","back":"back","source":{"lessonId":"` + lessonID + `","sentenceId":"` + sentenceID + `","word":""},"updatedAt":"2026-09-22T10:00:00Z","deletedAt":null,"fsrs":{"due":"2026-09-22T10:00:00Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"learning_steps":0,"reps":0,"lapses":0,"state":0}}],"practiceDays":[],"lessonCompletion":[{"lessonId":"` + completedLessonID + `"}]}`
	}
	for name, body := range map[string]string{
		"card id over cap":              state(randomKey(storage.MaxKeyBytes-1), "s", "lesson-1"),
		"long card lesson id":           state(randomKey(4000), "s", "lesson-1"),
		"long card sentence id":         state("lesson-1", randomKey(4000), "lesson-1"),
		"completion lesson id at cap+1": state("lesson-1", "s", randomKey(storage.MaxKeyBytes+1)),
		"long completion lesson id":     state("lesson-1", "s", randomKey(4000)),
	} {
		t.Run(name, func(t *testing.T) {
			response := syncWithCookie(api.handler, body, cookie)
			if response.Code != http.StatusBadRequest || compactJSON(t, response.Body.Bytes()) != `{"error":"invalid sync state"}` {
				t.Fatalf("status = %d, body = %s, want 400 invalid sync state", response.Code, response.Body.String())
			}
		})
	}

	atCap := state(randomKey(storage.MaxKeyBytes-2), "s", randomKey(storage.MaxKeyBytes))
	if response := syncWithCookie(api.handler, atCap, cookie); response.Code != http.StatusOK {
		t.Fatalf("at-cap keys status = %d, body = %s, want 200", response.Code, response.Body.String())
	}
}
