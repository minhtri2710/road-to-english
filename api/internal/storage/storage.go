package storage

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/road-to-english/api/internal/auth"
)

//go:embed schema.sql
var schemaSQL string

var (
	ErrEmailTaken     = errors.New("email already taken")
	ErrUserNotFound   = errors.New("user not found")
	ErrSessionInvalid = errors.New("session invalid")
	// ErrInvalidState is SyncState's error for an input that breaks the wire contract; nothing was written.
	ErrInvalidState = errors.New("invalid sync state")
	// ErrTooManyCards is SyncState's error when the merged state would store more than MaxCards cards; nothing was written.
	ErrTooManyCards = errors.New("too many cards")
	// ErrTooManyPracticeDays and ErrTooManyLessonCompletions are the same refusal for the other two lists.
	ErrTooManyPracticeDays      = errors.New("too many practice days")
	ErrTooManyLessonCompletions = errors.New("too many lesson completions")
)

// MaxCards caps an account's stored cards to one push's worth: a full-state sync body (4 MiB, api/sync.go)
// holds at most 4,194,304 / (299 + 1) = 13,981 of the smallest web card (299 B of JSON plus a comma).
const MaxCards = 13981

// MaxPracticeDays is one push's worth of the smallest practice day, {"date":"2026-09-25"} (21 B plus a comma): 4,194,304 / 22.
const MaxPracticeDays = 190650

// MaxLessonCompletions is one push's worth of the smallest completion, {"lessonId":"a"} (16 B plus a comma): 4,194,304 / 17.
const MaxLessonCompletions = 246723

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
	Fsrs      json.RawMessage `json:"fsrs"`
	UpdatedAt string          `json:"updatedAt"`
	DeletedAt DeletedAt       `json:"deletedAt"`
	// Dirty is required on a request card and absent from a response card: a dirty card upserts, a clean one only updates.
	Dirty *bool `json:"dirty,omitempty"`
}

// DeletedAt is a card's required, nullable deletedAt: Present tells a missing field from null.
type DeletedAt struct {
	Present bool
	Value   *string
}

func (d *DeletedAt) UnmarshalJSON(raw []byte) error {
	d.Present = true
	d.Value = nil
	if bytes.Equal(raw, []byte("null")) {
		return nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	d.Value = &value
	return nil
}

func (d DeletedAt) MarshalJSON() ([]byte, error) {
	if d.Value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(*d.Value)
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

// Synced is a sync's 200 body: the user's full state and the epoch of the server's copy of it.
type Synced struct {
	State
	SyncEpoch string `json:"syncEpoch"`
}

type User struct {
	ID    string
	Email string
}

type Repository struct {
	pool *pgxpool.Pool
}

// timestampGrammar is the one wire form the web also accepts: seconds, an optional 1-3 digit fraction, Z.
var timestampGrammar = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$`)

func parseTimestamp(value string) (time.Time, error) {
	if !timestampGrammar.MatchString(value) {
		return time.Time{}, fmt.Errorf("timestamp must be YYYY-MM-DDTHH:MM:SS with an optional 1-3 digit fraction and Z")
	}
	timestamp, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}
	if timestamp.Year() < 1 {
		return time.Time{}, fmt.Errorf("timestamp must have year >= 1")
	}
	return timestamp, nil
}

// formatTimestamp renders a stored timestamp in the Z form parseTimestamp and the web accept.
func formatTimestamp(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
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
		RETURNING id, email
	`, email, passwordHash).Scan(&user.ID, &user.Email)
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
		SELECT id, email
		FROM users
		WHERE id = $1
	`, userID).Scan(&user.ID, &user.Email)
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
		SELECT id, email, password_hash
		FROM users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &passwordHash)
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

// Session is a valid session. Extended reports that this lookup moved ExpiresAt forward.
type Session struct {
	UserID    string
	ExpiresAt time.Time
	Extended  bool
}

// sessionExtendInterval limits rolling extension to at most one UPDATE per session per interval.
const sessionExtendInterval = 24 * time.Hour

func (r *Repository) GetSession(ctx context.Context, tokenHash string) (Session, error) {
	var session Session
	var createdAt, now time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT user_id, created_at, expires_at, now()
		FROM sessions
		WHERE token_hash = $1 AND expires_at > now()
	`, tokenHash).Scan(&session.UserID, &createdAt, &session.ExpiresAt, &now)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionInvalid
	}
	if err != nil {
		return Session{}, fmt.Errorf("get session: %w", err)
	}
	limit := createdAt.Add(auth.SessionMaxLifetime)
	if !now.Before(limit) {
		return Session{}, ErrSessionInvalid
	}
	fresh := now.Add(auth.SessionTTL)
	if fresh.After(limit) {
		fresh = limit
	}
	if fresh.Sub(session.ExpiresAt) <= sessionExtendInterval {
		return session, nil
	}
	if _, err := r.pool.Exec(ctx, `UPDATE sessions SET expires_at = $2 WHERE token_hash = $1`, tokenHash, fresh); err != nil {
		return Session{}, fmt.Errorf("extend session: %w", err)
	}
	session.ExpiresAt = fresh
	session.Extended = true
	return session, nil
}

