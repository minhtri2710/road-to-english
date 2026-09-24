package main

import (
	"bytes"
	"encoding/json"
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
