package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrPasswordTooShort = errors.New("password has fewer than 8 characters")
	ErrPasswordTooLong  = fmt.Errorf("password exceeds %d bytes", MaxPasswordBytes)
)

// MaxPasswordBytes is bcrypt's input limit; longer passwords are refused, never truncated.
const MaxPasswordBytes = 72

const SessionTTL = 30 * 24 * time.Hour

// SessionMaxLifetime caps rolling extension: a session is invalid this long after it was created.
const SessionMaxLifetime = 90 * 24 * time.Hour

const dummyPasswordHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

func HashPassword(plain string) (string, error) {
	if utf8.RuneCountInString(plain) < 8 {
		return "", ErrPasswordTooShort
	}
	// ponytail: multibyte passwords can reach bcrypt's 72-byte limit below 64 characters; lifting this ceiling needs pre-hashing or a pepper, a separate Human gate.
	if len(plain) > MaxPasswordBytes {
		return "", ErrPasswordTooLong
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(passwordHash), nil
}

func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

func CheckDummyPassword(plain string) bool {
	return CheckPassword(dummyPasswordHash, plain)
}

func NewSessionToken() (raw string, hash string) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		panic(err)
	}
	raw = base64.RawURLEncoding.EncodeToString(token[:])
	return raw, HashSessionToken(raw)
}

func HashSessionToken(raw string) string {
	digest := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(digest[:])
}
