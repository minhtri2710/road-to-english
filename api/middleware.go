package main

import (
	"io"
	"net/http"
)

// corsMiddleware answers CORS only for configuredOrigin. Every response varies by Origin; a request from any other
// origin, preflight included, is served as a plain request without CORS headers.
func corsMiddleware(next http.Handler, configuredOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		if r.Header.Get("Origin") != configuredOrigin {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", configuredOrigin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// The web app reads the wait on a 429.
		w.Header().Set("Access-Control-Expose-Headers", "Retry-After")
		next.ServeHTTP(w, r)
	})
}

// errorBodies replaces the body of a 404 or 405 the handler did not answer in JSON (the mux's plain-text errors).
var errorBodies = map[int]string{
	http.StatusNotFound:         `{"error":"not found"}` + "\n",
	http.StatusMethodNotAllowed: `{"error":"method not allowed"}` + "\n",
}

// jsonResponseWriter passes the response through, marking it application/json (except a 204) when the header is written.
type jsonResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
	discard     bool
}

func (w *jsonResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	header := w.Header()
	body, replace := errorBodies[status]
	w.discard = replace && header.Get("Content-Type") != "application/json"
	if status != http.StatusNoContent {
		header.Set("Content-Type", "application/json")
	}
	if w.discard {
		header.Del("Content-Length")
	}
	w.ResponseWriter.WriteHeader(status)
	if w.discard {
		_, _ = io.WriteString(w.ResponseWriter, body)
	}
}

func (w *jsonResponseWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.discard {
		return len(body), nil
	}
	return w.ResponseWriter.Write(body)
}

func jsonResponseMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writer := &jsonResponseWriter{ResponseWriter: w}
		next.ServeHTTP(writer, r)
		if !writer.wroteHeader {
			writer.WriteHeader(http.StatusOK)
		}
	})
}
