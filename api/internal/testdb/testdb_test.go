package testdb

import (
	"context"
	"strings"
	"testing"
)

func TestTestDSNRefusesAnythingButTheDedicatedTarget(t *testing.T) {
	good := []string{
		"postgres://rte_test@127.0.0.1:5432/rte_test?sslmode=disable",
		"postgresql://rte_test@localhost/rte_test",
		"postgres://rte_test@[::1]/rte_test?sslmode=disable",
		"postgres://rte_test:secret@127.0.0.1/rte_test",
		"postgres://rte_test@localhost/rte_test?sslmode=disable",
	}
	for _, raw := range good {
		t.Run(raw, func(t *testing.T) {
			if _, err := testDSN(raw); err != nil {
				t.Fatalf("testDSN(%q) = %v, want accepted", raw, err)
			}
		})
	}

	bad := map[string]string{
		"missing scheme":       "rte_test@127.0.0.1/rte_test",
		"http scheme":          "http://rte_test@127.0.0.1/rte_test",
		"dev database":         "postgres://rte_test@127.0.0.1/rte_dev",
		"root path":            "postgres://rte_test@127.0.0.1/",
		"other user":           "postgres://dev@127.0.0.1/rte_test",
		"no user":              "postgres://127.0.0.1/rte_test",
		"remote host":          "postgres://rte_test@db.example.com/rte_test",
		"docker service host":  "postgres://rte_test@db/rte_test",
		"ipv4 other":           "postgres://rte_test@10.0.0.5/rte_test",
		"fragment":             "postgres://rte_test@127.0.0.1/rte_test#x",
		"host override option": "postgres://rte_test@127.0.0.1/rte_test?host=db.example.com",
		"sslmode other":        "postgres://rte_test@127.0.0.1/rte_test?sslmode=require",
		"sslmode twice":        "postgres://rte_test@127.0.0.1/rte_test?sslmode=disable&sslmode=disable",
		"extra query":          "postgres://rte_test@127.0.0.1/rte_test?sslmode=disable&x=1",
		"app name only":        "postgres://rte_test@127.0.0.1/rte_test?application_name=a",
		"encoded path":         "postgres://rte_test@127.0.0.1/rte%5ftest",
	}
	for name, raw := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := testDSN(raw); err == nil {
				t.Fatalf("testDSN(%q) = nil, want refusal", raw)
			}
		})
	}
}

// Each Open call gets its own schema: a second suite's objects and rows never reach the first's.
func TestOpenSchemasAreIndependent(t *testing.T) {
	ctx := context.Background()
	outer := Open(t, func(string) {})
	var outerSchema string
	if err := outer.QueryRow(ctx, `SELECT current_schema()`).Scan(&outerSchema); err != nil {
		t.Fatalf("outer current_schema: %v", err)
	}
	if !strings.HasPrefix(outerSchema, "rte_case_") {
		t.Fatalf("outer schema = %q, want an rte_case_ schema", outerSchema)
	}
	if _, err := outer.Exec(ctx, `CREATE TABLE probe (email text)`); err != nil {
		t.Fatalf("outer create probe: %v", err)
	}
	if _, err := outer.Exec(ctx, `INSERT INTO probe VALUES ('first@example.com')`); err != nil {
		t.Fatalf("outer insert: %v", err)
	}

	var innerSchema string
	inner := Open(t, func(string) {})
	if err := inner.QueryRow(ctx, `SELECT current_schema()`).Scan(&innerSchema); err != nil {
		t.Fatalf("inner current_schema: %v", err)
	}
	if innerSchema == outerSchema || !strings.HasPrefix(innerSchema, "rte_case_") {
		t.Fatalf("inner schema = %q, outer = %q, want a different rte_case_ schema", innerSchema, outerSchema)
	}
	// The inner schema is empty: the same table name is free there.
	if _, err := inner.Exec(ctx, `CREATE TABLE probe (email text)`); err != nil {
		t.Fatalf("inner create probe: %v", err)
	}

	var email string
	if err := outer.QueryRow(ctx, `SELECT email FROM probe`).Scan(&email); err != nil {
		t.Fatalf("outer select: %v", err)
	}
	if email != "first@example.com" {
		t.Fatalf("outer row = %q, want its own insert", email)
	}
	var innerRows int
	if err := inner.QueryRow(ctx, `SELECT count(*) FROM probe`).Scan(&innerRows); err != nil {
		t.Fatalf("inner select: %v", err)
	}
	if innerRows != 0 {
		t.Fatalf("inner rows = %d, want 0", innerRows)
	}
}
