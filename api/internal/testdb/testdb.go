// Package testdb gives every database test its own schema inside the dedicated, disposable rte_test
// database, so suites run in parallel without touching shared data or any development database.
package testdb

import (
	"context"
	"crypto/rand"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testDSN parses the dedicated test database URL: the rte_test database on loopback, owned by the
// rte_test role, with no query beyond a single sslmode=disable and no fragment. Anything else is
// refused before connecting, so a test can never hit a development or shared database. The parsed
// URL never echoes userinfo, so a malformed DSN cannot leak its password into a test log.
func testDSN(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("invalid test database URL")
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return nil, errors.New("test DSN must use the postgres or postgresql scheme")
	}
	if u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
		return nil, errors.New("test DSN host must be loopback")
	}
	if u.User == nil || u.User.Username() != "rte_test" {
		return nil, errors.New("test DSN user must be rte_test")
	}
	if u.Path != "/rte_test" || u.EscapedPath() != "/rte_test" {
		return nil, errors.New("test DSN database must be rte_test")
	}
	if u.Fragment != "" || u.RawFragment != "" {
		return nil, errors.New("test DSN must not carry a fragment")
	}
	if u.RawQuery != "" && u.RawQuery != "sslmode=disable" {
		return nil, errors.New("test DSN allows only sslmode=disable")
	}
	return u, nil
}

// Open creates a fresh rte_case_<random> schema inside the dedicated rte_test database, calls open
// with a DSN whose search_path is that schema, and returns a pool scoped the same way for direct
// SQL. The schema is dropped when the test ends, after the repo and pool close.
func Open(t *testing.T, open func(dsn string)) *pgxpool.Pool {
	t.Helper()
	raw := os.Getenv("RTE_TEST_DATABASE_URL")
	if raw == "" {
		t.Fatal("RTE_TEST_DATABASE_URL must be set to the dedicated rte_test database; see README")
	}
	u, err := testDSN(raw)
	if err != nil {
		t.Fatalf("RTE_TEST_DATABASE_URL refused: %v", err)
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, u.String())
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	t.Cleanup(func() {
		_ = admin.Close(ctx)
	})

	// The URL tuple is not proof of identity: confirm the role and database on the connection itself.
	var dbName, role string
	if err := admin.QueryRow(ctx, `SELECT current_database(), current_user`).Scan(&dbName, &role); err != nil {
		t.Fatalf("confirm test database identity: %v", err)
	}
	if dbName != "rte_test" || role != "rte_test" {
		t.Fatalf("test DSN reached database %q as role %q, want rte_test/rte_test", dbName, role)
	}

	schema := "rte_case_" + strings.ToLower(rand.Text())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, `CREATE SCHEMA `+quoted); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, `DROP SCHEMA `+quoted+` CASCADE`); err != nil {
			t.Errorf("drop test schema %s: %v", schema, err)
		}
	})

	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	scoped := u.String()

	pool, err := pgxpool.New(ctx, scoped)
	if err != nil {
		t.Fatalf("create scoped test pool: %v", err)
	}
	t.Cleanup(pool.Close)
	open(scoped)
	return pool
}
