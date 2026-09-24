// Package testdb gives every database test suite the same serialized, emptied DATABASE_URL database.
package testdb

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Open takes the advisory lock every database test package shares, so parallel packages serialize. It then calls
// open with DATABASE_URL, which applies the schema under the lock, and empties every table: they all cascade from
// users. The returned pool is for direct SQL and is closed, with the lock released, when the test ends.
func Open(t *testing.T, open func(dsn string)) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Fatal("DATABASE_URL must be set to a local Postgres for database tests; run: docker compose -f api/compose.yaml up -d --wait")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New() error = %v", err)
	}
	t.Cleanup(pool.Close)
	lockConn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire test database lock: %v", err)
	}
	t.Cleanup(lockConn.Release)
	if _, err := lockConn.Exec(ctx, `SELECT pg_advisory_lock(hashtextextended('road-to-english-api-tests', 0))`); err != nil {
		t.Fatalf("lock test database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = lockConn.Exec(ctx, `SELECT pg_advisory_unlock(hashtextextended('road-to-english-api-tests', 0))`)
	})
	open(dsn)
	if _, err := pool.Exec(ctx, "TRUNCATE users RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
	return pool
}
