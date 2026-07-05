// Spanish 3000 API — Cloudflare Worker entrypoint.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth.js';
import wordRoutes from './routes/words.js';
import progressRoutes from './routes/progress.js';
import myWordsRoutes from './routes/myWords.js';

const app = new Hono();

// CORS: only the configured study-app origins may call the API from a browser.
app.use('*', (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : allowed[0] || ''),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })(c, next);
});

app.get('/', (c) => c.json({ ok: true, service: 'spanish3000-api', version: '0.1.0' }));

// Health check that also confirms the D1 binding is reachable.
app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

app.route('/api/auth', authRoutes);
app.route('/api/words', wordRoutes);
app.route('/api/progress', progressRoutes);
app.route('/api/my-words', myWordsRoutes);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
