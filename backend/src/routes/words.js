// Flashcard word routes: public read, admin create/update/delete.
import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware.js';

const app = new Hono();

/** Map a DB row to the shape the study app consumes. */
function rowToWord(r) {
  return {
    id: r.id,
    deck: r.deck,
    type: r.type,
    band: r.band,
    rank: r.rank,
    es: r.es,
    en: r.en,
    pos: r.pos,
    synonyms: r.synonyms ? safeParse(r.synonyms, []) : [],
    sentence: r.sentence_es ? { es: r.sentence_es, en: r.sentence_en || '' } : null,
    data: r.data ? safeParse(r.data, null) : null,
    updatedAt: r.updated_at,
  };
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// GET /api/words — public. Optional ?deck=<id> filter.
app.get('/', async (c) => {
  const deck = c.req.query('deck');
  const query = deck
    ? c.env.DB.prepare('SELECT * FROM words WHERE deck = ? ORDER BY rank IS NULL, rank, id').bind(deck)
    : c.env.DB.prepare('SELECT * FROM words ORDER BY deck, rank IS NULL, rank, id');
  const { results } = await query.all();
  return c.json({ words: results.map(rowToWord) });
});

// GET /api/words/decks — public. Card counts per deck.
app.get('/decks', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT deck, COUNT(*) AS count FROM words GROUP BY deck ORDER BY deck'
  ).all();
  return c.json({ decks: results });
});

// POST /api/words — admin. Create a flashcard.
app.post('/', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);
  const invalid = validateWord(body);
  if (invalid) return c.json({ error: invalid }, 400);

  const now = Date.now();
  const id = (body.id && String(body.id).trim()) || `admin-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const exists = await c.env.DB.prepare('SELECT id FROM words WHERE id = ?').bind(id).first();
  if (exists) return c.json({ error: `A word with id "${id}" already exists.` }, 409);

  await c.env.DB.prepare(
    `INSERT INTO words (id, deck, type, band, rank, es, en, pos, synonyms, sentence_es, sentence_en, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.deck || 'mainWords',
      body.type || 'word',
      body.band || null,
      Number.isFinite(body.rank) ? body.rank : null,
      String(body.es).trim(),
      String(body.en).trim(),
      body.pos ? String(body.pos).trim() : null,
      JSON.stringify(Array.isArray(body.synonyms) ? body.synonyms : []),
      body.sentence?.es ? String(body.sentence.es).trim() : null,
      body.sentence?.en ? String(body.sentence.en).trim() : null,
      body.data ? JSON.stringify(body.data) : null,
      now,
      now
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM words WHERE id = ?').bind(id).first();
  return c.json({ word: rowToWord(row) }, 201);
});

// PUT /api/words/:id — admin. Update an existing flashcard.
app.put('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM words WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Word not found.' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const merged = {
    deck: body.deck ?? existing.deck,
    type: body.type ?? existing.type,
    band: body.band ?? existing.band,
    rank: Number.isFinite(body.rank) ? body.rank : existing.rank,
    es: body.es != null ? String(body.es).trim() : existing.es,
    en: body.en != null ? String(body.en).trim() : existing.en,
    pos: body.pos != null ? String(body.pos).trim() : existing.pos,
    synonyms: Array.isArray(body.synonyms) ? JSON.stringify(body.synonyms) : existing.synonyms,
    sentence_es: body.sentence !== undefined ? (body.sentence?.es || null) : existing.sentence_es,
    sentence_en: body.sentence !== undefined ? (body.sentence?.en || null) : existing.sentence_en,
    data: body.data !== undefined ? (body.data ? JSON.stringify(body.data) : null) : existing.data,
  };
  if (!merged.es || !merged.en) return c.json({ error: 'Spanish (es) and English (en) cannot be empty.' }, 400);

  await c.env.DB.prepare(
    `UPDATE words SET deck=?, type=?, band=?, rank=?, es=?, en=?, pos=?, synonyms=?, sentence_es=?, sentence_en=?, data=?, updated_at=?
     WHERE id = ?`
  )
    .bind(
      merged.deck, merged.type, merged.band, merged.rank, merged.es, merged.en, merged.pos,
      merged.synonyms, merged.sentence_es, merged.sentence_en, merged.data, Date.now(), id
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM words WHERE id = ?').bind(id).first();
  return c.json({ word: rowToWord(row) });
});

// DELETE /api/words/:id — admin.
app.delete('/:id', authMiddleware, adminMiddleware, async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('DELETE FROM words WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'Word not found.' }, 404);
  return c.json({ ok: true, id });
});

/** Returns an error message string if the body is invalid, else null. */
function validateWord(body) {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';
  if (!body.es || !String(body.es).trim()) return 'Spanish text (es) is required.';
  if (!body.en || !String(body.en).trim()) return 'English text (en) is required.';
  if (body.synonyms && !Array.isArray(body.synonyms)) return 'synonyms must be an array of strings.';
  return null;
}

export default app;
