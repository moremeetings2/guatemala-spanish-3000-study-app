// Per-user progress sync: read the user's cardState, and upsert batches of it.
import { Hono } from 'hono';
import { authMiddleware } from '../middleware.js';

const MAX_CARDS_PER_REQUEST = 5000;
const BATCH_SIZE = 50; // keep each D1 batch small enough to stay well within limits

const app = new Hono();

// GET /api/progress — the authenticated user's full cardState map.
app.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare('SELECT * FROM progress WHERE user_id = ?').bind(user.id).all();
  const cardState = {};
  for (const r of results) {
    cardState[r.card_id] = {
      state: r.state,
      due: r.due,
      seen: !!r.seen,
      correct: r.correct,
      wrong: r.wrong,
      weak: !!r.weak,
      star: !!r.star,
    };
  }
  return c.json({ cardState });
});

// PUT /api/progress — upsert a batch of cardState entries for the user.
app.put('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const cardState = body && body.cardState;
  if (!cardState || typeof cardState !== 'object') {
    return c.json({ error: 'A cardState object is required.' }, 400);
  }

  const entries = Object.entries(cardState).slice(0, MAX_CARDS_PER_REQUEST);
  const now = Date.now();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const statements = chunk.map(([cardId, s]) =>
      c.env.DB.prepare(
        `INSERT INTO progress (user_id, card_id, state, due, seen, correct, wrong, weak, star, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, card_id) DO UPDATE SET
           state=excluded.state, due=excluded.due, seen=excluded.seen,
           correct=excluded.correct, wrong=excluded.wrong, weak=excluded.weak,
           star=excluded.star, updated_at=excluded.updated_at`
      ).bind(
        user.id,
        String(cardId),
        s.state || 'new',
        Number.isFinite(s.due) ? s.due : null,
        s.seen ? 1 : 0,
        s.correct || 0,
        s.wrong || 0,
        s.weak ? 1 : 0,
        s.star ? 1 : 0,
        now
      )
    );
    if (statements.length) await c.env.DB.batch(statements);
  }

  return c.json({ ok: true, saved: entries.length });
});

export default app;
