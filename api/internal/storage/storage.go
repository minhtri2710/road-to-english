package storage

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

var (
	ErrEmailTaken     = errors.New("email already taken")
	ErrUserNotFound   = errors.New("user not found")
	ErrSessionInvalid = errors.New("session invalid")
)

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

type User struct {
	Id        string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
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

func (r *Repository) CreateUser(ctx context.Context, email, passwordHash string) (User, error) {
	var user User
	err := r.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id, email, created_at
	`, email, passwordHash).Scan(&user.Id, &user.Email, &user.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, ErrEmailTaken
		}
		return User{}, fmt.Errorf("create user: %w", err)
	}
	return user, nil
}

func (r *Repository) GetUserByID(ctx context.Context, userID string) (User, error) {
	var user User
	err := r.pool.QueryRow(ctx, `
		SELECT id, email, created_at
		FROM users
		WHERE id = $1
	`, userID).Scan(&user.Id, &user.Email, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by id: %w", err)
	}
	return user, nil
}

func (r *Repository) GetUserByEmail(ctx context.Context, email string) (User, string, error) {
	var user User
	var passwordHash string
	err := r.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, created_at
		FROM users
		WHERE email = $1
	`, email).Scan(&user.Id, &user.Email, &passwordHash, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrUserNotFound
	}
	if err != nil {
		return User{}, "", fmt.Errorf("get user by email: %w", err)
	}
	return user, passwordHash, nil
}

func (r *Repository) CreateSession(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO sessions (token_hash, user_id, expires_at)
		VALUES ($1, $2, $3)
	`, tokenHash, userID, expiresAt)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func (r *Repository) GetSession(ctx context.Context, tokenHash string) (string, error) {
	var userID string
	err := r.pool.QueryRow(ctx, `
		SELECT user_id
		FROM sessions
		WHERE token_hash = $1 AND expires_at > now()
	`, tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionInvalid
	}
	if err != nil {
		return "", fmt.Errorf("get session: %w", err)
	}
	return userID, nil
}

func (r *Repository) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func (r *Repository) UpsertCard(ctx context.Context, userID string, card Card) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO cards (user_id, id, front, back, lesson_id, sentence_id, fsrs)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, id) DO UPDATE SET
			front = EXCLUDED.front,
			back = EXCLUDED.back,
			lesson_id = EXCLUDED.lesson_id,
			sentence_id = EXCLUDED.sentence_id,
			fsrs = EXCLUDED.fsrs
	`, userID, card.Id, card.Front, card.Back, card.Source.LessonId, card.Source.SentenceId, card.Fsrs)
	if err != nil {
		return fmt.Errorf("upsert card %q: %w", card.Id, err)
	}
	return nil
}

func (r *Repository) ListCards(ctx context.Context, userID string) ([]Card, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, front, back, lesson_id, sentence_id, fsrs
		FROM cards
		WHERE user_id = $1
		ORDER BY id
	`, userID)
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

func (r *Repository) AddPracticeDay(ctx context.Context, userID, dateKey string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO practice_days (user_id, date)
		VALUES ($1, $2::date)
		ON CONFLICT (user_id, date) DO NOTHING
	`, userID, dateKey)
	if err != nil {
		return fmt.Errorf("add practice day %q: %w", dateKey, err)
	}
	return nil
}

func (r *Repository) ListPracticeDays(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT date FROM practice_days WHERE user_id = $1 ORDER BY date`, userID)
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

func (r *Repository) MarkLessonComplete(ctx context.Context, userID, lessonID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO lesson_completion (user_id, lesson_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, lesson_id) DO NOTHING
	`, userID, lessonID)
	if err != nil {
		return fmt.Errorf("mark lesson %q complete: %w", lessonID, err)
	}
	return nil
}

func (r *Repository) ListCompletedLessons(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT lesson_id
		FROM lesson_completion
		WHERE user_id = $1
		ORDER BY lesson_id
	`, userID)
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