func (r *Repository) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// SyncState validates the whole input before any write, returning ErrInvalidState when it breaks the wire contract,
// then merges it in one transaction and returns the user's full state.
func (r *Repository) SyncState(ctx context.Context, userID string, in State) (Synced, error) {
	if err := in.validate(); err != nil {
		return Synced{}, err
	}
	// Upserts in key order, so concurrent syncs of one user lock shared rows in the same order and cannot deadlock.
	slices.SortFunc(in.Cards, func(a, b Card) int { return strings.Compare(a.ID, b.ID) })
	slices.SortFunc(in.PracticeDays, func(a, b PracticeDay) int { return strings.Compare(a.Date, b.Date) })
	slices.SortFunc(in.LessonCompletion, func(a, b LessonCompletion) int { return strings.Compare(a.LessonID, b.LessonID) })
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Synced{}, fmt.Errorf("begin sync transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if err := syncBatch(ctx, tx, userID, in); err != nil {
		return Synced{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM cards WHERE user_id = $1 AND deleted_at < now() - make_interval(secs => $2)`, userID, TombstoneRetention.Seconds()); err != nil {
		return Synced{}, fmt.Errorf("purge tombstones: %w", err)
	}
	epoch, err := syncEpoch(ctx, tx, userID)
	if err != nil {
		return Synced{}, err
	}

	out, err := readState(ctx, tx, userID)
	if err != nil {
		return Synced{}, err
	}
	if len(out.Cards) > MaxCards {
		return Synced{}, ErrTooManyCards
	}
	if len(out.PracticeDays) > MaxPracticeDays {
		return Synced{}, ErrTooManyPracticeDays
	}
	if len(out.LessonCompletion) > MaxLessonCompletions {
		return Synced{}, ErrTooManyLessonCompletions
	}
	if err := tx.Commit(ctx); err != nil {
		return Synced{}, fmt.Errorf("commit sync transaction: %w", err)
	}
	return Synced{State: out, SyncEpoch: epoch}, nil
}

// ponytail: a purged tombstone is forgotten, so an offline edit made before a deletion on another device and synced after the purge brings the card back; upgrade = server-assigned per-card version.
const TombstoneRetention = 180 * 24 * time.Hour

// syncEpoch returns the user's epoch, creating it on first use. A lost row yields a new epoch, which tells each client
// that the server's copy was lost, so it re-pushes its cards instead of deleting the ones the server no longer returns.
func syncEpoch(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO sync_epochs (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return "", fmt.Errorf("create sync epoch: %w", err)
	}
	var epoch string
	if err := tx.QueryRow(ctx, `SELECT epoch::text FROM sync_epochs WHERE user_id = $1`, userID).Scan(&epoch); err != nil {
		return "", fmt.Errorf("read sync epoch: %w", err)
	}
	return epoch, nil
}

// ponytail: LWW on device wall-clock updatedAt, so clock skew between devices can pick the wrong write; upgrade = server-assigned per-card version.
// History-preserving LWW, the rule web mergeCard implements: the newer updatedAt wins, and at equal time a tombstone beats a live card.
// The winner is kept whole, except that a winner with fsrs.reps 0 takes the other copy's fsrs when that copy has reps > 0,
// so a fresh save never wipes review history. The upsert therefore also updates when the incoming card loses but carries that history.
const incomingWins = `(EXCLUDED.updated_at > cards.updated_at
	OR (EXCLUDED.updated_at = cards.updated_at AND EXCLUDED.deleted_at IS NOT NULL AND cards.deleted_at IS NULL))`

// A dirty card ($11 true) upserts. A clean card only merges into an existing row: the server may have purged it, and
// re-inserting it would undo the purge. FOR UPDATE makes the existence check wait out a concurrent purge.
var syncCardSQL = strings.ReplaceAll(`
	INSERT INTO cards (user_id, id, front, back, lesson_id, sentence_id, word, fsrs, updated_at, deleted_at)
	SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::json, $9::timestamptz, $10::timestamptz
	WHERE $11::boolean OR EXISTS (SELECT 1 FROM cards WHERE user_id = $1::uuid AND id = $2::text FOR UPDATE)
	ON CONFLICT (user_id, id) DO UPDATE SET
		front = CASE WHEN {wins} THEN EXCLUDED.front ELSE cards.front END,
		back = CASE WHEN {wins} THEN EXCLUDED.back ELSE cards.back END,
		lesson_id = CASE WHEN {wins} THEN EXCLUDED.lesson_id ELSE cards.lesson_id END,
		sentence_id = CASE WHEN {wins} THEN EXCLUDED.sentence_id ELSE cards.sentence_id END,
		word = CASE WHEN {wins} THEN EXCLUDED.word ELSE cards.word END,
		fsrs = CASE
			WHEN (cards.fsrs->>'reps')::numeric > 0 AND (EXCLUDED.fsrs->>'reps')::numeric = 0 THEN cards.fsrs
			WHEN (EXCLUDED.fsrs->>'reps')::numeric > 0 AND (cards.fsrs->>'reps')::numeric = 0 THEN EXCLUDED.fsrs
			WHEN {wins} THEN EXCLUDED.fsrs
			ELSE cards.fsrs
		END,
		updated_at = CASE WHEN {wins} THEN EXCLUDED.updated_at ELSE cards.updated_at END,
		deleted_at = CASE WHEN {wins} THEN EXCLUDED.deleted_at ELSE cards.deleted_at END
	WHERE {wins}
		OR ((EXCLUDED.fsrs->>'reps')::numeric > 0 AND (cards.fsrs->>'reps')::numeric = 0)
`, "{wins}", incomingWins)

// syncBatch sends every upsert of an already validated, sorted State as one batch on tx and checks each result in order.
func syncBatch(ctx context.Context, tx pgx.Tx, userID string, in State) error {
	batch := &pgx.Batch{}
	for _, card := range in.Cards {
		batch.Queue(syncCardSQL, userID, card.ID, card.Front, card.Back, card.Source.LessonID, card.Source.SentenceID, *card.Source.Word, card.Fsrs, card.UpdatedAt, card.DeletedAt.Value, *card.Dirty)
	}
	for _, practiceDay := range in.PracticeDays {
		batch.Queue(`
			INSERT INTO practice_days (user_id, date)
			VALUES ($1, $2::date)
			ON CONFLICT (user_id, date) DO NOTHING
		`, userID, practiceDay.Date)
	}
	for _, completion := range in.LessonCompletion {
		batch.Queue(`
			INSERT INTO lesson_completion (user_id, lesson_id)
			VALUES ($1, $2)
			ON CONFLICT (user_id, lesson_id) DO NOTHING
		`, userID, completion.LessonID)
	}
	results := tx.SendBatch(ctx, batch)
	defer results.Close()
	for _, card := range in.Cards {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("sync card %q: %w", card.ID, err)
		}
	}
	for _, practiceDay := range in.PracticeDays {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("sync practice day %q: %w", practiceDay.Date, err)
		}
	}
	for _, completion := range in.LessonCompletion {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("sync lesson %q: %w", completion.LessonID, err)
		}
	}
	return results.Close()
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
		SELECT id, front, back, lesson_id, sentence_id, word, fsrs, updated_at, deleted_at
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
		var updatedAt time.Time
		var deletedAt *time.Time
		if err := rows.Scan(
			&card.ID,
			&card.Front,
			&card.Back,
			&card.Source.LessonID,
			&card.Source.SentenceID,
			&card.Source.Word,
			&card.Fsrs,
			&updatedAt,
			&deletedAt,
		); err != nil {
			return nil, fmt.Errorf("scan card: %w", err)
		}
		card.UpdatedAt = formatTimestamp(updatedAt)
		card.DeletedAt.Present = true
		if deletedAt != nil {
			value := formatTimestamp(*deletedAt)
			card.DeletedAt.Value = &value
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

	practiceDays, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (PracticeDay, error) {
		var date time.Time
		err := row.Scan(&date)
		return PracticeDay{Date: date.Format("2006-01-02")}, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan practice days: %w", err)
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

	lessonCompletion, err := pgx.CollectRows(rows, pgx.RowToStructByPos[LessonCompletion])
	if err != nil {
		return nil, fmt.Errorf("scan completed lessons: %w", err)
	}
	return lessonCompletion, nil
}
