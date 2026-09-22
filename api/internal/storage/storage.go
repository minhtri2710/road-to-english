package storage

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

// Card is the client-compatible persisted vocabulary card.
type Card struct {
	Id     string `json:"id"`
	Front  string `json:"front"`
	Back   string `json:"back"`
	Source struct {
		LessonId   string `json:"lessonId"`
		SentenceId string `json:"sentenceId"`
	} `json:"source"`
	Fsrs json.RawMessage `json:"fsrs"`
}

type Repository struct {
	pool *pgxpool.Pool
}

func Open(ctx context.Context, dsn string) (*Repository, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}

	closePool := true
	defer func() {
		if closePool {
			pool.Close()
		}
	}()

	// Pre-launch: schema.sql is the one live contract at v1. CREATE TABLE IF NOT EXISTS will not alter an existing table; on a schema change recreate the dev DB with `docker compose -f api/compose.yaml down -v`.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin schema transaction: %w", err)
	}
	if _, err := tx.Exec(ctx, schemaSQL); err != nil {
		_ = tx.Rollback(ctx)
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit schema transaction: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	closePool = false
	return &Repository{pool: pool}, nil
}

func (r *Repository) Close() {
	r.pool.Close()
}

func (r *Repository) UpsertCard(ctx context.Context, card Card) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO cards (id, front, back, lesson_id, sentence_id, fsrs)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			front = EXCLUDED.front,
			back = EXCLUDED.back,
			lesson_id = EXCLUDED.lesson_id,
			sentence_id = EXCLUDED.sentence_id,
			fsrs = EXCLUDED.fsrs
	`, card.Id, card.Front, card.Back, card.Source.LessonId, card.Source.SentenceId, card.Fsrs)
	if err != nil {
		return fmt.Errorf("upsert card %q: %w", card.Id, err)
	}
	return nil
}

func (r *Repository) ListCards(ctx context.Context) ([]Card, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, front, back, lesson_id, sentence_id, fsrs
		FROM cards
		ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("list cards: %w", err)
	}
	defer rows.Close()

	cards := make([]Card, 0)
	for rows.Next() {
		var card Card
		if err := rows.Scan(
			&card.Id,
			&card.Front,
			&card.Back,
			&card.Source.LessonId,
			&card.Source.SentenceId,
			&card.Fsrs,
		); err != nil {
			return nil, fmt.Errorf("scan card: %w", err)
		}
		cards = append(cards, card)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cards: %w", err)
	}
	return cards, nil
}

func (r *Repository) AddPracticeDay(ctx context.Context, dateKey string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO practice_days (date)
		VALUES ($1::date)
		ON CONFLICT DO NOTHING
	`, dateKey)
	if err != nil {
		return fmt.Errorf("add practice day %q: %w", dateKey, err)
	}
	return nil
}

func (r *Repository) ListPracticeDays(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT date FROM practice_days ORDER BY date`)
	if err != nil {
		return nil, fmt.Errorf("list practice days: %w", err)
	}
	defer rows.Close()

	dates := make([]string, 0)
	for rows.Next() {
		var date time.Time
		if err := rows.Scan(&date); err != nil {
			return nil, fmt.Errorf("scan practice day: %w", err)
		}
		dates = append(dates, date.Format("2006-01-02"))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate practice days: %w", err)
	}
	return dates, nil
}

func (r *Repository) MarkLessonComplete(ctx context.Context, lessonID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO lesson_completion (lesson_id)
		VALUES ($1)
		ON CONFLICT DO NOTHING
	`, lessonID)
	if err != nil {
		return fmt.Errorf("mark lesson %q complete: %w", lessonID, err)
	}
	return nil
}

func (r *Repository) ListCompletedLessons(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT lesson_id
		FROM lesson_completion
		ORDER BY lesson_id
	`)
	if err != nil {
		return nil, fmt.Errorf("list completed lessons: %w", err)
	}
	defer rows.Close()

	lessonIDs := make([]string, 0)
	for rows.Next() {
		var lessonID string
		if err := rows.Scan(&lessonID); err != nil {
			return nil, fmt.Errorf("scan completed lesson: %w", err)
		}
		lessonIDs = append(lessonIDs, lessonID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate completed lessons: %w", err)
	}
	return lessonIDs, nil
}
