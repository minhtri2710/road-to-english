package storage

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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
	ID     string `json:"id"`
	Front  string `json:"front"`
	Back   string `json:"back"`
	Source struct {
		LessonID   string  `json:"lessonId"`
		SentenceID string  `json:"sentenceId"`
		Word       *string `json:"word"`
	} `json:"source"`
	Fsrs json.RawMessage `json:"fsrs"`
}

type PracticeDay struct {
	Date string `json:"date"`
}

type LessonCompletion struct {
	LessonID string `json:"lessonId"`
}

type State struct {
	Cards            []Card             `json:"cards"`
	PracticeDays     []PracticeDay      `json:"practiceDays"`
	LessonCompletion []LessonCompletion `json:"lessonCompletion"`
}

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}

type Repository struct {
	pool *pgxpool.Pool
}

func ParseFSRSTimestamp(value string) (time.Time, error) {
	if !strings.HasSuffix(value, "Z") {
		return time.Time{}, fmt.Errorf("timestamp must end in Z")
	}
	timestamp, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}
	_, offset := timestamp.Zone()
	if timestamp.Year() < 1 || offset != 0 {
		return time.Time{}, fmt.Errorf("timestamp must be UTC and have year >= 1")
	}
	return timestamp, nil
}

func FSRSLastReview(raw json.RawMessage) (*time.Time, error) {
	var object map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &object) != nil || object == nil {
		return nil, fmt.Errorf("fsrs must be a JSON object")
	}
	rawLastReview, ok := object["last_review"]
	if !ok || bytes.Equal(bytes.TrimSpace(rawLastReview), []byte("null")) {
		return nil, nil
	}
	var value string
	if err := json.Unmarshal(rawLastReview, &value); err != nil {
		return nil, fmt.Errorf("last_review must be a string or null: %w", err)
	}
	timestamp, err := ParseFSRSTimestamp(value)
	if err != nil {
		return nil, fmt.Errorf("invalid last_review: %w", err)
	}
	return &timestamp, nil
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
	`, email, passwordHash).Scan(&user.ID, &user.Email, &user.CreatedAt)
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
	`, userID).Scan(&user.ID, &user.Email, &user.CreatedAt)
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
	`, email).Scan(&user.ID, &user.Email, &passwordHash, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrUserNotFound
	}
	if err != nil {
		return User{}, "", fmt.Errorf("get user by email: %w", err)
	}
	return user, passwordHash, nil
}

func (r *Repository) CreateSession(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin create session transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	// ponytail: full session scan per login has no expires_at index; upgrade = add an index or periodic purge job when sessions grow.
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= now()`); err != nil {
		return fmt.Errorf("purge expired sessions: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO sessions (token_hash, user_id, expires_at)
		VALUES ($1, $2, $3)
	`, tokenHash, userID, expiresAt); err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit create session: %w", err)
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

func (r *Repository) SyncState(ctx context.Context, userID string, in State) (State, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return State{}, fmt.Errorf("begin sync transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	for _, card := range in.Cards {
		if err := syncCard(ctx, tx, userID, card); err != nil {
			return State{}, err
		}
	}
	for _, practiceDay := range in.PracticeDays {
		if err := syncPracticeDay(ctx, tx, userID, practiceDay); err != nil {
			return State{}, err
		}
	}
	for _, completion := range in.LessonCompletion {
		if err := syncLessonCompletion(ctx, tx, userID, completion); err != nil {
			return State{}, err
		}
	}

	out, err := readState(ctx, tx, userID)
	if err != nil {
		return State{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return State{}, fmt.Errorf("commit sync transaction: %w", err)
	}
	return out, nil
}

func syncCard(ctx context.Context, tx pgx.Tx, userID string, card Card) error {
	if card.Source.Word == nil {
		return fmt.Errorf("sync card %q: missing source word", card.ID)
	}
	lastReview, err := FSRSLastReview(card.Fsrs)
	if err != nil {
		return fmt.Errorf("derive card %q last review: %w", card.ID, err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO cards (user_id, id, front, back, lesson_id, sentence_id, word, fsrs, last_review)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (user_id, id) DO UPDATE SET
			front = EXCLUDED.front,
			back = EXCLUDED.back,
			lesson_id = EXCLUDED.lesson_id,
			sentence_id = EXCLUDED.sentence_id,
			word = EXCLUDED.word,
			fsrs = EXCLUDED.fsrs,
			last_review = EXCLUDED.last_review
		-- ponytail: never-reviewed cards with the same id intentionally never update each other; the web sub-slice mirrors this exact rule.
		WHERE COALESCE(EXCLUDED.last_review, '-infinity') > COALESCE(cards.last_review, '-infinity')
	`, userID, card.ID, card.Front, card.Back, card.Source.LessonID, card.Source.SentenceID, *card.Source.Word, card.Fsrs, lastReview)
	if err != nil {
		return fmt.Errorf("sync card %q: %w", card.ID, err)
	}
	return nil
}

