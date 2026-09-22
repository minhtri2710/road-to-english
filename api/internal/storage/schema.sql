CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    sentence_id TEXT NOT NULL,
    fsrs JSON NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_days (
    date DATE PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS lesson_completion (
    lesson_id TEXT PRIMARY KEY
);
