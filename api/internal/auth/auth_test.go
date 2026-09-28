package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestPasswordHashAndCheck(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if hash == "correct horse battery staple" {
		t.Fatal("HashPassword() returned the plain password")
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil {
		t.Fatalf("bcrypt.Cost() error = %v", err)
	}
	if cost != bcrypt.DefaultCost {
		t.Fatalf("bcrypt cost = %d, want %d", cost, bcrypt.DefaultCost)
	}
	if !CheckPassword(hash, "correct horse battery staple") {
		t.Fatal("CheckPassword() rejected the correct password")
	}
	if CheckPassword(hash, "wrong password") {
		t.Fatal("CheckPassword() accepted the wrong password")
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
