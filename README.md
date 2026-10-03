# road-to-english

A web app for daily English practice, built for Vietnamese speakers.

- Lesson library: shadow each sentence along with its video, with optional Vietnamese translation and a pronunciation check.
- Dictation and fill-in-the-blank quizzes, plus guided shadowing.
- Learn mode (Shadow Gate): in guided shadowing, each word you say is scored clear, close or missed, and the next sentence unlocks at 70 points, with three skips per lesson and keyboard shortcuts.
- Video lessons caption the clip that played, with its Vietnamese translation.
- A recording is drawn as a waveform and scored by its sound: your pace against the lesson's target, and long pauses mid-sentence.
- A "How it works" page at `#/about`.
- Import your own text as a lesson.
- Save words and sentences as cards and review them with spaced repetition.
- Everything is stored on your device. Sign in to sync with an account, or export a backup file.

The project is pre-launch. Data may be reset at any time.

## Stack

- `api/`: Go (`net/http`), Postgres through pgx.
- `web/`: Vite, React 19, StyleX and Astryx. Device storage uses IndexedDB.

## Run with one command

With Docker only, start the database, API and web app together:

```sh
docker compose up --build
```

Open http://localhost:5173 (the API is on port 8080). This runs a production build served by nginx (`web/nginx.conf`: hashed assets cached for a year, the app shell revalidated on every load, gzip and security headers), without live reload; stop it with `docker compose down`, and add `-v` to wipe its data.

## Run locally for development

Requirements: Go 1.26 or newer, Node with pnpm, and Docker.

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

GitHub Actions runs these on every pull request and on `main` (`.github/workflows/ci.yml`), except the macOS-only `visual.spec.ts`. That one runs on a macOS runner (`.github/workflows/visual.yml`) and compares screenshots with the baselines in `web/e2e/visual.spec.ts-snapshots`. After an intended visual change, add the `update-visuals` label to the pull request: the workflow regenerates the baselines, commits them to the branch and removes the label. It then starts CI and the comparison on that commit itself, since a commit made by the workflow does not start workflows on its own.

The api tests use the same database and need `DATABASE_URL` set.

On a fresh machine, install the e2e browser first with `pnpm -C web exec playwright install chromium`.

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

## Third-party data

The stress marks use the CMU Pronouncing Dictionary (CMUdict), licensed BSD-2-Clause. `NOTICE` has the attribution.
