# road-to-english

A web app for daily English practice, built for Vietnamese speakers.

- Lesson library: shadow each sentence along with its video, with optional Vietnamese translation and a pronunciation check.
- Dictation and fill-in-the-blank quizzes, plus guided shadowing.
- Import your own text as a lesson.
- Save words and sentences as cards and review them with spaced repetition.
- Everything is stored on your device. Sign in to sync with an account, or export a backup file.

The project is pre-launch. Data may be reset at any time.

## Stack

- `api/`: Go (`net/http`), Postgres through pgx.
- `web/`: Vite, React 19, StyleX and Astryx. Device storage uses IndexedDB.

## Run locally

Requirements: Go, Node with pnpm, and Docker.

1. Start the dev database (Postgres on port 5435, disposable data):

   ```sh
   docker compose -f api/compose.yaml up -d --wait
   ```

2. Start the api. It reads `DATABASE_URL`, `PORT` and `CORS_ORIGIN` from the environment and does not load a `.env` file. The dev values are in `api/.env.example`:

   ```sh
   set -a; . api/.env.example; set +a
   go -C api run .
   ```

3. Start the web app. It reads `VITE_API_URL` (see `web/.env.example`):

   ```sh
   cp web/.env.example web/.env
   pnpm -C web install
   pnpm -C web dev
   ```

   Open http://localhost:5173.

After a schema change, recreate the database with `docker compose -f api/compose.yaml down -v`.

## Checks

The api tests use the same database and need `DATABASE_URL` set.

```sh
gofmt -l api
go -C api vet ./...
go -C api build ./...
go -C api test ./...

pnpm -C web lint
pnpm -C web typecheck
pnpm -C web test
pnpm -C web build
pnpm -C web e2e
```

The e2e suite uses Playwright. It starts its own api on port 8787 and web server on port 5183, and needs the dev database running.
