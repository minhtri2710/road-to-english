package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

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

var corsAllowHeaders = []string{"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"}

// Every response through the CORS middleware varies by Origin, so a shared cache never serves one origin's answer to another.
func TestCORSVaryOriginOnEveryResponse(t *testing.T) {
	api := newTestAPI(t)
	for _, test := range []struct {
		name, method, path, origin string
		allowed                    bool
	}{
		{name: "matching GET", method: http.MethodGet, path: "/lessons", origin: defaultCORSOrigin, allowed: true},
		{name: "matching preflight", method: http.MethodOptions, path: "/login", origin: defaultCORSOrigin, allowed: true},
		{name: "foreign GET", method: http.MethodGet, path: "/lessons", origin: "https://evil.example"},
		{name: "no origin GET", method: http.MethodGet, path: "/lessons"},
		{name: "foreign preflight", method: http.MethodOptions, path: "/login", origin: "https://evil.example"},
		{name: "no origin OPTIONS", method: http.MethodOptions, path: "/sync"},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			recorder := httptest.NewRecorder()
			api.handler.ServeHTTP(recorder, req)
			if got := recorder.Header().Values("Vary"); len(got) != 1 || got[0] != "Origin" {
				t.Fatalf("Vary = %q, want [Origin]", got)
			}
			if got := recorder.Header().Get("Access-Control-Allow-Origin"); (got != "") != test.allowed {
				t.Fatalf("Access-Control-Allow-Origin = %q, want present %v", got, test.allowed)
			}
		})
	}
}

// A preflight from any other origin is handled as a plain request: no route accepts OPTIONS, so it gets the mux's
// JSON 405 (or 404 for an unknown path) and no CORS allow headers.
func TestCORSForeignPreflightIsNotACORSResponse(t *testing.T) {
	api := newTestAPI(t)
	for path, want := range map[string]struct {
		status int
		body   string
	}{
		"/login":   {http.StatusMethodNotAllowed, `{"error":"method not allowed"}`},
		"/sync":    {http.StatusMethodNotAllowed, `{"error":"method not allowed"}`},
		"/missing": {http.StatusNotFound, `{"error":"not found"}`},
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, path, nil)
			req.Header.Set("Origin", "https://evil.example")
			req.Header.Set("Access-Control-Request-Method", http.MethodPost)
			recorder := httptest.NewRecorder()
			api.handler.ServeHTTP(recorder, req)
			if recorder.Code != want.status || compactJSON(t, recorder.Body.Bytes()) != want.body {
				t.Fatalf("status = %d, body = %s; want %d %s", recorder.Code, recorder.Body.String(), want.status, want.body)
			}
			for _, header := range corsAllowHeaders {
				if got := recorder.Header().Get(header); got != "" {
					t.Fatalf("%s = %q, want absent", header, got)
				}
			}
		})
	}
}

// The web app reads Retry-After on a cross-origin 429, so non-preflight CORS responses expose it; nothing else does.
func TestCORSExposesRetryAfter(t *testing.T) {
	api := newTestAPI(t)
	for _, test := range []struct {
		name, method, origin string
		want                 string
	}{
		{name: "matching GET", method: http.MethodGet, origin: defaultCORSOrigin, want: "Retry-After"},
		{name: "matching preflight", method: http.MethodOptions, origin: defaultCORSOrigin},
		{name: "foreign GET", method: http.MethodGet, origin: "https://evil.example"},
		{name: "no origin GET", method: http.MethodGet},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, "/lessons", nil)
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			recorder := httptest.NewRecorder()
			api.handler.ServeHTTP(recorder, req)
			if got := recorder.Header().Get("Access-Control-Expose-Headers"); got != test.want {
				t.Fatalf("Access-Control-Expose-Headers = %q, want %q", got, test.want)
			}
		})
	}
}
