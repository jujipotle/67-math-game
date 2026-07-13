# 67 — Card Math Puzzle Game

A full-stack number puzzle game built with Next.js. Combine playing-card values with `+ − × ÷` to reach a target number. Supports untimed **practice** mode (fully client-side) and a competitive **5-minute sprint** mode with server-tracked scoring and a persistent leaderboard.

Deployed on Vercel with Neon Postgres in production; SQLite locally when no database URL is configured.

---

## Table of contents

- [Game rules](#game-rules)
- [Architecture](#architecture)
- [How the app works](#how-the-app-works)
- [Technical challenges](#technical-challenges)
- [Security](#security)
- [API reference](#api-reference)
- [Database schema](#database-schema)
- [Environment variables](#environment-variables)
- [Development and deployment](#development-and-deployment)
- [Repository file reference](#repository-file-reference)

---

## Game rules

Each puzzle provides a **target** (1–200) and a hand of **card values** drawn from a standard 52-card deck (ranks 1–13, four of each). The player selects two live tiles, applies an operator, and merges them into one. This repeats until a single tile remains.

| Target range | Cards dealt |
|---|---|
| 1–66 | 4 |
| 67–133 | 5 |
| 134–200 | 6 |

A puzzle is **solved** when exactly one tile remains and its value equals the target. Division must produce integer results at every step (enforced by rational arithmetic). Each card value must be used exactly once.

### Practice mode

- Untimed count-up timer.
- Puzzles generated entirely in the browser.
- Session history saved to `localStorage`.
- No server communication.

### Sprint mode

- 5-minute countdown timer.
- Server creates a session and tracks the official solve count.
- Puzzles are generated client-side but **registered** with the server before play and **marked** (solved/skipped) after each puzzle.
- **Balanced band rotation**: targets cycle through three bands (1–66 / 67–133 / 134–200). The band advances only on solve; skipping keeps the same band so players cannot skip until an easy target appears.
- Skip penalty: **−20 seconds**.
- After the sprint, the player may submit their name to the leaderboard. The score comes from the server's solve count, not the client.

Two leaderboard boards exist: **`new`** (balanced sprint, current scoring) and **`old`** (legacy entries from before band rotation was introduced). New submissions always go to `new`.

---

## Architecture

```
Browser (React client)
├── page.tsx          — game state, screens, timers, API calls
├── components/       — UI fragments
├── lib/              — puzzle engine (generator, solver, rational math)
├── workers/          — Web Workers for heavy computation
└── localStorage      — practice session history

Next.js API routes (Node.js runtime)
├── /api/sprint/*     — session lifecycle
└── /api/leaderboard  — read / submit / admin CRUD

Database
├── Neon Postgres     — production (DATABASE_URL or POSTGRES_URL)
└── SQLite            — local dev (data/leaderboard.db)
```

The app is a single Next.js 16 project (App Router, React 19, TypeScript, Tailwind CSS 4). There is no separate backend service. All API routes declare `export const runtime = "nodejs"` because the SQLite fallback uses `better-sqlite3`, which requires Node.js.

---

## How the app works

### Screen flow

`page.tsx` drives navigation through a `screen` state: `home → play → review → summary → leaderboard`. The same component handles both game modes; `mode` (`practice` | `sprint`) determines timer behavior and whether server APIs are called.

### Puzzle generation (`lib/generator.ts`)

1. Pick a random target (or a target within a sprint band).
2. Determine card count from the target range.
3. Shuffle the 52-card deck and take the first *n* cards.
4. Call `hasSolution()` to verify solvability; retry up to 500 shuffles per goal, 10 goals total.
5. Fall back to `{ goal: 24, cards: [1, 2, 3, 4] }` if generation fails.

Sprint mode uses `generateSprintPuzzle(band)` to constrain the target to a specific range.

### Gameplay loop

1. Board initialized with `n` live tiles (up to 6 slots; unused slots are dead).
2. Player selects tile → operator → second tile. Each merge pushes onto undo/reset stacks.
3. On win (one tile equals goal): stop timer, record the solve, show review screen.
4. Review shows the player's expression and all canonical solutions (computed asynchronously).
5. Continue loads the next puzzle; skip marks the puzzle skipped and applies the penalty.

Keyboard shortcuts are supported for operators, undo (Backspace), reset (R), skip (S), and continue (Space on review).

### Sprint session lifecycle

```
POST /api/sprint/start
  → { sessionId, endsAt }

POST /api/sprint/register  { sessionId, idx, goal, cards }
  → puzzle row created with status "issued"

POST /api/sprint/mark  { sessionId, idx, outcome, finalExpr? }
  → server validates solution, updates solve count, deducts time

POST /api/leaderboard  { sessionId, name }
  → score read from sprint_sessions.solved, entry inserted
```

The client generates puzzles locally and tells the server what it is about to play. The server stores that registration and validates the final expression on mark. The score stored for leaderboard submission is always `sprint_sessions.solved` in the database.

### Timer model

Two clocks run in parallel during sprint:

| Clock | Mechanism |
|---|---|
| **Client** | `sprintRemainingMs` decremented every 100ms while `timerRunning` is true. Paused on review. Capped at 2s per tick to handle background-tab throttling. |
| **Server** | Time budget stored as `endsAt - startedAt`. Deducted per puzzle on mark: `timeOnPuzzle = now - issuedAt`, plus 20s on skip. |

The client timer is for display; the server budget is authoritative for whether marks are accepted. They are initialized together at sprint start but not continuously synced afterward.

---

## Technical challenges

### Exact arithmetic with rational numbers

Floating-point math introduces errors (`0.1 + 0.2 ≠ 0.3`). All tile values are stored as exact rationals (`{ n: bigint, d: bigint }`) in `lib/rational.ts`. Operations normalize via GCD after every step. Division returns `null` when the divisor is zero or the result is non-integer.

This ensures gameplay, solvability checks, and server-side validation all agree on whether a value matches the goal.

### Brute-force solver performance

Finding all solutions is exponential in card count. `lib/solver.ts` (~900 lines) implements:

- Recursive search over all binary operation trees.
- Early termination in `hasSolution()` (generation only needs to know if *any* solution exists).
- Full enumeration in `solve()` for the review screen.
- Expression parsing, AST evaluation, and extensive **canonicalization** so equivalent expressions collapse to one preferred form (parentheses, term ordering, etc.).

Six-card puzzles are significantly more expensive than four-card ones.

### Keeping the UI responsive: Web Workers

Solver and generator work runs in **Web Workers** (`src/workers/puzzle.worker.ts`) so the main thread stays interactive. Two worker instances are used:

| Worker | Purpose |
|---|---|
| **Main** (`workerRef`) | `solveAll` for the current puzzle |
| **Background** (`bgWorkerRef`) | `preGenerate` for the practice puzzle queue; `solveAll` for past puzzles on the review/summary screens |

The main worker is never used for pre-generation. Background solution jobs are deferred while the current puzzle's solutions are still computing. If workers fail to initialize, the code falls back to `setTimeout` on the main thread.

A **puzzle queue** (target depth: 4) pre-generates practice puzzles so the next puzzle loads instantly.

### Dual database layer

`lib/db.ts` abstracts over Neon Postgres (production) and SQLite (local). The selection is automatic:

```ts
const useNeon = !!process.env.DATABASE_URL || !!process.env.POSTGRES_URL;
```

Both backends share the same logical schema. Schema initialization runs on first connection (including a safe `ALTER TABLE` backfill for the `kind` column on older Neon databases). All queries use parameterized statements (Neon tagged templates; SQLite prepared statements).

### Leaderboard: top 50 scores, not top 50 rows

The leaderboard query uses `DENSE_RANK() OVER (ORDER BY score DESC)` to select the top 50 **distinct score values**, returning every entry tied at a qualifying score. A tier with many ties can produce more than 50 total rows. Within a tier, entries are ordered by earliest submission (`createdAt ASC`).

The UI (`LeaderboardView`) groups entries into score tiers and shows the top 3 tiers expanded by default; lower tiers are collapsible.

### PWA support

`public/manifest.json` and metadata in `layout.tsx` configure installability and Apple web app behavior. Icons are generated dynamically via `icon.tsx` and `apple-icon.tsx` (Next.js metadata routes).

---

## Security

### What is protected

| Concern | Approach |
|---|---|
| **Leaderboard score tampering** | Score is read from `sprint_sessions.solved` in the database, never from the client request body. |
| **Server-generated sprint puzzles** | Sprint puzzles are generated on the server (`generateSprintPuzzle()` via `/api/sprint/start` and `/api/sprint/next`) and stored in `sprint_puzzles`. The client cannot choose the goal or cards, so it can't seed trivially easy puzzles. The old client registration endpoint (`/api/sprint/register`) is disabled and returns `410 Gone`. |
| **Server-authoritative difficulty band** | The sprint band (1–66 / 67–133 / 134–200) is tracked on `sprint_sessions.band`. It advances only when a puzzle is solved and stays put on a skip, enforced entirely on the server so the client can't hunt for easier targets. |
| **Fake solves** | `validateFinalExpr()` on the server parses the expression, verifies each card is used exactly once, and checks the result equals the goal — against the server-generated puzzle. |
| **Double submission** | `sprint_sessions.submitted` flag; second POST returns 409. |
| **Double scoring** | Mark endpoint is idempotent per puzzle: if status is not `issued`, it returns `{ ok: true }` without incrementing. |
| **SQL injection** | Parameterized queries throughout `db.ts`. |
| **Offensive leaderboard names** | `LEADERBOARD_BLOCKED_TERMS` env var; terms are not stored in the repo. Normalization handles common leet-speak substitutions before substring matching. |
| **Name injection** | Names sanitized to 1–20 chars, `[a-zA-Z0-9 _-]+` only. |
| **Admin endpoints** | DELETE and PATCH require `LEADERBOARD_ADMIN_KEY`; return 501 if unset. |
| **Secrets** | `.env*` and `data/` are gitignored. |

### Known limitations

| Concern | Status |
|---|---|
| **Session authentication** | `sessionId` (UUID) is the only credential. No login, cookies, or signed tokens. Anyone with a session's UUID can drive its puzzles. |
| **Rate limiting** | Not implemented. Endpoints can be called without throttling. |
| **Admin key comparison** | Plain string equality (`!==`), not timing-safe. Key is sent in the JSON body. |
| **Client/server timer drift** | Displayed time and server budget can diverge slightly (network latency on skip, tab throttling, no re-sync after marks). |

### Admin operations

Set `LEADERBOARD_ADMIN_KEY` to a long random string. Admin endpoints:

```bash
# Delete an entry
curl -X DELETE http://localhost:3000/api/leaderboard \
  -H "Content-Type: application/json" \
  -d '{"adminKey":"YOUR_KEY","id":3}'

# Edit an entry
curl -X PATCH http://localhost:3000/api/leaderboard \
  -H "Content-Type: application/json" \
  -d '{"adminKey":"YOUR_KEY","id":3,"name":"Alice","score":12,"kind":"new"}'
```

Entry IDs are returned by `GET /api/leaderboard`. In local development, open [http://localhost:3000/admin](http://localhost:3000/admin) for a GUI to list, edit, and delete entries. Which database it targets (local or production) is controlled by the single **Data source** toggle on the home screen. The admin page and `/api/dev-proxy/*` route return 404 on the deployed site.

---

## API reference

All routes are under `/api/`. All sprint and leaderboard routes use the Node.js runtime.

### `POST /api/sprint/start`

Creates a new 5-minute sprint session and issues the first puzzle server-side (band 0: goal 1–66, 4 cards).

**Request:** empty body.

**Response (200):**
```json
{ "sessionId": "uuid", "endsAt": 1710000000000, "idx": 1, "goal": 42, "cards": [3, 7, 8, 13] }
```

`endsAt` is initially `startedAt + 5 minutes`. As puzzles are marked, the server shrinks the remaining budget and updates `endsAt = startedAt + remainingBudget`. `goal`/`cards` are generated by the server and stored in `sprint_puzzles` with status `issued`.

---

### `POST /api/sprint/next`

Issues the next puzzle for an active session. The server picks the difficulty band (from `sprint_sessions.band`), generates the puzzle, stores it as `issued`, and returns it. The client cannot influence the goal or cards.

**Request body:**
```json
{ "sessionId": "uuid" }
```

**Response (200):**
```json
{ "idx": 2, "goal": 88, "cards": [2, 5, 9, 11, 13], "endsAt": 1710000000000 }
```

**Responses:**

| Status | Meaning |
|---|---|
| 200 | `{ "idx", "goal", "cards", "endsAt" }` |
| 400 | Missing `sessionId` |
| 404 | Invalid session |
| 409 | Already submitted |
| 410 | Session time budget exhausted |

The band advances only when a puzzle is solved (see `mark`), so skipping keeps the same difficulty range.

---

### `POST /api/sprint/register` (disabled)

**Deprecated.** Puzzles used to be generated by the client and registered here, which allowed a scripted client to seed trivial puzzles and inflate its score. Puzzles are now generated server-side. This endpoint always returns `410 Gone`; use `POST /api/sprint/next` instead.

---

### `POST /api/sprint/mark`

Records the outcome of a puzzle.

**Request body:**
```json
{
  "sessionId": "uuid",
  "idx": 1,
  "outcome": "solved",
  "finalExpr": "(13 - 7) * (8 - 3)"
}
```

`finalExpr` is required when `outcome` is `"solved"`. Omit for `"skipped"`.

**Behavior:**

- If the puzzle status is not `issued`, returns `{ ok: true, endsAt }` without re-scoring (idempotent).
- **Solved:** validates `finalExpr` against stored cards/goal; increments `sprint_sessions.solved`; advances `sprint_sessions.band` to the next difficulty range; deducts `now - issuedAt` from the time budget.
- **Skipped:** deducts `now - issuedAt + 20s` from the time budget.

**Responses:**

| Status | Meaning |
|---|---|
| 200 | `{ "ok": true, "endsAt": ... }` |
| 400 | Missing fields, missing `finalExpr`, or invalid solution |
| 404 | Invalid session or puzzle |
| 410 | Session time budget exhausted |

---

### `GET /api/leaderboard`

Returns leaderboard entries.

**Query parameters:**

| Param | Values | Default |
|---|---|---|
| `kind` | `new`, `old` | `new` |

**Response (200):**
```json
{
  "kind": "new",
  "entries": [
    { "id": 1, "name": "Alice", "score": 15, "createdAt": 1710000000000, "kind": "new" }
  ]
}
```

Returns all entries in the top 50 distinct score tiers (including ties). May return more than 50 entries.

---

### `POST /api/leaderboard`

Submits a sprint result to the leaderboard.

**Request body:**
```json
{ "sessionId": "uuid", "name": "Alice" }
```

**Responses:**

| Status | Meaning |
|---|---|
| 200 | `{ "ok": true, "id": 1, "score": 15 }` |
| 400 | Invalid name or blocked term |
| 404 | Invalid session |
| 409 | Already submitted |

Score is always `sprint_sessions.solved` from the database. New entries go to `kind: "new"`.

---

### `DELETE /api/leaderboard` (admin)

**Request body:**
```json
{ "adminKey": "secret", "id": 3 }
```

| Status | Meaning |
|---|---|
| 200 | `{ "ok": true }` |
| 403 | Wrong key or invalid id |
| 404 | Entry not found |
| 501 | `LEADERBOARD_ADMIN_KEY` not configured |

---

### `PATCH /api/leaderboard` (admin)

**Request body:**
```json
{ "adminKey": "secret", "id": 3, "name": "Alice", "score": 12, "kind": "new" }
```

Same auth gate as DELETE. Name must pass sanitization and blocklist. Returns 200, 400, 403, 404, or 501.

---

## Database schema

### `leaderboard_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL / INTEGER PK | Auto-increment |
| `name` | TEXT | Sanitized player name |
| `score` | INTEGER | Puzzles solved in sprint |
| `createdAt` | BIGINT | Epoch milliseconds |
| `kind` | TEXT | `old` or `new` |

### `sprint_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `startedAt` | BIGINT | Epoch ms |
| `endsAt` | BIGINT | `startedAt + remainingBudget` |
| `solved` | INTEGER | Server-side solve count |
| `submitted` | INTEGER | 0 or 1; leaderboard submitted |

### `sprint_puzzles`

| Column | Type | Notes |
|---|---|---|
| `sessionId` | TEXT | FK to sprint_sessions |
| `idx` | INTEGER | Puzzle number within session |
| `goal` | INTEGER | Target value |
| `cardsJson` | TEXT | JSON array of card values |
| `issuedAt` | BIGINT | When puzzle was registered |
| `status` | TEXT | `issued`, `solved`, or `skipped` |
| `finalExpr` | TEXT | Player's expression (nullable) |

Primary key: `(sessionId, idx)`.

---

## Environment variables

### Local (`.env` file)

Copy `.env.example` → `.env`. You only need two values for day-to-day local work:

| Variable | Required locally? | Purpose |
|---|---|---|
| `LEADERBOARD_ADMIN_KEY` | For `/admin` page | Secret injected server-side by `/api/dev-proxy` (dev only) |
| `LEADERBOARD_BLOCKED_TERMS` | Optional | Name blocklist (same list you'd use in production) |
| `DATABASE_URL` | **Leave unset** | Unset = SQLite at `data/leaderboard.db`. Only set if you intentionally want local dev on production Neon. |

**Data source toggle:** run `npm run dev`, and on the home screen use the single **Local** / **Actual** toggle to choose which database everything reads and writes — playing the game, the leaderboard, and the `/admin` page all follow it. In dev, "Actual" requests are forwarded to the live site through `/api/dev-proxy/*` (which injects the admin key server-side). The toggle is hidden on the live Vercel deployment, where there is only one database.

### Production (Vercel dashboard only)

Vercel does **not** read your local `.env`. Set these in **Vercel → Settings → Environment Variables**:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `LEADERBOARD_BLOCKED_TERMS` | Recommended | Offensive name blocklist |
| `LEADERBOARD_ADMIN_KEY` | Recommended | Must match the key in your local `.env` if you edit production from the local `/admin` page (Data source = Actual) |

---

## Development and deployment

### Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without `DATABASE_URL`, the app creates `data/leaderboard.db` automatically.

### Production

Deploy to Vercel. Set `DATABASE_URL` (e.g. from [Neon](https://neon.tech)), `LEADERBOARD_BLOCKED_TERMS`, and `LEADERBOARD_ADMIN_KEY` in the Vercel project environment variables.

```bash
npm run build
npm start
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Run production server |
| `npm run lint` | ESLint |

---

## Repository file reference

### Root

| File | Purpose |
|---|---|
| `package.json` | Dependencies and scripts |
| `package-lock.json` | Locked dependency versions |
| `tsconfig.json` | TypeScript configuration |
| `next.config.ts` | Next.js configuration (defaults) |
| `postcss.config.mjs` | PostCSS config for Tailwind CSS 4 |
| `eslint.config.mjs` | ESLint configuration |
| `.gitignore` | Ignores `node_modules`, `.next`, `data/`, `.env*`, etc. |

### `public/`

| File | Purpose |
|---|---|
| `manifest.json` | PWA manifest (name, icons, display mode) |
| `icon.svg` | Static icon referenced by the manifest |

### `src/app/` — Next.js App Router

| File | Purpose |
|---|---|
| `page.tsx` | Main application: all screens, game state, timers, keyboard shortcuts, API calls, worker management |
| `admin/page.tsx` | Dev-only leaderboard admin UI (`/admin`; disabled on production) |
| `layout.tsx` | Root layout, fonts (Geist), metadata, PWA config, Vercel Analytics |
| `globals.css` | Global styles, Tailwind import, safe-area CSS variables |
| `icon.tsx` | Dynamic favicon generation (Next.js metadata route) |
| `apple-icon.tsx` | Apple touch icon generation (Next.js metadata route) |

### `src/app/api/` — API routes

| File | Purpose |
|---|---|
| `sprint/start/route.ts` | `POST` — create sprint session and issue puzzle #1 |
| `sprint/next/route.ts` | `POST` — issue next server-generated puzzle |
| `sprint/register/route.ts` | `POST` — disabled (`410`); puzzles are server-generated |
| `sprint/mark/route.ts` | `POST` — mark puzzle solved or skipped |
| `leaderboard/route.ts` | `GET` / `POST` / `DELETE` / `PATCH` — leaderboard CRUD |
| `dev-proxy/[...path]/route.ts` | Dev-only proxy that routes any API call to the local or live database based on the home-screen toggle (`404` in production) |

### `src/components/` — UI components

| File | Purpose |
|---|---|
| `TopBar.tsx` | Header bar: solve count, timer display, quit button |
| `GoalDisplay.tsx` | Target number display |
| `CardGrid.tsx` | Card tile grid with selection state |
| `OpRow.tsx` | Operator button row (`+ − × ÷`) |
| `ReviewPanel.tsx` | Post-puzzle review: player expression, all solutions, continue/skip |
| `SummaryView.tsx` | End-of-session summary with solve/skip history and leaderboard submit form |
| `LeaderboardView.tsx` | Leaderboard display (score / players table) |
| `LeaderboardTable.tsx` | Shared leaderboard table used by home and sprint summary |

### `src/lib/` — Core logic

| File | Purpose |
|---|---|
| `types.ts` | Shared TypeScript types (`Puzzle`, `Tile`, `BoardState`, `Step`, records, modes) |
| `rational.ts` | Exact rational arithmetic (`bigint`), serialization for `localStorage` |
| `solver.ts` | Brute-force solver, expression parser, canonicalization, `hasSolution()`, `validateFinalExpr()` |
| `generator.ts` | Random puzzle generation from a 52-card deck; sprint band constraints |
| `db.ts` | Database abstraction (Neon + SQLite), schema init, all persistence operations |
| `storage.ts` | Practice session persistence in `localStorage` |
| `blocklist.ts` | Env-driven offensive-name filter with normalization |
| `dataSource.tsx` | React context for the dev-only Local/Actual data-source toggle (persisted to `localStorage`) |
| `api.ts` | `buildApiUrl()` — routes API calls to local or production via the dev proxy |

### `src/workers/`

| File | Purpose |
|---|---|
| `puzzle.worker.ts` | Web Worker: `preGenerate` (puzzle queue) and `solveAll` (solution enumeration) |

### Runtime (not in repo)

| Path | Purpose |
|---|---|
| `data/leaderboard.db` | SQLite database created automatically in local dev (gitignored) |
