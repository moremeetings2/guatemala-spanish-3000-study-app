'use strict';

// Backend API client for the Spanish 3000 app.
// The base URL can be overridden for local development, e.g.:
//   localStorage.setItem('spanishApiBase', 'http://localhost:8787')
const API_BASE = (
  (typeof localStorage !== 'undefined' && localStorage.getItem('spanishApiBase')) ||
  'https://spanish3000-api.john-moore.workers.dev'
).replace(/\/+$/, '');

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Network error — check your connection.', 0);
  }

  let data = null;
  try { data = await res.json(); } catch (e) {}

  if (!res.ok) {
    throw new ApiError((data && data.error) || `Request failed (${res.status}).`, res.status);
  }
  return data;
}

// Global API surface used by app.js (plain-script globals, no bundler).
window.API = {
  base: API_BASE,
  signup: (email, password) => apiFetch('/api/auth/signup', { method: 'POST', body: { email, password } }),
  login: (email, password) => apiFetch('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: (token) => apiFetch('/api/auth/logout', { method: 'POST', token }),
  me: (token) => apiFetch('/api/auth/me', { token }),
  getProgress: (token) => apiFetch('/api/progress', { token }),
  putProgress: (token, cardState) => apiFetch('/api/progress', { method: 'PUT', token, body: { cardState } }),
};
window.ApiError = ApiError;
