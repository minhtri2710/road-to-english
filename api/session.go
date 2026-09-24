package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/road-to-english/api/internal/auth"
	"github.com/road-to-english/api/internal/storage"
)

const sessionCookieName = "session"

const authBodyMaxBytes int64 = 4 * 1024

type contextKey string

const userIDContextKey contextKey = "userID"

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func signupHandler(w http.ResponseWriter, r *http.Request, repo *storage.Repository, limiter *authLimiter) {
	if !limiter.allowIP(w, r) {
		return
	}
	credentials, ok := decodeCredentials(w, r)
	if !ok {
		return
	}
	credentials.Email = normalizeEmail(credentials.Email)
	if !storage.ValidKey(credentials.Email) {
		writeError(w, http.StatusBadRequest, "invalid email")
		return
	}
	passwordHash, err := auth.HashPassword(credentials.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrPasswordTooShort):
			writeError(w, http.StatusBadRequest, "password too short")
		case errors.Is(err, auth.ErrPasswordTooLong):
			writeError(w, http.StatusBadRequest, "password too long")
		default:
			writeError(w, http.StatusInternalServerError, "internal server error")
		}
		return
	}
	user, err := repo.CreateUser(r.Context(), credentials.Email, passwordHash)
	if err != nil {
		if errors.Is(err, storage.ErrEmailTaken) {
			writeError(w, http.StatusConflict, "email already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if !setSessionCookie(w, r, repo, user.ID) {
		return
	}
	writeUser(w, user)
}

func loginHandler(w http.ResponseWriter, r *http.Request, repo *storage.Repository, limiter *authLimiter) {
	if !limiter.allowIP(w, r) {
		return
	}
	credentials, ok := decodeCredentials(w, r)
	if !ok {
		return
	}
	credentials.Email = normalizeEmail(credentials.Email)
	if !validLoginCredentials(credentials) {
		writeError(w, http.StatusBadRequest, "invalid credentials")
		return
	}
	reserved, ok := limiter.allowAccount(w, r, credentials.Email)
	if !ok {
		return
	}
	user, passwordHash, err := repo.GetUserByEmail(r.Context(), credentials.Email)
	if err != nil {
		if errors.Is(err, storage.ErrUserNotFound) {
			auth.CheckDummyPassword(credentials.Password)
			writeError(w, http.StatusUnauthorized, "invalid email or password")
			return
		}
		limiter.release(r, credentials.Email, reserved)
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if !auth.CheckPassword(passwordHash, credentials.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	limiter.clearFailures(r, credentials.Email, reserved)
	if !setSessionCookie(w, r, repo, user.ID) {
		return
	}
	writeUser(w, user)
}

func logoutHandler(w http.ResponseWriter, r *http.Request, repo *storage.Repository) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
		if err := repo.DeleteSession(r.Context(), auth.HashSessionToken(cookie.Value)); err != nil {
			writeError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}
	writeSessionCookie(w, "", time.Unix(1, 0), -1)
	w.WriteHeader(http.StatusNoContent)
}

func meHandler(w http.ResponseWriter, r *http.Request, repo *storage.Repository) {
	user, err := repo.GetUserByID(r.Context(), requestUserID(r))
	if err != nil {
		if errors.Is(err, storage.ErrUserNotFound) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	writeUser(w, user)
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
	return storage.ValidKey(input.Email) && len(input.Password) > 0 && len(input.Password) <= auth.MaxPasswordBytes
}

// writeUser encodes a map, whose sorted keys keep the body {"email":...,"id":...} byte for byte.
func writeUser(w http.ResponseWriter, user storage.User) {
	writeJSON(w, http.StatusOK, map[string]string{"id": user.ID, "email": user.Email})
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, repo *storage.Repository, userID string) bool {
	rawToken, tokenHash := auth.NewSessionToken()
	expiresAt := time.Now().Add(auth.SessionTTL)
	if err := repo.CreateSession(r.Context(), userID, tokenHash, expiresAt); err != nil {
		writeError(w, http.StatusInternalServerError, "internal server error")
		return false
	}
	writeSessionCookie(w, rawToken, expiresAt, int(auth.SessionTTL/time.Second))
	return true
}

// writeSessionCookie is the one session cookie shape; logout clears it with an empty value and maxAge -1.
func writeSessionCookie(w http.ResponseWriter, value string, expiresAt time.Time, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
	})
}

func authMiddleware(repo *storage.Repository, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil || cookie.Value == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		session, err := repo.GetSession(r.Context(), auth.HashSessionToken(cookie.Value))
		if err != nil {
			if errors.Is(err, storage.ErrSessionInvalid) {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			writeError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if session.Extended {
			writeSessionCookie(w, cookie.Value, session.ExpiresAt, int(time.Until(session.ExpiresAt)/time.Second))
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDContextKey, session.UserID)))
	})
}

// requestUserID is the session's user id; only handlers behind authMiddleware call it, which always sets it.
func requestUserID(r *http.Request) string {
	return r.Context().Value(userIDContextKey).(string)
}
