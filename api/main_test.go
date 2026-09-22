package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/road-to-english/api/internal/library"
)

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
	store, err := library.LoadSeed()
	if err != nil {
		t.Fatalf("library.LoadSeed() error = %v", err)
	}
	handler := corsMiddleware(jsonResponseMiddleware(newMux(store)), defaultCORSOrigin)

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "lesson summaries",
			method:     http.MethodGet,
			path:       "/lessons",
			wantStatus: http.StatusOK,
		},
		{
			name:       "fixture lesson",
			method:     http.MethodGet,
			path:       "/lessons/greetings-basics",
			wantStatus: http.StatusOK,
		},
		{
			name:       "unknown lesson",
			method:     http.MethodGet,
			path:       "/lessons/does-not-exist",
			wantStatus: http.StatusNotFound,
			wantBody:   `{"error":"not found"}`,
		},
		{
			name:       "wrong method collection",
			method:     http.MethodPost,
			path:       "/lessons",
			wantStatus: http.StatusMethodNotAllowed,
		},
		{
			name:       "wrong method item",
			method:     http.MethodPost,
			path:       "/lessons/greetings-basics",
			wantStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			req.Header.Set("Origin", defaultCORSOrigin)
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)

			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body = %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			if contentType := recorder.Header().Get("Content-Type"); contentType != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", contentType)
			}
			if test.wantBody != "" && compactJSON(t, recorder.Body.Bytes()) != test.wantBody {
				t.Fatalf("body = %s, want %s", recorder.Body.String(), test.wantBody)
			}

			if test.path == "/lessons/greetings-basics" && test.method == http.MethodGet {
				var lesson library.Lesson
				decodeJSON(t, recorder, &lesson)
				want := library.Lesson{
					ID:        "greetings-basics",
					Title:     "Greetings & Basics",
					Level:     library.LevelA2,
					TargetWPM: 90,
					Sentences: []library.Sentence{
						{ID: "greetings-basics-1", Text: "Good morning, how are you today?"},
						{ID: "greetings-basics-2", Text: "It is nice to meet you."},
						{ID: "greetings-basics-3", Text: "See you tomorrow.", Notes: "casual sign-off"},
					},
				}
				if lesson.ID != want.ID || lesson.Title != want.Title || lesson.Level != want.Level || lesson.TargetWPM != want.TargetWPM || len(lesson.Sentences) != len(want.Sentences) {
					t.Fatalf("lesson = %#v, want %#v", lesson, want)
				}
				for i := range want.Sentences {
					if lesson.Sentences[i] != want.Sentences[i] {
						t.Fatalf("sentence %d = %#v, want %#v", i, lesson.Sentences[i], want.Sentences[i])
					}
				}
			}

			if test.path == "/lessons" && test.method == http.MethodGet {
				var summaries []library.Summary
				decodeJSON(t, recorder, &summaries)
				assertSummary(t, summaries, library.Summary{
					ID:            "greetings-basics",
					Title:         "Greetings & Basics",
					Level:         library.LevelA2,
					SentenceCount: 3,
					TargetWPM:     90,
				})
				assertSummary(t, summaries, library.Summary{
					ID:            "daily-routine",
					Title:         "Daily Routine",
					Level:         library.LevelB1,
					SentenceCount: 3,
					TargetWPM:     110,
				})
			}
		})
	}
}

func TestCORSPreflight(t *testing.T) {
	store, err := library.LoadSeed()
	if err != nil {
		t.Fatalf("library.LoadSeed() error = %v", err)
	}
	handler := corsMiddleware(jsonResponseMiddleware(newMux(store)), defaultCORSOrigin)
	req := httptest.NewRequest(http.MethodOptions, "/lessons", nil)
	req.Header.Set("Origin", defaultCORSOrigin)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != defaultCORSOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", got, defaultCORSOrigin)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Methods"); got != "GET, OPTIONS" {
		t.Fatalf("Access-Control-Allow-Methods = %q, want %q", got, "GET, OPTIONS")
	}
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

func assertSummary(t *testing.T, summaries []library.Summary, want library.Summary) {
	t.Helper()
	for _, summary := range summaries {
		if summary == want {
			return
		}
	}
	t.Fatalf("summary %#v not found in %#v", want, summaries)
}
