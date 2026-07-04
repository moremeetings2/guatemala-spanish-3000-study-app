// Account routes: signup, login, logout, and current-user lookup.
import { Hono } from 'hono';
import { hashPassword, verifyPassword, randomToken, sha256Hex } from '../lib/crypto.js';
import { authMiddleware } from '../middleware.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_PASSWORD_LENGTH = 8;

const app = new Hono();

const isEmail = (value) =>
  typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && value.length <= 254;

async function createSession(env, userId) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(tokenHash, userId, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

// POST /api/auth/signup — create an account and return a session token.
app.post('/signup', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !isEmail(body.email) || typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `A valid email and a password of at least ${MIN_PASSWORD_LENGTH} characters are required.` }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'An account with that email already exists.' }, 409);

  const { salt, hash } = await hashPassword(body.password);
  const id = crypto.randomUUID();
  const adminEmail = (c.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const role = adminEmail && email === adminEmail ? 'admin' : 'user';

  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, email, hash, salt, role, Date.now())
    .run();

  const token = await createSession(c.env, id);
  return c.json({ token, user: { id, email, role } }, 201);
});

// POST /api/auth/login — verify credentials and return a session token.
app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !isEmail(body.email) || typeof body.password !== 'string') {
    return c.json({ error: 'Email and password are required.' }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  // Always run the verify to keep timing consistent whether or not the user exists.
  const ok = user
    ? await verifyPassword(body.password, user.password_salt, user.password_hash)
    : await verifyPassword(body.password, '00', 'ff');
  if (!user || !ok) return c.json({ error: 'Invalid email or password.' }, 401);

  const token = await createSession(c.env, user.id);
  return c.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

// POST /api/auth/logout — invalidate the presented session token.
app.post('/logout', authMiddleware, async (c) => {
  const match = (c.req.header('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (match) {
    const tokenHash = await sha256Hex(match[1].trim());
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return c.json({ ok: true });
});

// GET /api/auth/me — return the current user.
app.get('/me', authMiddleware, (c) => c.json({ user: c.get('user') }));

export default app;