func syncPracticeDay(ctx context.Context, tx pgx.Tx, userID string, practiceDay PracticeDay) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO practice_days (user_id, date)
		VALUES ($1, $2::date)
		ON CONFLICT (user_id, date) DO NOTHING
	`, userID, practiceDay.Date)
	if err != nil {
		return fmt.Errorf("sync practice day %q: %w", practiceDay.Date, err)
	}
	return nil
}

func syncLessonCompletion(ctx context.Context, tx pgx.Tx, userID string, completion LessonCompletion) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO lesson_completion (user_id, lesson_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, lesson_id) DO NOTHING
	`, userID, completion.LessonID)
	if err != nil {
		return fmt.Errorf("sync lesson %q: %w", completion.LessonID, err)
	}
	return nil
}

func readState(ctx context.Context, tx pgx.Tx, userID string) (State, error) {
	cards, err := readCards(ctx, tx, userID)
	if err != nil {
		return State{}, err
	}
	practiceDays, err := readPracticeDays(ctx, tx, userID)
	if err != nil {
		return State{}, err
	}
	lessonCompletion, err := readLessonCompletion(ctx, tx, userID)
	if err != nil {
		return State{}, err
	}
	return State{
		Cards:            cards,
		PracticeDays:     practiceDays,
		LessonCompletion: lessonCompletion,
	}, nil
}

func readCards(ctx context.Context, tx pgx.Tx, userID string) ([]Card, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, front, back, lesson_id, sentence_id, word, fsrs
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
			&card.ID,
			&card.Front,
			&card.Back,
			&card.Source.LessonID,
			&card.Source.SentenceID,
			&card.Source.Word,
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

func readPracticeDays(ctx context.Context, tx pgx.Tx, userID string) ([]PracticeDay, error) {
	rows, err := tx.Query(ctx, `
		SELECT date
		FROM practice_days
		WHERE user_id = $1
		ORDER BY date
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list practice days: %w", err)
	}
	defer rows.Close()

	practiceDays := make([]PracticeDay, 0)
	for rows.Next() {
		var date time.Time
		if err := rows.Scan(&date); err != nil {
			return nil, fmt.Errorf("scan practice day: %w", err)
		}
		practiceDays = append(practiceDays, PracticeDay{Date: date.Format("2006-01-02")})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate practice days: %w", err)
	}
	return practiceDays, nil
}

func readLessonCompletion(ctx context.Context, tx pgx.Tx, userID string) ([]LessonCompletion, error) {
	rows, err := tx.Query(ctx, `
		SELECT lesson_id
		FROM lesson_completion
		WHERE user_id = $1
		ORDER BY lesson_id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list completed lessons: %w", err)
	}
	defer rows.Close()

	lessonCompletion := make([]LessonCompletion, 0)
	for rows.Next() {
		var lessonID string
		if err := rows.Scan(&lessonID); err != nil {
			return nil, fmt.Errorf("scan completed lesson: %w", err)
		}
		lessonCompletion = append(lessonCompletion, LessonCompletion{LessonID: lessonID})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate completed lessons: %w", err)
	}
	return lessonCompletion, nil
}
