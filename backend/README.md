# Spanish 3000 — Backend API

Cloudflare Workers + D1 backend for the study app. Provides:

- **Accounts** — email + password signup/login, session tokens, an **admin** role
- **Word management** — public read; admin create / update / delete of flashcards
- **Progress sync** — each user's spaced-repetition progress, saved server-side

The frontend (the existing PWA) stays on GitHub Pages and calls this API.

## Stack

| Piece | What it is |
|---|---|
| Cloudflare Workers | The serverless API (runs `src/index.js`) |
| Cloudflare D1 | Serverless SQLite database (`users`, `sessions`, `words`, `progress`) |
| Hono | Tiny web framework for the routes |

Passwords are stored as PBKDF2-SHA256 (per-user salt). Session tokens are random
and stored **hashed** — the raw token only lives on the client, sent as
`Authorization: Bearer <token>`.

## API endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | liveness + DB check |
| GET | `/api/words` | public | all words (optional `?deck=`) |
| GET | `/api/words/decks` | public | card counts per deck |
| POST | `/api/words` | admin | add a flashcard |
| PUT | `/api/words/:id` | admin | edit a flashcard |
| DELETE | `/api/words/:id` | admin | delete a flashcard |
| POST | `/api/auth/signup` | public | create account → `{ token, user }` |
| POST | `/api/auth/login` | public | log in → `{ token, user }` |
| POST | `/api/auth/logout` | user | invalidate the current token |
| GET | `/api/auth/me` | user | current user |
| GET | `/api/progress` | user | this user's `cardState` |
| PUT | `/api/progress` | user | upsert `{ cardState: { ... } }` |

## One-time deploy (run these on your machine)

Prerequisites: a Cloudflare account with the **Workers Paid** plan, and Node.js.

```bash
cd backend
npm install
npx wrangler login                       # opens a browser to authorize

# 1. Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create spanish3000

# 2. Create the tables (remote)
npm run db:migrate

# 3. Set the admin email — the account that signs up with THIS email becomes admin
npx wrangler secret put ADMIN_EMAIL      # enter e.g. moremeetings2@gmail.com

# 4. Build and load the catalog (3,599 cards) into the database
npm run build:seed
npm run db:seed

# 5. Deploy
npm run deploy
```

`wrangler deploy` prints your API URL (e.g. `https://spanish3000-api.<you>.workers.dev`).
Confirm it's alive:

```bash
curl https://spanish3000-api.<you>.workers.dev/api/health   # -> {"ok":true}
```

Then sign up **once** with your admin email to claim the admin account:

```bash
curl -X POST https://spanish3000-api.<you>.workers.dev/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"moremeetings2@gmail.com","password":"<a strong password>"}'
```

## Local development (no Cloudflare account needed)

```bash
cd backend
npm install
printf 'ADMIN_EMAIL=admin@example.com\n' > .dev.vars   # local-only, git-ignored
npm run build:seed
npm run db:migrate:local
npm run db:seed:local
npm run dev                                             # http://localhost:8787
```

## Notes

- `seed.sql` is generated from `../data/*.json` by `npm run build:seed` and is
  git-ignored — regenerate it whenever the source data changes.
- `npm audit` flags issues in **wrangler's** dev dependencies (undici/ws). Those
  are local tooling only and are not bundled into the deployed Worker (which uses
  only Hono).
- Coming next: frontend login UI + progress sync (Phase 2–3), the admin
  add-word screen (Phase 4), and Google Drive backups (Phase 5).
