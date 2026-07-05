// My Words: per-user custom vocabulary CRUD. Every route requires auth and is
// scoped to the requesting user — one user can never see or touch another's
// words. These surface in the app as the private "My Words" deck.
import { Hono } from 'hono';
import { authMiddleware } from '../middleware.js';

// Product rule: generous personal cap so the free tier stays sustainable and a
// runaway client can't bloat the database.
const MAX_WORDS_PER_USER = 500;
const MAX_FIELD_LEN = 300;

const app = new Hono();

/** Map a DB row to the card shape the study app consumes (mirrors words.js). */
function rowToWord(r) {
  return {
    id: r.id,
    deck: 'myWords',
    type: 'word',
    es: r.es,
    en: r.en,
    pos: r.pos,
    synonyms: [],
    sentence: r.sentence_es ? { es: r.sentence_es, en: r.sentence_en || '' } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Returns an error message string if the body is invalid, else null. */
function validate(body) {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';
  if (!body.es || !String(body.es).trim()) return 'Spanish text (es) is required.';
  if (!body.en || !String(body.en).trim()) return 'English text (en) is required.';
  for (const f of ['es', 'en', 'pos']) {
    if (body[f] && String(body[f]).length > MAX_FIELD_LEN) return `${f} is too long (max ${MAX_FIELD_LEN} characters).`;
  }
  if (body.sentence) {
    for (const f of ['es', 'en']) {
      if (body.sentence[f] && String(body.sentence[f]).length > MAX_FIELD_LEN) {
        return `sentence.${f} is too long (max ${MAX_FIELD_LEN} characters).`;
      }
    }
  }
  return null;
}

// GET /api/my-words — the authenticated user's custom words.
app.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM user_words WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return c.json({ words: results.map(rowToWord), max: MAX_WORDS_PER_USER });
});

// POST /api/my-words — add a custom word for the authenticated user.
app.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const invalid = validate(body);
  if (invalid) return c.json({ error: invalid }, 400);

  const { count } = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM user_words WHERE user_id = ?'
  ).bind(user.id).first();
  if (count >= MAX_WORDS_PER_USER) {
    return c.json({ error: `You've reached the ${MAX_WORDS_PER_USER}-word limit for My Words.` }, 409);
  }

  const es = String(body.es).trim();
  const dupe = await c.env.DB.prepare(
    'SELECT id FROM user_words WHERE user_id = ? AND es = ? COLLATE NOCASE'
  ).bind(user.id, es).first();
  if (dupe) return c.json({ error: `"${es}" is already in your My Words.` }, 409);

  const now = Date.now();
  const id = `mine-${now}-${Math.random().toString(36).slice(2, 8)}`;
  await c.env.DB.prepare(
    `INSERT INTO user_words (id, user_id, es, en, pos, sentence_es, sentence_en, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    user.id,
    es,
    String(body.en).trim(),
    body.pos ? String(body.pos).trim() : null,
    body.sentence?.es ? String(body.sentence.es).trim() : null,
    body.sentence?.en ? String(body.sentence.en).trim() : null,
    now,
    now
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM user_words WHERE id = ?').bind(id).first();
  return c.json({ word: rowToWord(row) }, 201);
});

// PUT /api/my-words/:id — update one of the user's own words.
app.put('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    'SELECT * FROM user_words WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first();
  if (!existing) return c.json({ error: 'Word not found.' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const merged = {
    es: body.es != null ? String(body.es).trim() : existing.es,
    en: body.en != null ? String(body.en).trim() : existing.en,
    pos: body.pos !== undefined ? (body.pos ? String(body.pos).trim() : null) : existing.pos,
    sentence_es: body.sentence !== undefined ? (body.sentence?.es ? String(body.sentence.es).trim() : null) : existing.sentence_es,
    sentence_en: body.sentence !== undefined ? (body.sentence?.en ? String(body.sentence.en).trim() : null) : existing.sentence_en,
  };
  if (!merged.es || !merged.en) return c.json({ error: 'Spanish (es) and English (en) cannot be empty.' }, 400);

  await c.env.DB.prepare(
    'UPDATE user_words SET es=?, en=?, pos=?, sentence_es=?, sentence_en=?, updated_at=? WHERE id = ? AND user_id = ?'
  ).bind(merged.es, merged.en, merged.pos, merged.sentence_es, merged.sentence_en, Date.now(), id, user.id).run();

  const row = await c.env.DB.prepare('SELECT * FROM user_words WHERE id = ?').bind(id).first();
  return c.json({ word: rowToWord(row) });
});

// DELETE /api/my-words/:id — remove one of the user's own words.
app.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'DELETE FROM user_words WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();
  if (!result.meta.changes) return c.json({ error: 'Word not found.' }, 404);
  return c.json({ ok: true, id });
});

export default app;
