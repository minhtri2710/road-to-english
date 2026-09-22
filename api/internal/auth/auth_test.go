package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

func TestPasswordHashAndCheck(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if !CheckPassword(hash, "correct horse battery staple") {
		t.Fatal("CheckPassword() rejected the correct password")
	}
	if CheckPassword(hash, "wrong password") {
		t.Fatal("CheckPassword() accepted the wrong password")
	}
}

func TestHashPasswordRejectsPasswordsOver72Bytes(t *testing.T) {
	_, err := HashPassword(strings.Repeat("a", 73))
	if !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("HashPassword() error = %v, want ErrPasswordTooLong", err)
	}
}

func TestNewSessionToken(t *testing.T) {
	rawA, hashA := NewSessionToken()
	rawB, _ := NewSessionToken()
	if rawA == rawB {
		t.Fatal("NewSessionToken() returned duplicate raw tokens")
	}
	wantDigest := sha256.Sum256([]byte(rawA))
	if hashA != hex.EncodeToString(wantDigest[:]) {
		t.Fatalf("hash = %q, want sha256(raw) %q", hashA, hex.EncodeToString(wantDigest[:]))
	}
	if rawA == hashA {
		t.Fatal("raw token equals stored hash")
	}
}
