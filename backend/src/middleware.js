// Auth middleware: resolves the current user from a Bearer session token.
import { sha256Hex } from './lib/crypto.js';

/**
 * Look up the user for the request's `Authorization: Bearer <token>` header.
 * Returns the user row ({ id, email, role }) or null.
 */
export async function getSessionUser(c) {
  const header = c.req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1].trim());
  const user = await c.env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, u.role AS role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(tokenHash, Date.now())
    .first();

  return user || null;
}

/** Reject the request unless a valid session is present; attaches c.get('user'). */
export const authMiddleware = async (c, next) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  c.set('user', user);
  await next();
};

/** Reject the request unless the authenticated user is an admin. Run after authMiddleware. */
export const adminMiddleware = async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);
  await next();
};
