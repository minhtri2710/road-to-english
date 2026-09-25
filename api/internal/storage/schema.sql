CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    sentence_id TEXT NOT NULL,
    word TEXT NOT NULL,
    fsrs JSON NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ NULL,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS practice_days (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS lesson_completion (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS sync_epochs (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    epoch UUID NOT NULL DEFAULT gen_random_uuid()
);
