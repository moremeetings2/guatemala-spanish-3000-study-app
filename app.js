'use strict';

// ===== Constants =====
const STORAGE_KEY = 'spanishStudyApp.v1';
const AUTH_KEY = 'spanishAuth.v1';
const OLD_PROGRESS_KEY = 'guatemala-spanish-3000-progress-v2';
const DAY_MS = 86400000;
const DATA_URL = './data/guatemala_spanish_study_pack.json';

const DECK_DEFS = {
  mainWords:                { name: 'Main 3000',          short: '3000',     accent: '#28b573', icon: 'dictionary' },
  coffeePhrases:            { name: 'Coffee Phrases',     short: 'Coffee',   accent: '#f5a524', icon: 'local_cafe' },
  conversationVerbs:        { name: 'Conversation',       short: 'Verbs',    accent: '#5560e0', icon: 'record_voice_over' },
  everydayGuatemalaPhrases: { name: 'Everyday Phrases',   short: 'Everyday', accent: '#c23b9e', icon: 'chat' },
  guatemalaBonus:           { name: 'Guatemala Notes',    short: 'Notes',    accent: '#e0843c', icon: 'flag' },
  guatemalaLexicon:         { name: 'Guatemalan Lexicon', short: 'Lexicon',  accent: '#2c7a9e', icon: 'menu_book' },
  // Per-user custom vocabulary — private to each account, synced via the API.
  myWords:                  { name: 'My Words',           short: 'Mine',     accent: '#7b64e8', icon: 'edit_note' },
};

// Product rule: personal-deck cap (mirrors the server's MAX_WORDS_PER_USER).
const MY_WORDS_MAX = 500;

const TYPES_DEF = [
  { id: 'word',   label: 'Word' },
  { id: 'phrase', label: 'Phrase' },
  { id: 'bonus',  label: 'Bonus' },
];

const BANDS_DEF = [
  { id: '1K', label: 'Top 1K' },
  { id: '2K', label: 'Top 2K' },
  { id: '3K', label: 'Top 3K' },
];

// ===== Application State =====
let appState = {
  data: null, loaded: false, tab: 'home', route: null,
  readView: 'lib', storyId: null,
  activeWord: null, lookedUp: {}, saved: [], completed: {},
  compSel: null, compAnswered: false,
  study: { idx: 0, flipped: false, order: [], source: 'all' },
  quiz: { phase: 'intro', idx: 0, sel: null, answered: false, score: 0, qs: null, dir: 'es-en', source: 'all' },
  cardState: {},
  browse: { q: '', deck: 'all', type: 'all', state: 'all', band: 'all', session: 'any' },
  lexQ: '', lexCountry: 'guatemala',
  detailId: null,
  settings: { speed: 1, voiceURI: 'auto', theme: 'light' },
  voices: [], canInstall: false, confirmReset: false,
  reviewedToday: 0, streak: 0, toast: null,
  auth: { token: null, user: null },
  authView: 'landing', authEmail: '', authPassword: '', authError: '', authBusy: false,
  landingMore: false, // landing country grid: collapsed (4) vs all 21
  syncing: false,
  // On-device AI tutor.
  chat: { open: false, context: null, messages: [], input: '', busy: false, streaming: '' },
  ai: { status: 'idle', progress: 0, size: 'gemma-4-e2b', error: '' },
  // My Words: the user's private custom deck + the add-word form.
  myWords: [],
  mw: { es: '', en: '', sentEs: '', sentEn: '', busy: false, suggesting: false, error: '' },
};

// Base persona for the on-device AI tutor. Context-specific prompts extend this.
const AI_SYSTEM = "You are Hablavos, a warm, patient, and concise Spanish tutor for an English speaker learning the everyday Spanish spoken in Guatemala. Give clear, practical answers with short example sentences (Spanish followed by the English meaning). Note Guatemalan usage when it matters. Keep replies brief unless the user asks for more detail. If asked something unrelated to Spanish or Guatemala, gently steer back.";

let installPrompt = null;
let saveTimer = null;
let toastTimer = null;
let resetTimer = null;

// ===== Handler Registry =====
let handlers = {};
let hCount = 0;

function h(fn) {
  const id = 'h' + hCount++;
  handlers[id] = fn;
  return `data-h="${id}"`;
}
function hi(fn) {
  const id = 'h' + hCount++;
  handlers[id] = fn;
  return `data-hi="${id}"`;
}
function hc(fn) {
  const id = 'h' + hCount++;
  handlers[id] = fn;
  return `data-hc="${id}"`;
}

// ===== DOM refs =====
const $screen = document.getElementById('screen');
const $content = document.getElementById('content');
const $tabBar = document.getElementById('tab-bar');
const $wordSheet = document.getElementById('word-sheet');
const $chatSheet = document.getElementById('chat-sheet');
const $toastEl = document.getElementById('toast-el');

// ===== Event Delegation =====
document.addEventListener('click', e => {
  const el = e.target.closest('[data-h]');
  if (el) handlers[el.dataset.h]?.();
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-hi]');
  if (el) handlers[el.dataset.hi]?.(e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-hc]');
  if (el) handlers[el.dataset.hc]?.(e);
});
// Enter sends a chat message (Shift+Enter is free for future multiline).
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && e.target?.dataset?.fid === 'chat-input') {
    e.preventDefault();
    if (appState.chat.open) sendChat();
  }
});

// ===== State Management =====
function setState(patch) {
  const next = { ...appState, ...patch };
  const keys = Object.keys(patch);
  const signedOut = !(next.auth && next.auth.user);
  const invisibleSignedOut = keys.length > 0 && keys.every(k => k === 'voices' || k === 'ai' || k === 'syncing');
  appState = next;
  if (!signedOut || !invisibleSignedOut) render();
  if (appState.loaded) schedSave();
}

function setAuthDraft(patch) {
  appState = { ...appState, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'authEmail')) {
    document.querySelectorAll('[data-fid="auth-email"],[data-fid="landing-email"],[data-fid="landing-email-cta"]').forEach(el => {
      if (el !== document.activeElement) el.value = appState.authEmail || '';
    });
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'authPassword')) {
    document.querySelectorAll('[data-fid="auth-password"]').forEach(el => {
      if (el !== document.activeElement) el.value = appState.authPassword || '';
    });
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'authError') && !patch.authError) {
    document.querySelectorAll('[data-auth-error]').forEach(el => { el.hidden = true; });
  }
}

function schedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}

// ===== Navigation =====
function goTab(t) { setState({ tab: t, route: null, activeWord: null }); }
function openBrowse(patch) {
  setState({ route: 'browse', browse: { q: '', deck: 'all', type: 'all', state: 'all', band: 'all', session: 'any', ...patch } });
}
function setBrowse(patch) { setState({ browse: { ...appState.browse, ...patch } }); }

// ===== Data Accessors =====
function cs(id) {
  return appState.cardState[id] || { state: 'new', due: Date.now(), seen: false, correct: 0, wrong: 0, weak: false, star: false };
}

function filterCards(f) {
  const now = Date.now();
  return appState.data.CARDS.filter(c => {
    const s = cs(c.id);
    if (f.deck && f.deck !== 'all' && c.deck !== f.deck) return false;
    if (f.type && f.type !== 'all' && c.type !== f.type) return false;
    if (f.band && f.band !== 'all' && c.band !== f.band) return false;
    if (f.state && f.state !== 'all' && s.state !== f.state) return false;
    if (f.session === 'seen' && !s.seen) return false;
    if (f.session === 'unseen' && s.seen) return false;
    if (f.star && !s.star) return false;
    if (f.weak && !s.weak) return false;
    if (f.due && !(s.seen && s.due <= now)) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!(c.es.toLowerCase().includes(q) || c.en.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

function sourceCards(src) {
  if (src === 'due') return filterCards({ due: true });
  if (src === 'weak') return filterCards({ weak: true });
  if (src === 'starred') return filterCards({ star: true });
  if (src === 'filter') return filterCards(appState.browse);
  if (src && src.startsWith('deck:')) return filterCards({ deck: src.slice(5) });
  return appState.data.CARDS;
}

function orderFor(src) {
  const ids = sourceCards(src).map(c => c.id);
  const sh = shuffleArr(ids.length);
  return sh.map(i => ids[i]);
}

function setStudySource(src) {
  setState({ study: { idx: 0, flipped: false, source: src, order: orderFor(src) } });
}

// ===== Spaced Repetition =====
function seedStates(cards, ex) {
  const out = { ...ex };
  const now = Date.now();
  cards.forEach(c => {
    if (!out[c.id]) out[c.id] = { state: 'new', due: now, seen: false, correct: 0, wrong: 0, weak: false, star: false };
  });
  return out;
}

function grade(id, correct) {
  const m = { ...appState.cardState };
  const c = { ...cs(id) };
  c.seen = true;
  if (correct) {
    c.correct = (c.correct || 0) + 1;
    c.weak = false;
    c.state = c.state === 'new' ? 'learning' : (c.state === 'learning' ? (c.correct >= 3 ? 'known' : 'learning') : 'known');
    c.due = Date.now() + (c.state === 'known' ? 7 : 2) * DAY_MS;
  } else {
    c.wrong = (c.wrong || 0) + 1;
    c.weak = true;
    c.state = 'learning';
    c.due = Date.now();
  }
  m[id] = c;
  setState({ cardState: m, reviewedToday: appState.reviewedToday + 1 });
  queueProgressSync(id);
}

function setProg(id, state) {
  const m = { ...appState.cardState };
  const c = { ...cs(id) };
  c.state = state;
  if (state !== 'new') c.seen = true;
  if (state === 'known') { c.weak = false; c.due = Date.now() + 7 * DAY_MS; }
  else if (state === 'learning') { c.due = Date.now(); }
  else { c.weak = false; c.due = Date.now(); c.seen = false; }
  m[id] = c;
  setState({ cardState: m });
  queueProgressSync(id);
}

function toggleStar(id) {
  const m = { ...appState.cardState };
  const c = { ...cs(id) };
  c.star = !c.star;
  m[id] = c;
  setState({ cardState: m });
  queueProgressSync(id);
}

// ===== Speech =====
function initVoices() {
  const load = () => {
    try {
      const v = (window.speechSynthesis ? speechSynthesis.getVoices() : [])
        .filter(x => /^es/i.test(x.lang)).slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
      setState({ voices: v });
    } catch (e) {}
  };
  load();
  try { if (window.speechSynthesis) speechSynthesis.onvoiceschanged = load; } catch (e) {}
  setTimeout(load, 500);
}

function scoreVoice(voice) {
  const lang = (voice.lang || '').toLowerCase();
  const name = (voice.name || '').toLowerCase();
  let s = 0;
  if (lang === 'es-gt') s += 140; else if (lang === 'es-mx') s += 130;
  else if (lang === 'es-us') s += 120; else if (lang.startsWith('es-')) s += 100;
  else if (lang === 'es') s += 90;
  if (name.includes('siri')) s += 50; if (name.includes('premium')) s += 35;
  if (name.includes('enhanced')) s += 30; if (name.includes('natural')) s += 25;
  if (voice.localService) s += 5;
  return s;
}

function bestVoice() { return appState.voices[0] || null; }

function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'es-GT'; u.rate = appState.settings.speed;
    const uri = appState.settings.voiceURI;
    let voice = uri && uri !== 'auto' ? appState.voices.find(x => x.voiceURI === uri) : null;
    if (!voice) voice = bestVoice();
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  } catch (e) {}
}

// ===== Word Lookup (Reading) =====
function openWord(nrm, display) {
  const d = appState.data.DICT[nrm]; if (!d) return;
  const sid = appState.storyId;
  const lu = { ...appState.lookedUp, [sid]: { ...(appState.lookedUp[sid] || {}), [nrm]: true } };
  setState({ activeWord: { es: display, en: d.en, pos: d.pos }, lookedUp: lu });
}

function saveWord() {
  const w = appState.activeWord; if (!w) return;
  if (appState.saved.some(s => s.es === w.es)) return;
  setState({ saved: [...appState.saved, { es: w.es, en: w.en }] });
  flash('Saved "' + w.es + '" to deck');
}

function normWord(word) { return word.toLowerCase().replace(/[^a-záéíóúüñ]/gi, ''); }

function tokenize(sentence) {
  const re = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g;
  const lu = appState.lookedUp[appState.storyId] || {};
  const toks = []; let last = 0, m;
  while ((m = re.exec(sentence))) {
    if (m.index > last) toks.push({ text: esc(sentence.slice(last, m.index)), plain: true });
    const word = m[0]; const nrm = normWord(word); const d = appState.data.DICT[nrm];
    if (d) {
      const seen = !!lu[nrm];
      const onClick = () => openWord(nrm, word);
      const style = seen
        ? 'background:var(--g-soft);color:var(--g-ink);border-bottom:2px solid #28b573;border-radius:5px;padding:0 3px;cursor:pointer'
        : 'border-bottom:2px dotted rgba(40,181,115,.55);cursor:pointer;color:inherit';
      toks.push({ text: esc(word), tappable: true, onClick, style });
    } else {
      toks.push({ text: esc(word), plain: true });
    }
    last = m.index + word.length;
  }
  if (last < sentence.length) toks.push({ text: esc(sentence.slice(last)), plain: true });
  return toks;
}

// ===== Quiz =====
function buildQuiz() {
  const { CARDS } = appState.data; const dir = appState.quiz.dir;
  let src = sourceCards(appState.quiz.source); if (src.length < 4) src = CARDS;
  const order = shuffleArr(src.length).slice(0, Math.min(8, src.length));
  const qs = order.map(i => {
    const card = src[i];
    const prompt = dir === 'es-en' ? card.es : card.en;
    const correct = dir === 'es-en' ? card.en : card.es;
    const pool = CARDS.filter(c => c.id !== card.id).map(c => dir === 'es-en' ? c.en : c.es);
    const opts = [correct];
    while (opts.length < 4 && pool.length) { const j = (Math.random() * pool.length) | 0; opts.push(pool.splice(j, 1)[0]); }
    for (let x = opts.length - 1; x > 0; x--) { const j = (Math.random() * (x + 1)) | 0; [opts[x], opts[j]] = [opts[j], opts[x]]; }
    return { id: card.id, es: card.es, prompt, options: opts, answer: opts.indexOf(correct) };
  });
  setState({ quiz: { ...appState.quiz, phase: 'play', idx: 0, sel: null, answered: false, score: 0, qs } });
}

function answerQuiz(i) {
  const q = appState.quiz; if (q.answered) return;
  const cur = q.qs[q.idx]; const correct = i === cur.answer;
  grade(cur.id, correct);
  setState({ quiz: { ...appState.quiz, sel: i, answered: true, score: q.score + (correct ? 1 : 0) } });
}

function nextQuiz() {
  const q = appState.quiz;
  if (q.idx + 1 >= q.qs.length) { setState({ quiz: { ...q, phase: 'done' } }); return; }
  setState({ quiz: { ...q, idx: q.idx + 1, sel: null, answered: false } });
}

// ===== Comprehension =====
function answerComp(i) { if (appState.compAnswered) return; setState({ compSel: i, compAnswered: true }); }
function finishStory() { setState({ completed: { ...appState.completed, [appState.storyId]: true }, readView: 'done' }); }

// ===== UI Utilities =====
function flash(msg) {
  setState({ toast: msg }); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 1700);
}

function install() {
  if (installPrompt) { installPrompt.prompt(); installPrompt = null; setState({ canInstall: false }); }
  else { flash('Use Share → Add to Home Screen'); }
}

// ===== Persistence =====
function persistable() {
  const S = appState;
  return {
    cardState: S.cardState, saved: S.saved, completed: S.completed,
    lookedUp: S.lookedUp, storyId: S.storyId, settings: S.settings,
    reviewedToday: S.reviewedToday, streak: S.streak,
    study: { source: S.study.source },
    quiz: { dir: S.quiz.dir, source: S.quiz.source },
    browse: S.browse,
  };
}

function saveState() {
  const o = persistable();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); } catch (e) {}
  idbSet(o);
}

let _idbDb = null;
function idbOpen() {
  if (!_idbDb) _idbDb = new Promise(res => {
    try {
      if (!window.indexedDB) return res(null);
      const r = indexedDB.open('spanishApp', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return _idbDb;
}

async function idbSet(o) {
  try { const db = await idbOpen(); if (!db) return; db.transaction('kv', 'readwrite').objectStore('kv').put(o, 'state'); } catch (e) {}
}

async function idbGet() {
  try {
    const db = await idbOpen(); if (!db) return null;
    return await new Promise(res => {
      const rq = db.transaction('kv', 'readonly').objectStore('kv').get('state');
      rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
    });
  } catch (e) { return null; }
}

async function loadState() {
  let o = await idbGet();
  if (!o) { try { o = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {} }
  if (o) return o;
  // Migrate from old format
  try {
    const raw = JSON.parse(localStorage.getItem(OLD_PROGRESS_KEY));
    const oldProg = raw && raw.value ? raw.value : (raw || null);
    if (oldProg && typeof oldProg === 'object') return { _migrateFrom: oldProg };
  } catch (e) {}
  return null;
}

function migrateOldProgress(oldProg, cards) {
  const now = Date.now(); const out = {};
  cards.forEach(c => {
    const old = oldProg[c.id]; if (!old) return;
    out[c.id] = {
      state: old.status || 'new',
      due: old.dueAt ? (Date.parse(old.dueAt) || now) : now,
      seen: (old.reviewCount || 0) > 0 || (old.quizSeen || 0) > 0,
      correct: old.quizCorrect || 0, wrong: old.wrongCount || 0,
      weak: old.status === 'learning' || old.lastOutcome === 'incorrect',
      star: Boolean(old.favorite),
    };
  });
  return out;
}

function exportJSON() {
  try {
    const blob = new Blob([JSON.stringify(persistable(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'spanish-progress.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash('Progress exported');
  } catch (e) { flash('Export failed'); }
}

function importJSON(e) {
  const file = e.target.files?.[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const o = JSON.parse(r.result);
      setState({ cardState: { ...appState.cardState, ...(o.cardState || {}) }, saved: o.saved || appState.saved, completed: o.completed || appState.completed, lookedUp: o.lookedUp || appState.lookedUp, settings: { ...appState.settings, ...(o.settings || {}) } });
      flash('Progress imported');
    } catch (err) { flash('Invalid file'); }
  };
  r.readAsText(file); e.target.value = '';
}

function resetProgress() {
  if (!appState.confirmReset) {
    setState({ confirmReset: true }); clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setState({ confirmReset: false }), 3000);
    return;
  }
  // Remember which cards had real progress so we can clear them on the server too.
  const priorProgressed = Object.keys(appState.cardState).filter(id => isMeaningfulProgress(appState.cardState[id]));
  const cardState = seedStates(appState.data.CARDS, {});
  setState({ cardState, saved: [], completed: {}, lookedUp: {}, confirmReset: false, reviewedToday: 0, streak: 0 });
  flash('Progress reset');
  // For logged-in users, persist the reset to the backend by neutralizing those
  // cards — otherwise the old progress would sync back on the next launch.
  if (appState.auth.token && priorProgressed.length) {
    clearTimeout(progressSyncTimer); dirtyCards = new Set();
    const cleared = {};
    priorProgressed.forEach(id => {
      cleared[id] = { state: 'new', due: null, seen: false, correct: 0, wrong: 0, weak: false, star: false };
    });
    API.putProgress(appState.auth.token, cleared).catch(() => {});
  }
}

// ===== Accounts & Sync =====
let dirtyCards = new Set();
let progressSyncTimer = null;

function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch (e) { return null; }
}

function saveAuth() {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      token: appState.auth.token, user: appState.auth.user,
    }));
  } catch (e) {}
}

async function doAuth(kind) {
  const email = (appState.authEmail || '').trim();
  const password = appState.authPassword || '';
  if (!email || !password) { setState({ authError: 'Enter your email and password.' }); return; }
  if (kind === 'signup' && password.length < 8) {
    setState({ authError: 'Password must be at least 8 characters.' }); return;
  }
  setState({ authBusy: true, authError: '' });
  try {
    const { token, user } = kind === 'signup' ? await API.signup(email, password) : await API.login(email, password);
    setState({ auth: { token, user }, authBusy: false, authPassword: '', authEmail: '' });
    saveAuth();
    flash(kind === 'signup' ? 'Account created!' : 'Welcome back!');
    loadMyWords();
    await syncOnLogin();
  } catch (e) {
    setState({ authBusy: false, authError: (e && e.message) || 'Something went wrong.' });
  }
}

async function doLogout() {
  const token = appState.auth.token;
  try { if (token) await API.logout(token); } catch (e) {}
  clearTimeout(progressSyncTimer); dirtyCards = new Set();
  applyMyWords([]); // custom words are account-scoped — drop them from the catalog
  setState({ auth: { token: null, user: null }, authView: 'landing', route: null, tab: 'home', myWords: [], mw: { es: '', en: '', sentEs: '', sentEn: '', busy: false, suggesting: false, error: '' } });
  saveAuth();
  flash('Logged out');
}

// ===== My Words (per-user custom deck) =====

/** API word -> card shape used everywhere in the app. */
function myWordToCard(w) {
  return { id: w.id, es: w.es, en: w.en, deck: 'myWords', type: 'word', band: null, synonyms: [], sentence: w.sentence || null, cat: '' };
}

// Rebuild the catalog with the user's custom words as the "My Words" deck.
// Custom cards join data.CARDS so every existing surface (study, quiz, browse,
// progress counts, AI chat) picks them up with no special-casing.
function applyMyWords(words) {
  if (!appState.data) return;
  const mine = (words || []).map(myWordToCard);
  const CARDS = appState.data.CARDS.filter(c => c.deck !== 'myWords').concat(mine);
  const DECKS = appState.data.DECKS.filter(d => d.id !== 'myWords');
  if (mine.length) DECKS.push({ id: 'myWords', ...DECK_DEFS.myWords, count: mine.length });
  const cardState = seedStates(mine, appState.cardState);
  // Rebuild the study order so new words join the rotation, but keep the card
  // the user is currently on so an add/delete doesn't yank the deck around.
  const curId = appState.study.order.length ? appState.study.order[appState.study.idx % appState.study.order.length] : null;
  appState = { ...appState, data: { ...appState.data, CARDS, DECKS }, cardState };
  const order = orderFor(appState.study.source);
  const idx = Math.max(0, order.indexOf(curId));
  setState({ myWords: words || [], study: { ...appState.study, order, idx } });
}

async function loadMyWords() {
  if (!appState.auth.token || !window.API || !API.getMyWords) return;
  try {
    const { words } = await API.getMyWords(appState.auth.token);
    applyMyWords(words || []);
  } catch (e) {
    // Non-fatal: the deck just stays absent for this session.
  }
}

async function addMyWord() {
  const f = appState.mw;
  if (f.busy) return;
  const es = (f.es || '').trim(); const en = (f.en || '').trim();
  if (!es || !en) { setState({ mw: { ...f, error: 'Both the Spanish word and its English meaning are required.' } }); return; }
  if (appState.myWords.length >= MY_WORDS_MAX) { setState({ mw: { ...f, error: `You've reached the ${MY_WORDS_MAX}-word limit for My Words.` } }); return; }
  setState({ mw: { ...f, busy: true, error: '' } });
  try {
    const body = { es, en };
    const sEs = (f.sentEs || '').trim(); const sEn = (f.sentEn || '').trim();
    if (sEs) body.sentence = { es: sEs, en: sEn };
    const { word } = await API.addMyWord(appState.auth.token, body);
    applyMyWords([word, ...appState.myWords]);
    setState({ mw: { es: '', en: '', sentEs: '', sentEn: '', busy: false, error: '' } });
    flash('Added to My Words');
  } catch (e) {
    setState({ mw: { ...appState.mw, busy: false, error: (e && e.message) || 'Could not add the word.' } });
  }
}

async function deleteMyWord(id) {
  try {
    await API.deleteMyWord(appState.auth.token, id);
    applyMyWords(appState.myWords.filter(w => w.id !== id));
    flash('Word removed');
  } catch (e) {
    flash((e && e.message) || 'Could not remove the word.');
  }
}

// AI assist for the add-word form: the learner types just the Spanish word and
// the on-device tutor drafts the English meaning + an example sentence. Only
// fields the user left empty are filled — their own typing is never overwritten,
// and everything stays editable before "Add".
async function suggestMyWord() {
  const f = appState.mw;
  const es = (f.es || '').trim();
  if (!es || f.suggesting || f.busy || !window.AI) return;
  // One completion at a time: the tutor chat and the suggest share a single
  // on-device engine, and concurrent generations can corrupt each other.
  if (appState.chat.busy) { setState({ mw: { ...f, error: 'The AI tutor is busy answering — try again in a moment.' } }); return; }
  setState({ mw: { ...f, suggesting: true, error: '' } });
  try {
    await AI.ensureLoaded();
    // The on-device model is small, so demand a rigid, line-based reply format
    // and anchor it with a one-shot example (small models follow examples far
    // better than instructions alone). Parsing below is tolerant of drift.
    const raw = await AI.chat([
      { role: 'system', content: 'You are a Spanish-English dictionary assistant specializing in the Spanish spoken in Guatemala. For each word the user gives, reply in EXACTLY this format with nothing else:\nMEANING: <short English meaning>\nSENTENCE_ES: <one short simple Spanish example sentence using the word>\nSENTENCE_EN: <the English translation of that sentence>' },
      { role: 'user', content: 'Word: "chilero"' },
      { role: 'assistant', content: 'MEANING: cool, great\nSENTENCE_ES: ¡Qué chilero está el día!\nSENTENCE_EN: What a nice day!' },
      { role: 'user', content: `Word: "${es}"` },
    ], { maxTokens: 140 });
    const grab = (re) => {
      const m = (raw || '').match(re);
      return m ? m[1].trim().replace(/^["']+|["']+$/g, '') : '';
    };
    // Tolerate label drift like "Meaning:", "Sentence_ES:", "English Translation:".
    const en = grab(/MEANING\s*:\s*([^\n]+)/i);
    const sentEs = grab(/SENTENCE[_\s-]?ES\s*:\s*([^\n]+)/i);
    const sentEn = grab(/(?:SENTENCE[_\s-]?EN|ENGLISH[^:\n]*)\s*:\s*([^\n]+)/i);
    if (!en) throw new Error("The AI couldn't draft this one — try again or fill it in by hand.");
    const cur = appState.mw;
    setState({ mw: {
      ...cur,
      en: (cur.en || '').trim() ? cur.en : en,
      sentEs: (cur.sentEs || '').trim() ? cur.sentEs : sentEs,
      sentEn: (cur.sentEn || '').trim() ? cur.sentEn : sentEn,
      suggesting: false,
    } });
  } catch (e) {
    setState({ mw: { ...appState.mw, suggesting: false, error: (e && e.message) || 'AI suggestion failed — try again.' } });
  }
}

// ===== AI Tutor =====

// Mirror the AI engine's state into appState so the UI re-renders on progress.
function initAI() {
  if (!window.AI) return;
  // Only re-render when something the UI shows actually changed — the engine
  // can emit rapid-fire progress events during the model download.
  const apply = (s) => {
    const cur = appState.ai;
    const pct = Math.floor((s.progress || 0) * 100);
    if (cur.status === s.status && Math.floor((cur.progress || 0) * 100) === pct
        && cur.size === s.size && cur.error === s.error) return;
    setState({ ai: { status: s.status, progress: s.progress, size: s.size, error: s.error } });
  };
  AI.onChange(apply);
  apply(AI.getState());
}

function openChat(context) {
  setState({ chat: { open: true, context: context || null, messages: [], input: '', busy: false, streaming: '' } });
  if (window.AI) AI.ensureLoaded().catch(() => {});
}

function closeChat() {
  setState({ chat: { ...appState.chat, open: false } });
}

async function sendChat() {
  const text = (appState.chat.input || '').trim();
  if (!text || appState.chat.busy || !window.AI) return;
  if (appState.mw.suggesting) { flash('The AI is drafting a My Word — one moment.'); return; }
  const ctx = appState.chat.context;
  const system = ctx && ctx.system ? ctx.system : AI_SYSTEM;
  const history = [...appState.chat.messages, { role: 'user', content: text }];
  setState({ chat: { ...appState.chat, messages: history, input: '', busy: true, streaming: '' } });
  // Stream tokens straight into the live DOM node — calling setState per token
  // re-rendered the whole app and replayed the panel animation (the flicker).
  const onToken = (acc) => {
    const node = document.getElementById('chat-stream-text');
    if (node) node.textContent = acc;
    const list = document.getElementById('chat-messages');
    if (list) list.scrollTop = list.scrollHeight;
  };
  try {
    const recent = history.slice(-8); // cap context so long chats don't overflow
    const full = await AI.chat([{ role: 'system', content: system }, ...recent], { onToken });
    const answer = (full || '').trim() || "Sorry, I couldn't come up with an answer — try rephrasing.";
    setState({ chat: { ...appState.chat, messages: [...appState.chat.messages, { role: 'assistant', content: answer }], busy: false, streaming: '' } });
  } catch (e) {
    const msg = (e && e.message) || 'Something went wrong.';
    setState({ chat: { ...appState.chat, messages: [...appState.chat.messages, { role: 'assistant', content: '⚠️ ' + msg }], busy: false, streaming: '' } });
  }
}

// A card is worth syncing only once the user has actually touched it — this keeps
// the ~3,600 seeded default rows out of the server.
function isMeaningfulProgress(s) {
  return !!s && (s.state !== 'new' || s.seen || s.star || (s.correct || 0) > 0 || (s.wrong || 0) > 0 || s.weak);
}

// After login: merge server progress with local, then push only real progress up.
async function syncOnLogin() {
  const token = appState.auth.token;
  if (!token) return;
  setState({ syncing: true });
  try {
    const { cardState: server } = await API.getProgress(token);
    const merged = { ...appState.cardState, ...(server || {}) };
    setState({ cardState: merged, syncing: false });
    const meaningful = {};
    for (const [id, s] of Object.entries(merged)) {
      if (isMeaningfulProgress(s)) meaningful[id] = s;
    }
    if (Object.keys(meaningful).length) await API.putProgress(token, meaningful);
  } catch (e) {
    setState({ syncing: false });
    if (e && e.status === 401) doLogout();
  }
}

// Debounced push of changed cards while logged in.
function queueProgressSync(id) {
  if (!appState.auth.token) return;
  if (id) dirtyCards.add(id);
  clearTimeout(progressSyncTimer);
  progressSyncTimer = setTimeout(pushProgress, 1500);
}

async function pushProgress() {
  const token = appState.auth.token;
  if (!token || !dirtyCards.size) return;
  const ids = [...dirtyCards];
  const subset = {};
  ids.forEach(cardId => { if (appState.cardState[cardId]) subset[cardId] = appState.cardState[cardId]; });
  dirtyCards.clear();
  try {
    await API.putProgress(token, subset);
  } catch (e) {
    if (e && e.status === 401) { doLogout(); return; }
    ids.forEach(cardId => dirtyCards.add(cardId)); // retry on next change
  }
}

// ===== Style Helpers =====
function seg(active) {
  return `flex:1;border:none;font-family:Nunito;font-size:13.5px;font-weight:800;padding:10px 4px;border-radius:10px;cursor:pointer;background:${active ? 'var(--surface)' : 'transparent'};color:${active ? 'var(--ink)' : 'var(--muted)'};box-shadow:${active ? '0 2px 6px rgba(0,0,0,.12)' : 'none'};white-space:nowrap`;
}

function chip(active) {
  return `border:1.5px solid ${active ? '#28b573' : 'var(--line)'};background:${active ? 'var(--g-soft)' : 'var(--surface)'};color:${active ? 'var(--g-ink)' : 'var(--muted)'};font-family:Nunito;font-weight:800;font-size:12.5px;padding:7px 13px;border-radius:999px;cursor:pointer;white-space:nowrap;flex:none`;
}

function optStyle(state) {
  const base = 'width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;font-family:Nunito;font-size:16px;font-weight:800;padding:17px 18px;border-radius:16px;cursor:pointer;text-align:left;border:2px solid';
  if (state === 'correct') return `${base};background:var(--g-soft);border-color:#28b573;color:var(--g-ink)`;
  if (state === 'wrong')   return `${base};background:var(--r-soft);border-color:#e05a4d;color:var(--r-ink)`;
  if (state === 'dim')     return `${base};background:var(--surface);border-color:var(--line);color:var(--muted2)`;
  return `${base};background:var(--surface);border-color:var(--line);color:var(--ink)`;
}

function stateColor(s) { return s === 'known' ? '#28b573' : s === 'learning' ? '#f5a524' : 'var(--muted2)'; }
function deckTint(a) { return `color-mix(in oklch, ${a} 16%, var(--mix))`; }

// ===== Utilities =====
function shuffleArr(n) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ms(icon, size, color) {
  return `<span style="font-family:'Material Symbols Rounded';font-size:${size}px${color ? ';color:' + color : ''}">${icon}</span>`;
}

function msf(icon, size, color) {
  return `<span style="font-family:'Material Symbols Rounded';font-size:${size}px;font-variation-settings:'FILL' 1${color ? ';color:' + color : ''}">${icon}</span>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function isValidEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((v || '').trim());
}

// Hablavos wordmark: the green rounded "h" tile. size = tile px, fs = glyph px.
function brandMark(size, fs) {
  const r = Math.round(size * 0.31);
  return `<div style="width:${size}px;height:${size}px;border-radius:${r}px;background:#28b573;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:${fs}px;box-shadow:0 3px 10px rgba(40,181,115,.35);flex:0 0 auto">h</div>`;
}

// Pick the best example sentence for a card: authored sentence first,
// then the word's mini-phrase, then a lexicon example. Returns null when none exists.
function sentenceFor(deckId, es, entry, sents) {
  if (deckId === 'mainWords') {
    if (sents[es]) return { es: sents[es].es, en: sents[es].en || '' };
    if (entry.miniPhrase) return { es: entry.miniPhrase, en: entry.miniPhraseEnglish || '' };
    return null;
  }
  if (deckId === 'guatemalaLexicon' && entry.lexiconExampleEs) {
    return { es: entry.lexiconExampleEs, en: entry.lexiconExampleEn || '' };
  }
  return null;
}

// ===== Data Transformation =====
function transformData(raw, reading, synonymsMap, sentencesMap) {
  const syns = synonymsMap || {};
  const sents = sentencesMap || {};
  const colls = raw.collections || {};
  const CARDS = [];
  Object.entries(colls).forEach(([deckId, entries]) => {
    entries.forEach(entry => {
      const es = entry.spanish || '';
      const synonyms = deckId === 'mainWords' ? (syns[es] || []) : [];
      const sentence = sentenceFor(deckId, es, entry, sents);
      const cat = deckId === 'guatemalaLexicon' ? (entry.lexiconCategory || '') : '';
      CARDS.push({ id: entry.id, es, en: entry.english || '', deck: deckId, type: entry.type || 'word', band: entry.band || null, synonyms, sentence, cat });
    });
  });
  const DECKS = Object.entries(DECK_DEFS)
    .map(([id, def]) => ({ id, ...def, count: (colls[id] || []).length }))
    .filter(d => d.count > 0);
  const DICT = {};
  CARDS.forEach(c => {
    const words = c.es.match(/[A-Za-záéíóúüñÁÉÍÓÚÜÑ]+/g) || [];
    words.forEach(w => {
      const norm = w.toLowerCase().replace(/[^a-záéíóúüñ]/gi, '');
      if (norm && !DICT[norm]) DICT[norm] = { en: c.en, pos: c.type === 'phrase' ? 'phrase' : 'word' };
    });
  });
  const rd = reading || { levels: [], stories: [] };
  return { CARDS, DECKS, TYPES: TYPES_DEF, BANDS: BANDS_DEF, DICT, STORIES: rd.stories || [], LEVELS: rd.levels || [] };
}

// ===== Compute Render Values =====
function computeVals() {
  const S = appState;
  const themeAttr = S.settings.theme || 'light';
  if (!S.data) return { loading: true, ready: false, showTabs: false, themeAttr, word: { show: false }, toast: { show: false } };

  const { CARDS, DECKS, TYPES, BANDS, DICT, STORIES, LEVELS } = S.data;
  const { tab, route } = S; const now = Date.now();
  const inReader = tab === 'read' && S.readView === 'reader';
  const inQuestion = tab === 'read' && S.readView === 'question';
  const inDone = tab === 'read' && S.readView === 'done';
  const deckOf = id => DECKS.find(d => d.id === id);

  // Tabs
  const tabs = [
    { key: 'home', icon: 'home', label: 'Home' }, { key: 'study', icon: 'style', label: 'Study' },
    { key: 'read', icon: 'menu_book', label: 'Read' }, { key: 'quiz', icon: 'quiz', label: 'Quiz' },
    { key: 'progress', icon: 'insights', label: 'You' },
  ].map(t => { const a = tab === t.key && !route; return { ...t, fill: a ? 1 : 0, color: a ? '#28b573' : 'var(--muted2)', onClick: () => goTab(t.key) }; });

  // Counts
  let known = 0, learning = 0, fresh = 0, due = 0, weak = 0, tc = 0, tw = 0, starCount = 0;
  CARDS.forEach(c => {
    const s = cs(c.id);
    if (s.state === 'known') known++; else if (s.state === 'learning') learning++; else fresh++;
    if (s.seen && s.due <= now) due++;
    if (s.weak) weak++;
    tc += s.correct || 0; tw += s.wrong || 0;
    if (s.star) starCount++;
  });
  const acc = (tc + tw) ? Math.round(tc / (tc + tw) * 100) : 0;
  const favorites = S.saved.length + starCount;

  // Library
  const levels = LEVELS.map(lv => {
    const stories = STORIES.filter(s => s.level === lv.n).map(s => {
      const done = !!S.completed[s.id];
      return { real: true, locked: false, title: s.title, teaser: s.teaser, icon: s.icon,
        color: lv.color, tint: deckTint(lv.color), meta: s.minutes + ' min read' + (done ? ' · completed' : ''),
        done, notDone: !done,
        onClick: () => setState({ tab: 'read', route: null, readView: 'reader', storyId: s.id, activeWord: null, compSel: null, compAnswered: false }) };
    });
    stories.push({ real: false, locked: true });
    return { n: lv.n, name: lv.name, es: lv.es, color: lv.color, stories };
  });

  // Home
  const firstInc = STORIES.find(s => !S.completed[s.id]) || STORIES[0];
  const fiL = firstInc ? LEVELS.find(l => l.n === firstInc.level) : null;
  const goalTotal = 30; const goalDone = Math.min(goalTotal, S.reviewedToday);
  const goalPct = Math.round(goalDone / goalTotal * 100);
  const home = {
    streak: S.streak || 0, goalDone, goalTotal, goalPct, dueCount: due, weakCount: weak,
    contKicker: firstInc && S.completed[firstInc.id] ? 'Read again' : 'Continue reading',
    contTitle: firstInc ? firstInc.title : 'Stories coming soon',
    contIcon: firstInc ? firstInc.icon : 'menu_book',
    contColor: fiL ? fiL.color : 'var(--a-ink)', contTint: fiL ? deckTint(fiL.color) : 'var(--a-soft)',
    onContinue: firstInc ? () => setState({ tab: 'read', route: null, readView: 'reader', storyId: firstInc.id, activeWord: null, compSel: null, compAnswered: false }) : () => goTab('read'),
    onReviewDue: () => { setStudySource('due'); setState({ tab: 'study', route: null }); },
    onReviewWeak: () => { setStudySource('weak'); setState({ tab: 'study', route: null }); },
    onChat: () => openChat(null),
    actions: [
      { label: 'Flashcards', sub: 'Flip & learn', icon: 'style', color: 'var(--g-ink)', tint: 'var(--g-soft)', onClick: () => goTab('study') },
      { label: 'Quiz', sub: 'Test recall', icon: 'quiz', color: '#5560e0', tint: 'var(--p-soft)', onClick: () => goTab('quiz') },
      { label: 'Read', sub: STORIES.length + ' stories', icon: 'menu_book', color: 'var(--a-ink)', tint: 'var(--a-soft)', onClick: () => goTab('read') },
      { label: 'Browse', sub: CARDS.length + ' cards', icon: 'search', color: 'var(--pk-ink)', tint: 'var(--pk-soft)', onClick: () => openBrowse({}) },
    ],
  };

  // Study
  const order = S.study.order || []; const sLen = order.length;
  const stStates = [{ v: 'new', l: 'New' }, { v: 'learning', l: 'Learning' }, { v: 'known', l: 'Known' }];
  const studyMsg = ({ due: 'No cards are due right now — great work!', weak: 'No weak cards. Keep it up!', starred: 'Star cards to build a custom set.' })[S.study.source] || 'This set is empty.';
  const study = {
    sources: [{ v: 'all', l: 'All' }, { v: 'due', l: 'Due' }, { v: 'weak', l: 'Weak' }, { v: 'starred', l: '★ Starred' }]
      .map(x => ({ label: x.l, onClick: () => setStudySource(x.v), style: chip(S.study.source === x.v) })),
    empty: sLen === 0, has: sLen > 0, emptyMsg: studyMsg,
    onBrowse: () => openBrowse({}),
    ...(sLen > 0 ? (() => {
      const id = order[S.study.idx % sLen]; const card = CARDS.find(c => c.id === id);
      const cst = cs(id); const dk = deckOf(card.deck);
      const showSentence = !!S.study.showSentence && !!card.sentence;
      return {
        deckLabel: dk ? dk.name : card.deck, deckShort: dk ? dk.short : card.deck, deckAccent: dk ? dk.accent : '#28b573',
        counter: (S.study.idx % sLen + 1) + ' / ' + sLen,
        faceLabel: S.study.flipped ? 'English' : 'Español', faceText: S.study.flipped ? card.en : card.es,
        starIcon: cst.star ? 'star' : 'star_outline', starColor: cst.star ? '#f5a524' : 'var(--muted2)',
        showSentence,
        sentenceEs: card.sentence ? card.sentence.es : '',
        sentenceEn: card.sentence ? card.sentence.en : '',
        hasSentence: !!card.sentence && !S.study.flipped,
        onUse: () => setState({ study: { ...S.study, showSentence: true } }),
        onSpeakSentence: () => card.sentence && speak(card.sentence.es),
        onFlip: () => S.study.showSentence
          ? setState({ study: { ...S.study, showSentence: false } })
          : setState({ study: { ...S.study, flipped: !S.study.flipped } }),
        onNext: () => setState({ study: { ...S.study, idx: S.study.idx + 1, flipped: false, showSentence: false } }),
        onShuffle: () => { setStudySource(S.study.source); flash('Shuffled'); },
        onSpeak: () => speak(card.es), onStar: () => toggleStar(id),
        onChat: () => openChat({
          type: 'word', title: card.es, subtitle: 'Vocabulary · ' + card.en,
          system: AI_SYSTEM + ` The learner is studying the Spanish word or phrase "${card.es}" (English: "${card.en}"${card.pos ? ', ' + card.pos : ''}). Center your help on this word: its meaning, natural example sentences, conjugation if it's a verb, and common related expressions.`,
          suggestions: [
            `What does "${card.es}" mean and when do I use it?`,
            `Give me 2 example sentences with "${card.es}".`,
            `Any Guatemalan tips for using "${card.es}"?`,
          ],
        }),
        synonyms: (S.study.flipped || showSentence) ? [] : (card.synonyms || []),
        states: stStates.map(x => ({ label: x.l, onClick: () => setProg(id, x.v), style: seg(cst.state === x.v) })),
      };
    })() : {}),
  };

  // Reader
  const st = S.storyId ? STORIES.find(s => s.id === S.storyId) : null;
  const stLv = st ? LEVELS.find(l => l.n === st.level) : null;
  const reader = st ? {
    title: st.title, titleEn: st.titleEn || '', levelName: stLv ? stLv.name : '',
    color: stLv ? stLv.color : '#28b573', tint: deckTint(stLv ? stLv.color : '#28b573'),
    paragraphs: (st.body || []).map((p, i) => ({ tokens: tokenize(p), key: 'pr' + i })),
    lookedUp: Object.keys(S.lookedUp[st.id] || {}).length, pct: 0,
    onBack: () => setState({ readView: 'lib', activeWord: null }),
    onSpeak: () => speak((st.body || []).join(' ')),
    onChat: () => openChat({
      type: 'story', title: st.title, subtitle: 'Story · ' + (st.titleEn || (stLv ? stLv.name : '')),
      system: AI_SYSTEM + ` The learner is reading a short Spanish story titled "${st.title}"${st.titleEn ? ' ("' + st.titleEn + '")' : ''}. The story text is: """${(st.body || []).join(' ').slice(0, 1500)}""". Help them understand the vocabulary, grammar, and meaning of this story.`,
      suggestions: [
        'Summarize this story in simple English.',
        'What are the key vocabulary words here?',
        'Explain the grammar in the first sentence.',
      ],
    }),
    onFinish: () => setState({ readView: 'question', compSel: null, compAnswered: false }),
  } : { title: '', titleEn: '', levelName: '', color: '#28b573', tint: deckTint('#28b573'), paragraphs: [], lookedUp: 0, pct: 0, onBack: () => setState({ readView: 'lib' }), onSpeak: () => {}, onFinish: () => {} };

  // Comprehension
  const cq = st && st.question ? st.question : { q: '', options: [], answer: 0 };
  const comp = {
    q: cq.q, answered: S.compAnswered,
    options: (cq.options || []).map((o, i) => {
      let stt = 'idle';
      if (S.compAnswered) { if (i === cq.answer) stt = 'correct'; else if (i === S.compSel) stt = 'wrong'; else stt = 'dim'; }
      return { text: o, style: optStyle(stt), showIcon: S.compAnswered && (i === cq.answer || i === S.compSel), icon: i === cq.answer ? 'check_circle' : 'cancel', onClick: () => answerComp(i) };
    }),
    fbTint: S.compSel === cq.answer ? 'var(--g-soft)' : 'var(--r-soft)',
    fbColor: S.compSel === cq.answer ? '#28b573' : '#e05a4d',
    fbTitle: S.compSel === cq.answer ? '¡Correcto! Well done.' : 'Not quite — review and keep going.',
    onNext: () => finishStory(),
  };
  const done = { title: st ? st.title : '', looked: Object.keys(S.lookedUp[S.storyId] || {}).length, saved: S.saved.length, onBack: () => setState({ readView: 'lib', activeWord: null }) };

  // Quiz
  const q = S.quiz;
  const qSrcCount = (() => { const c = sourceCards(q.source).length; return Math.min(8, c < 4 ? CARDS.length : c); })();
  const quiz = {
    intro: q.phase === 'intro', playing: q.phase === 'play', done: q.phase === 'done', startCount: qSrcCount,
    dirs: [{ v: 'es-en', l: 'Español → English' }, { v: 'en-es', l: 'English → Español' }].map(x => ({ label: x.l, onClick: () => setState({ quiz: { ...q, dir: x.v } }), style: seg(q.dir === x.v) })),
    sources: [{ v: 'all', l: 'All cards' }, { v: 'due', l: 'Due today' }, { v: 'weak', l: 'Weak spots' }, { v: 'filter', l: 'Current filter' }].map(x => ({ label: x.l, onClick: () => setState({ quiz: { ...q, source: x.v } }), style: seg(q.source === x.v) })),
    onStart: () => buildQuiz(),
    ...(q.phase === 'play' && q.qs ? (() => {
      const cur = q.qs[q.idx];
      return {
        prompt: cur.prompt, counter: (q.idx + 1) + ' / ' + q.qs.length, pct: Math.round(q.idx / q.qs.length * 100),
        answered: q.answered, ask: q.dir === 'es-en' ? 'What does this mean?' : 'How do you say this?',
        nextLabel: q.idx + 1 >= q.qs.length ? 'See results' : 'Next question',
        onNext: () => nextQuiz(), onSpeak: () => speak(cur.es),
        options: cur.options.map((o, i) => {
          let stt = 'idle';
          if (q.answered) { if (i === cur.answer) stt = 'correct'; else if (i === q.sel) stt = 'wrong'; else stt = 'dim'; }
          return { text: o, style: optStyle(stt), showIcon: q.answered && (i === cur.answer || i === q.sel), icon: i === cur.answer ? 'check_circle' : 'cancel', onClick: () => answerQuiz(i) };
        }),
      };
    })() : {}),
    ...(q.phase === 'done' && q.qs ? { accuracy: Math.round(q.score / q.qs.length * 100), scoreLine: q.score + ' of ' + q.qs.length + ' correct', onRestart: () => setState({ quiz: { ...q, phase: 'intro' } }) } : {}),
  };

  // Progress
  const lexCards = CARDS.filter(c => c.deck === 'guatemalaLexicon');
  const lexDeckDef = DECK_DEFS.guatemalaLexicon;
  const prog = {
    total: CARDS.length.toLocaleString(), known, learning, fresh,
    storiesDone: Object.keys(S.completed).length, storiesTotal: STORIES.length,
    readPct: STORIES.length ? Math.round(Object.keys(S.completed).length / STORIES.length * 100) : 0,
    stats: [
      { label: 'Due today', value: due, icon: 'event_available', color: '#5560e0', onClick: () => { setStudySource('due'); setState({ tab: 'study', route: null }); } },
      { label: 'Weak spots', value: weak, icon: 'bolt', color: '#e0843c', onClick: () => { setStudySource('weak'); setState({ tab: 'study', route: null }); } },
      { label: 'Favorites', value: favorites, icon: 'bookmark', color: 'var(--pk-ink)', onClick: () => openBrowse({}) },
      { label: 'Quiz accuracy', value: acc + '%', icon: 'target', color: '#28b573', onClick: () => goTab('quiz') },
    ],
    decks: DECKS.map(d => {
      const kn = CARDS.filter(c => c.deck === d.id && cs(c.id).state === 'known').length;
      return { name: d.name, icon: d.icon, accent: d.accent, tint: deckTint(d.accent), sub: d.count.toLocaleString() + ' cards · ' + kn + ' known', onClick: () => openBrowse({ deck: d.id }) };
    }),
    lexCount: lexCards.length,
    lexCountryCount: 1 + (S.data.COUNTRY_LEX || []).length,
    lexAccent: lexDeckDef.accent, lexTint: deckTint(lexDeckDef.accent), lexIcon: lexDeckDef.icon,
    onLexicon: () => setState({ route: 'lexicon', lexQ: '' }),
    myWordsCount: S.myWords.length,
    onMyWords: () => setState({ route: 'mywords' }),
  };

  // My Words management screen (route 'mywords', reached from the You tab).
  const mwDef = DECK_DEFS.myWords;
  const myw = {
    count: S.myWords.length, max: MY_WORDS_MAX,
    accent: mwDef.accent, tint: deckTint(mwDef.accent),
    form: {
      es: S.mw.es, en: S.mw.en, sentEs: S.mw.sentEs, sentEn: S.mw.sentEn,
      busy: S.mw.busy, error: S.mw.error,
      canAdd: !S.mw.busy && !S.mw.suggesting && !!(S.mw.es || '').trim() && !!(S.mw.en || '').trim(),
      onEs: e => setState({ mw: { ...S.mw, es: e.target.value, error: '' } }),
      onEn: e => setState({ mw: { ...S.mw, en: e.target.value, error: '' } }),
      onSentEs: e => setState({ mw: { ...S.mw, sentEs: e.target.value } }),
      onSentEn: e => setState({ mw: { ...S.mw, sentEn: e.target.value } }),
      onAdd: () => addMyWord(),
      // AI assist: draft the meaning + example from just the Spanish word.
      suggesting: S.mw.suggesting,
      aiAvailable: !!(window.AI && AI.isSupported()),
      canSuggest: !S.mw.suggesting && !S.mw.busy && !!(S.mw.es || '').trim(),
      suggestLabel: S.mw.suggesting
        ? (S.ai.status === 'downloading' || S.ai.status === 'loading'
            ? `Preparing AI… ${Math.round((S.ai.progress || 0) * 100)}%`
            : 'Thinking…')
        : 'Fill in the rest with AI',
      onSuggest: () => suggestMyWord(),
    },
    items: S.myWords.map(w => ({
      id: w.id, es: w.es, en: w.en,
      sentEs: w.sentence ? w.sentence.es : '', sentEn: w.sentence ? w.sentence.en : '',
      onSpeak: () => speak(w.es),
      onDelete: () => deleteMyWord(w.id),
      onChat: () => openChat({
        type: 'word', title: w.es, subtitle: 'My Words · ' + w.en,
        system: AI_SYSTEM + ` The learner added the Spanish word or phrase "${w.es}" (English: "${w.en}") to their personal deck. Center your help on this word: its meaning, natural example sentences, conjugation if it's a verb, and common related expressions.`,
        suggestions: [
          `What does "${w.es}" mean and when do I use it?`,
          `Give me 2 example sentences with "${w.es}".`,
          `Any Guatemalan tips for using "${w.es}"?`,
        ],
      }),
    })),
    onStudy: () => { setState({ browse: { ...S.browse, q: '', deck: 'myWords', type: 'all', state: 'all', band: 'all', session: 'any' } }); setState({ study: { idx: 0, flipped: false, source: 'filter', order: orderFor('filter') }, tab: 'study', route: null }); },
    onBack: () => setState({ route: null }),
  };

  // Lexicon reference (in the "You" tab). Guatemala is the featured, studyable
  // deck; every other Spanish-speaking country gets a browsable lexicon from
  // data/country_lexicons.json, selectable via flag chips.
  const COUNTRY_LEX = S.data.COUNTRY_LEX || [];
  const lexCountries = [{ id: 'guatemala', name: 'Guatemala', flag: '🇬🇹' }]
    .concat(COUNTRY_LEX.map(c => ({ id: c.id, name: c.name, flag: c.flag })));
  const lexSel = lexCountries.some(c => c.id === S.lexCountry) ? S.lexCountry : 'guatemala';
  const lexCountryName = (lexCountries.find(c => c.id === lexSel) || {}).name || 'Guatemala';
  // Normalize both sources (deck cards vs. reference entries) to one shape.
  const lexEntries = lexSel === 'guatemala'
    ? lexCards.map(c => ({ es: c.es, en: c.en, cat: c.cat || '', sentEs: c.sentence ? c.sentence.es : '', sentEn: c.sentence ? c.sentence.en : '' }))
    : ((COUNTRY_LEX.find(c => c.id === lexSel) || {}).entries || []).map(e => ({ es: e.es, en: e.en, cat: e.cat || '', sentEs: e.example ? e.example.es : '', sentEn: e.example ? (e.example.en || '') : '' }));
  const lq = (S.lexQ || '').trim().toLowerCase();
  const lexItems = lexEntries
    .filter(e => {
      if (!lq) return true;
      return e.es.toLowerCase().includes(lq)
        || e.en.toLowerCase().includes(lq)
        || (e.cat && e.cat.toLowerCase().includes(lq))
        || (e.sentEs && e.sentEs.toLowerCase().includes(lq));
    })
    .map(e => ({
      term: e.es, meaning: e.en, cat: e.cat,
      hasSentence: !!e.sentEs,
      sentEs: e.sentEs, sentEn: e.sentEn,
      onSpeakTerm: () => speak(e.es),
      onSpeakSentence: () => e.sentEs && speak(e.sentEs),
      onChat: () => openChat({
        type: 'lexicon', title: e.es, subtitle: `${lexCountryName} term · ` + e.en,
        system: AI_SYSTEM + ` The learner is looking at the Spanish term "${e.es}" (meaning: "${e.en}"${e.cat ? ', category: ' + e.cat : ''}) as used in ${lexCountryName}. Explain what it means, how and when people in ${lexCountryName} use it, its tone or register, and give natural example sentences.`,
        suggestions: [
          `What does "${e.es}" mean in ${lexCountryName}?`,
          `Give me an example sentence using "${e.es}".`,
          `Is "${e.es}" formal or casual?`,
        ],
      }),
    }));
  const lexicon = {
    total: lexEntries.length, shown: lexItems.length,
    q: S.lexQ || '', hasQ: !!(S.lexQ && S.lexQ.trim()),
    accent: lexDeckDef.accent, tint: deckTint(lexDeckDef.accent), icon: lexDeckDef.icon,
    items: lexItems,
    isGT: lexSel === 'guatemala',
    countryName: lexCountryName,
    countries: lexCountries.map(c => ({
      ...c, active: c.id === lexSel,
      onClick: () => setState({ lexCountry: c.id, lexQ: '' }),
    })),
    onBack: () => setState({ route: null, lexQ: '' }),
    onSearch: e => setState({ lexQ: e.target.value }),
    onClearQ: () => setState({ lexQ: '' }),
  };

  // Browse
  const bf = S.browse; const results = filterCards(bf);
  const mkChips = (arr, key) => arr.map(o => ({ label: o.label, onClick: () => setBrowse({ [key]: o.val }), style: chip(String(bf[key]) === String(o.val)) }));
  const browse = {
    q: bf.q, hasQ: !!bf.q, count: results.length, none: results.length === 0,
    onSearch: e => setBrowse({ q: e.target.value }), onClearQ: () => setBrowse({ q: '' }),
    deckChips: mkChips([{ label: 'All decks', val: 'all' }].concat(DECKS.map(d => ({ label: d.short, val: d.id }))), 'deck'),
    typeChips: mkChips([{ label: 'All types', val: 'all' }].concat(TYPES.map(t => ({ label: t.label, val: t.id }))), 'type'),
    stateChips: mkChips([{ label: 'Any state', val: 'all' }, { label: 'New', val: 'new' }, { label: 'Learning', val: 'learning' }, { label: 'Known', val: 'known' }], 'state'),
    bandChips: mkChips([{ label: 'All bands', val: 'all' }].concat(BANDS.map(b => ({ label: b.label, val: b.id }))), 'band'),
    sessionChips: mkChips([{ label: 'Any session', val: 'any' }, { label: 'Seen', val: 'seen' }, { label: 'Not seen', val: 'unseen' }], 'session'),
    onBack: () => setState({ route: null }),
    onStudy: () => setState({ study: { idx: 0, flipped: false, source: 'filter', order: orderFor('filter') }, tab: 'study', route: null }),
    onQuiz: () => setState({ quiz: { ...q, source: 'filter', phase: 'intro' }, tab: 'quiz', route: null }),
    results: results.slice(0, 200).map(c => {
      const s = cs(c.id);
      return { es: c.es, en: c.en, stateColor: stateColor(s.state), starIcon: s.star ? 'star' : 'star_outline', starColor: s.star ? '#f5a524' : 'var(--muted2)', onOpen: () => setState({ route: 'card', detailId: c.id }), onStar: () => toggleStar(c.id) };
    }),
  };

  // Card detail
  let card = {};
  if (route === 'card' && S.detailId) {
    const c = CARDS.find(x => x.id === S.detailId);
    if (c) {
      const s = cs(c.id); const dk = deckOf(c.deck);
      const ddays = Math.round((s.due - now) / DAY_MS);
      const dueText = s.state === 'new' ? 'New card — not in review yet' : (s.due <= now ? 'Due for review now' : 'Next review in ' + ddays + ' day' + (ddays === 1 ? '' : 's'));
      card = {
        es: c.es, en: c.en, deckName: dk ? dk.short : c.deck, deckAccent: dk ? dk.accent : '#28b573', deckTint: dk ? deckTint(dk.accent) : 'var(--g-soft)',
        typeLabel: TYPES.find(t => t.id === c.type)?.label || c.type, hasBand: !!c.band, bandLabel: c.band || '',
        dueText, starIcon: s.star ? 'star' : 'star_outline', starColor: s.star ? '#f5a524' : 'var(--ink)',
        onStar: () => toggleStar(c.id), onSpeak: () => speak(c.es), onBack: () => setState({ route: 'browse' }),
        states: stStates.map(x => ({ label: x.l, onClick: () => setProg(c.id, x.v), style: seg(s.state === x.v) })),
      };
    }
  }

  // Settings
  const voiceOpts = [{ uri: 'auto', name: 'Auto — best Spanish voice', sub: bestVoice() ? bestVoice().name : 'Detecting device voices…' }]
    .concat(S.voices.map(v => ({ uri: v.voiceURI, name: v.name, sub: v.lang + (v.localService ? ' · on-device' : '') })));
  const settings = {
    voiceNote: S.voices.length ? S.voices.length + ' Spanish voice(s) on this device' : 'Spanish voices load on a real device',
    voices: voiceOpts.map(v => ({
      name: v.name, sub: v.sub, active: S.settings.voiceURI === v.uri,
      onClick: () => setState({ settings: { ...S.settings, voiceURI: v.uri } }),
      style: `width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1.5px solid ${S.settings.voiceURI === v.uri ? '#28b573' : 'var(--line)'};background:${S.settings.voiceURI === v.uri ? 'var(--g-soft)' : 'var(--surface)'};color:var(--ink);padding:11px 13px;border-radius:12px;cursor:pointer`,
    })),
    speeds: [{ v: 0.75, l: 'Slow' }, { v: 1, l: 'Normal' }, { v: 1.25, l: 'Fast' }].map(x => ({ label: x.l, onClick: () => { setState({ settings: { ...S.settings, speed: x.v } }); setTimeout(() => speak('Hola, buenos días'), 30); }, style: seg(S.settings.speed === x.v) })),
    themes: [{ v: 'light', l: 'Light', i: 'light_mode' }, { v: 'dark', l: 'Dark', i: 'dark_mode' }].map(x => ({ label: x.l, icon: x.i, onClick: () => setState({ settings: { ...S.settings, theme: x.v } }), style: seg(themeAttr === x.v) })),
    onTest: () => speak('Hola, ¿cómo estás? Buenos días.'),
    onExport: () => exportJSON(), onImport: e => importJSON(e), onReset: () => resetProgress(),
    resetLabel: S.confirmReset ? 'Tap again to confirm reset' : 'Reset progress',
    onInstall: () => install(),
    installLabel: S.canInstall ? 'Install app' : 'Add to Home Screen',
    installHint: S.canInstall ? 'Install as a standalone app' : 'In Safari: Share → Add to Home Screen',
    onBack: () => setState({ route: null }),
    account: {
      authed: !!S.auth.user,
      email: S.auth.user ? S.auth.user.email : '',
      isAdmin: !!(S.auth.user && S.auth.user.role === 'admin'),
      syncing: S.syncing,
      onLogout: () => doLogout(),
    },
    ai: (() => {
      const pct = Math.round((S.ai.progress || 0) * 100);
      const supported = !!(window.AI && AI.isSupported());
      const model = window.AI && AI.MODELS ? AI.MODELS['gemma-4-e2b'] : null;
      const statusLabel = !supported ? 'Not supported on this device'
        : S.ai.status === 'ready' ? 'Downloaded · ready to chat'
        : S.ai.status === 'downloading' ? `Downloading… ${pct}%`
        : S.ai.status === 'loading' ? 'Preparing the model…'
        : S.ai.status === 'blocked' ? 'Active in another tab'
        : S.ai.status === 'error' ? 'Load failed — open the chat to retry'
        : 'Downloads when you open the tutor';
      return {
        supported, statusLabel,
        busy: S.ai.status === 'downloading' || S.ai.status === 'loading',
        modelLabel: model ? model.label : 'Gemma 4 E2B',
        modelNote: model ? model.note : 'WebGPU on-device model',
      };
    })(),
  };

  // Word sheet
  const aw = S.activeWord; const isSaved = aw && S.saved.some(s => s.es === aw.es);
  const word = {
    show: !!aw, es: aw ? aw.es : '', en: aw ? aw.en : '', pos: aw ? aw.pos : '',
    onClose: () => setState({ activeWord: null }), onSpeak: () => aw && speak(aw.es), onSave: () => saveWord(),
    saveIcon: isSaved ? 'bookmark_added' : 'bookmark_add', saveLabel: isSaved ? 'Saved to your deck' : 'Save to deck',
    saveStyle: `width:100%;display:flex;align-items:center;justify-content:center;gap:8px;font-family:Nunito;font-size:16px;font-weight:800;padding:15px;border-radius:16px;cursor:pointer;border:none;background:${isSaved ? 'var(--g-soft)' : '#28b573'};color:${isSaved ? 'var(--g-ink)' : '#fff'}`,
  };

  // Auth (landing / login / signup) — shown until signed in. Accounts are required.
  const authed = !!S.auth.user;
  const showAuth = !authed;
  const auth = {
    view: S.authView, email: S.authEmail, password: S.authPassword,
    error: S.authError, busy: S.authBusy,
    onEmail: e => setAuthDraft({ authEmail: e.target.value, authError: '' }),
    onPassword: e => setAuthDraft({ authPassword: e.target.value }),
    onShowLogin: () => setState({ authView: 'login', authError: '' }),
    onShowSignup: () => setState({ authView: 'signup', authError: '' }),
    onBack: () => setState({ authView: 'landing', authError: '' }),
    onLogin: () => doAuth('login'),
    onSignup: () => doAuth('signup'),
    onSubmit: () => doAuth(S.authView === 'signup' ? 'signup' : 'login'),
    // Landing "Create free account": carry the entered email into the real signup form.
    onStartSignup: () => isValidEmail(S.authEmail)
      ? setState({ authView: 'signup', authError: '' })
      : setState({ authError: 'Please enter a valid email address.' }),
    onScrollDown: () => { const c = document.getElementById('content'); if (c) c.scrollTo({ top: c.scrollTop + c.clientHeight * 0.86, behavior: 'smooth' }); },
    showAllCountries: S.landingMore,
    onToggleCountries: () => setState({ landingMore: !S.landingMore }),
  };

  // AI tutor chat overlay.
  const ai = S.ai;
  const aiSupported = !!(window.AI && window.AI.isSupported());
  const DEFAULT_SUGGESTIONS = [
    'How do people say "good morning" in Guatemala?',
    'Teach me a common Guatemalan slang word.',
    'Help me practice ordering a coffee.',
  ];
  const chat = {
    open: S.chat.open,
    hasContext: !!S.chat.context,
    title: S.chat.context ? S.chat.context.title : 'AI tutor',
    subtitle: S.chat.context ? S.chat.context.subtitle : 'Ask anything about Guatemalan Spanish',
    suggestions: (S.chat.context && S.chat.context.suggestions) ? S.chat.context.suggestions : DEFAULT_SUGGESTIONS,
    messages: S.chat.messages,
    input: S.chat.input,
    busy: S.chat.busy,
    streaming: S.chat.streaming,
    ai: {
      status: aiSupported ? ai.status : 'unsupported',
      progress: ai.progress || 0,
      pct: Math.round((ai.progress || 0) * 100),
      error: ai.error,
      sizeLabel: (window.AI && AI.MODELS[ai.size]) ? AI.MODELS[ai.size].label : ai.size,
      sizeMb: (window.AI && AI.MODELS[ai.size]) ? AI.MODELS[ai.size].mb : 0,
    },
    onClose: () => closeChat(),
    onInput: e => setState({ chat: { ...S.chat, input: e.target.value } }),
    onSend: () => sendChat(),
    onRetry: () => { if (window.AI) AI.ensureLoaded().catch(() => {}); },
  };

  return {
    loading: false, ready: true, themeAttr,
    vAuth: showAuth, auth,
    vHome: tab === 'home' && !route, vStudy: tab === 'study' && !route, vQuiz: tab === 'quiz' && !route,
    vProgress: tab === 'progress' && !route,
    vReadLib: tab === 'read' && S.readView === 'lib' && !route,
    vReader: inReader, vQuestion: inQuestion, vDone: inDone,
    vBrowse: route === 'browse', vCard: route === 'card', vSettings: route === 'settings',
    vLexicon: route === 'lexicon', vMyWords: route === 'mywords',
    showTabs: !showAuth && !inReader && !inQuestion && !inDone && !route,
    onSettings: () => setState({ route: 'settings' }),
    tabs, levels, home, study, reader, comp, done, quiz, prog, browse, card, settings, word, lexicon, myw, chat,
    greeting: greeting(),
    toast: { show: !!S.toast, text: S.toast || '' },
  };
}

// ===== View Renderers =====

function renderAuth(v) {
  const a = v.auth;
  if (a.view === 'landing') return renderLanding(a);
  return renderAuthForm(a);
}

// Signed-out marketing landing — the Hablavos brand home. Scrolls inside #content.
function renderLanding(a) {
  const features = [
    { title: 'Main 3000',                  desc: 'The 3,000 words that carry real conversations, learned in smart order.', icon: 'translate',    tint: '#e7f6ee', ink: '#1c6e48' },
    { title: 'Coffee Phrases',             desc: 'Warm, everyday openers for cafés, markets and small talk.',              icon: 'local_cafe',   tint: '#fdf1dd', ink: '#a86c11' },
    { title: 'Everyday Phrases',           desc: "The sentences you'll actually reach for, ready when you need them.",      icon: 'chat_bubble',  tint: '#f8e5f2', ink: '#a12b83' },
    { title: 'Quiz',                       desc: 'Quick, gentle checks that turn recognition into recall.',                icon: 'quiz',         tint: '#ecedfb', ink: '#3b45c4' },
    { title: 'Little Things Locals Know',  desc: 'Culture, context and the small things locals just know.',                icon: 'explore',      tint: '#fbeade', ink: '#b45e1f' },
    { title: 'Country Lexicons',           desc: "Regional slang from every Spanish-speaking country, with examples.",     icon: 'menu_book',    tint: '#e3eff4', ink: '#1f5e7c' },
    { title: 'AI Tutor',                   desc: 'A private tutor that runs on your device — ask anything about a word, phrase, or story.', icon: 'smart_toy', tint: '#ecedfb', ink: '#3b45c4' },
    { title: 'My Words',                   desc: 'Add your own words and build a personal deck that syncs to all your devices.', icon: 'edit_note', tint: '#efeafc', ink: '#6b4fd8' },
  ];
  const steps = [
    { n: '1', title: 'Create your free account', desc: "One tap to start. Pick Guatemala and you're learning in under a minute." },
    { n: '2', title: 'Practice five minutes a day', desc: 'Words, phrases and quizzes in short, calm sessions that fit real life.' },
    { n: '3', title: 'Watch it stick', desc: 'Spaced review brings words back at the right moment, so they last.' },
  ];
  // All 21 Spanish-speaking countries — Guatemala live, the rest on the roadmap.
  // Collapsed view shows the first 4; `landingMore` expands the full list.
  const soon = (name, flag) => ({ name, flag, tag: 'Coming soon', tagIcon: 'schedule', tagColor: 'var(--muted2)', bg: 'var(--surface)', border: 'var(--line)', chip: 'var(--track)' });
  const allModules = [
    { name: 'Guatemala', flag: '🇬🇹', tag: 'Available now', tagIcon: 'check_circle', tagColor: '#1c6e48', bg: '#e7f6ee', border: 'rgba(40,181,115,.3)', chip: '#28b573' },
    soon('Mexico', '🇲🇽'), soon('Honduras', '🇭🇳'), soon('El Salvador', '🇸🇻'),
    soon('Nicaragua', '🇳🇮'), soon('Costa Rica', '🇨🇷'), soon('Panama', '🇵🇦'),
    soon('Cuba', '🇨🇺'), soon('Dominican Republic', '🇩🇴'), soon('Puerto Rico', '🇵🇷'),
    soon('Colombia', '🇨🇴'), soon('Venezuela', '🇻🇪'), soon('Ecuador', '🇪🇨'),
    soon('Peru', '🇵🇪'), soon('Bolivia', '🇧🇴'), soon('Chile', '🇨🇱'),
    soon('Argentina', '🇦🇷'), soon('Uruguay', '🇺🇾'), soon('Paraguay', '🇵🇾'),
    soon('Spain', '🇪🇸'), soon('Equatorial Guinea', '🇬🇶'),
  ];
  const modules = a.showAllCountries ? allModules : allModules.slice(0, 4);
  const stats = [
    { n: '3,000', l: 'most-used words', c: 'var(--ink)' },
    { n: '5 min', l: 'a day is enough', c: '#28b573' },
    { n: '8',     l: 'ways to practice', c: 'var(--ink)' },
    { n: 'Free',  l: 'to get started',  c: 'var(--ink)' },
  ];
  const emailField = (fid) =>
    `<input class="fld" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" value="${esc(a.email)}" data-fid="${fid}" ${hi(a.onEmail)}
      style="width:100%;padding:15px 18px;border-radius:14px;border:1.5px solid var(--line);background:var(--surface);font-family:Nunito;font-size:16px;font-weight:600;color:var(--ink);outline:none">`;

  const SIDE = 'clamp(20px,4vw,28px)';
  return `
<div style="animation:fadeIn .3s both">

  <div style="position:sticky;top:0;z-index:20;background:var(--bar);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)">
    <div style="max-width:1120px;margin:0 auto;padding:13px ${SIDE};display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="display:flex;align-items:center;gap:9px">
        ${brandMark(30, 18)}
        <span style="font-weight:900;font-size:20px;letter-spacing:-.02em;color:var(--ink)">Hablavos</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <button ${h(a.onShowLogin)} style="border:none;background:transparent;font-family:Nunito;font-weight:800;font-size:15px;color:var(--muted);cursor:pointer;padding:8px 4px">Log in</button>
        <button ${h(a.onShowSignup)} style="border:none;padding:10px 20px;border-radius:999px;background:#28b573;color:#fff;font-family:Nunito;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 3px 12px rgba(40,181,115,.28)">Sign up</button>
      </div>
    </div>
  </div>

  <div style="max-width:1120px;margin:0 auto;padding:clamp(28px,5vw,60px) ${SIDE} clamp(36px,5vw,64px);display:flex;flex-wrap:wrap;align-items:center;gap:clamp(28px,5vw,56px)">
    <div style="flex:1 1 380px;min-width:min(100%,320px)">
      <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 13px 6px 10px;border-radius:999px;background:var(--g-soft);margin-bottom:20px">
        <span style="width:7px;height:7px;border-radius:50%;background:#28b573;box-shadow:0 0 0 3px rgba(40,181,115,.18)"></span>
        <span style="font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--g-ink)">Module 01</span>
      </div>
      <h1 style="margin:0 0 18px;font-weight:900;font-size:clamp(36px,5.2vw,60px);line-height:1.03;letter-spacing:-.035em;color:var(--ink)">Learn the Spanish people <span style="color:#28b573">actually speak.</span></h1>
      <p style="margin:0 0 24px;font-size:clamp(16px,1.5vw,20px);line-height:1.5;font-weight:600;color:var(--muted);max-width:480px">A calm, daily way to build real vocabulary, phrases, and listening — the warm, everyday Spanish people actually use. Five minutes a day is enough.</p>
      <div style="max-width:480px">
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div style="flex:1 1 220px;min-width:0">${emailField('landing-email')}</div>
          <button ${h(a.onStartSignup)} style="flex:0 0 auto;padding:15px 24px;border-radius:14px;border:none;background:#28b573;color:#fff;font-family:Nunito;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 4px 14px rgba(40,181,115,.3)">Create free account</button>
        </div>
        ${a.error ? `<p data-auth-error style="margin:0 0 10px;font-weight:700;font-size:13.5px;color:var(--r-ink)">${esc(a.error)}</p>` : ''}
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <button ${h(a.onShowLogin)} style="border:1.5px solid var(--line);background:var(--surface);color:var(--ink);font-family:Nunito;font-weight:800;font-size:15px;padding:12px 20px;border-radius:14px;cursor:pointer">I already have an account</button>
          <span style="font-weight:700;font-size:13px;color:var(--muted2)">Free · No credit card</span>
        </div>
      </div>
    </div>
    <div style="flex:1 1 300px;min-width:min(100%,280px);display:flex;justify-content:center">
      ${renderPhoneMock()}
    </div>
  </div>

  <div style="max-width:1120px;margin:0 auto;padding:0 ${SIDE} clamp(32px,5vw,56px)">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;padding:clamp(18px,2.5vw,26px);border-radius:22px;background:var(--surface);border:1px solid var(--line);box-shadow:0 4px 22px rgba(0,0,0,.04)">
      ${stats.map(s => `<div style="text-align:center;padding:6px 4px">
        <div style="font-weight:900;font-size:clamp(24px,2.6vw,32px);letter-spacing:-.03em;color:${s.c}">${s.n}</div>
        <div style="font-weight:700;font-size:13px;color:var(--muted)">${s.l}</div>
      </div>`).join('')}
    </div>
  </div>

  <div style="max-width:1120px;margin:0 auto;padding:clamp(8px,2vw,20px) ${SIDE} clamp(36px,5vw,64px)">
    <div style="max-width:600px;margin-bottom:clamp(22px,3vw,36px)">
      <div style="font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#28b573;margin-bottom:10px">What you'll practice</div>
      <h2 style="margin:0 0 12px;font-weight:900;font-size:clamp(26px,3.4vw,40px);line-height:1.08;letter-spacing:-.03em;color:var(--ink)">Everything you need, one calm home.</h2>
      <p style="margin:0;font-size:clamp(15px,1.4vw,18px);line-height:1.5;font-weight:600;color:var(--muted)">Curated decks, an on-device AI tutor, and a personal deck you build yourself — each with its own colour and rhythm, so you always know where you are.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
      ${features.map(f => `<div style="padding:22px;border-radius:20px;background:var(--surface);border:1px solid var(--line);box-shadow:0 4px 20px rgba(0,0,0,.04)">
        <div style="width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:${f.tint};margin-bottom:16px">${ms(f.icon, 26, f.ink)}</div>
        <h3 style="margin:0 0 7px;font-weight:800;font-size:18px;letter-spacing:-.01em;color:var(--ink)">${esc(f.title)}</h3>
        <p style="margin:0;font-size:14.5px;line-height:1.5;font-weight:600;color:var(--muted)">${esc(f.desc)}</p>
      </div>`).join('')}
    </div>
  </div>

  <div style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
    <div style="max-width:1120px;margin:0 auto;padding:clamp(36px,5vw,64px) ${SIDE}">
      <div style="text-align:center;max-width:560px;margin:0 auto clamp(28px,4vw,44px)">
        <div style="font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#28b573;margin-bottom:10px">How it works</div>
        <h2 style="margin:0;font-weight:900;font-size:clamp(26px,3.4vw,40px);line-height:1.08;letter-spacing:-.03em;color:var(--ink)">Start today, stay consistent, actually remember.</h2>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px">
        ${steps.map(s => `<div style="text-align:center;padding:8px">
          <div style="width:56px;height:56px;border-radius:18px;background:var(--g-soft);color:var(--g-ink);font-weight:900;font-size:24px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">${s.n}</div>
          <h3 style="margin:0 0 8px;font-weight:800;font-size:19px;letter-spacing:-.01em;color:var(--ink)">${esc(s.title)}</h3>
          <p style="margin:0 auto;max-width:300px;font-size:15px;line-height:1.5;font-weight:600;color:var(--muted)">${esc(s.desc)}</p>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <div style="max-width:1120px;margin:0 auto;padding:clamp(36px,5vw,64px) ${SIDE}">
    <div style="max-width:600px;margin-bottom:clamp(22px,3vw,36px)">
      <div style="font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#28b573;margin-bottom:10px">One app, every accent</div>
      <h2 style="margin:0 0 12px;font-weight:900;font-size:clamp(26px,3.4vw,40px);line-height:1.08;letter-spacing:-.03em;color:var(--ink)">Begin with Guatemala. More countries are on the way.</h2>
      <p style="margin:0;font-size:clamp(15px,1.4vw,18px);line-height:1.5;font-weight:600;color:var(--muted)">Spanish isn't one thing — it changes with every border. Master one region at a time, in the words locals really use.</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px">
      ${modules.map(m => `<div style="padding:22px;border-radius:20px;background:${m.bg};border:1.5px solid ${m.border}">
        <div style="width:44px;height:44px;border-radius:12px;background:${m.chip};margin-bottom:16px;display:flex;align-items:center;justify-content:center;font-size:24px;line-height:1">${m.flag}</div>
        <h3 style="margin:0 0 6px;font-weight:800;font-size:18px;letter-spacing:-.01em;color:var(--ink)">${esc(m.name)}</h3>
        <div style="display:inline-flex;align-items:center;gap:5px;font-weight:800;font-size:12.5px;color:${m.tagColor}">${ms(m.tagIcon, 15, m.tagColor)}${esc(m.tag)}</div>
      </div>`).join('')}
    </div>
    <button ${h(a.onToggleCountries)} style="display:flex;align-items:center;justify-content:center;gap:7px;margin:18px auto 0;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);font-family:Nunito;font-weight:800;font-size:14.5px;padding:12px 22px;border-radius:999px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.05)">
      ${ms(a.showAllCountries ? 'keyboard_arrow_up' : 'keyboard_arrow_down', 20, '#28b573')}${a.showAllCountries ? 'Show fewer countries' : `See all ${allModules.length} countries`}
    </button>
  </div>

  <div style="max-width:1120px;margin:0 auto;padding:0 ${SIDE} clamp(40px,5vw,72px)">
    <div style="position:relative;overflow:hidden;border-radius:clamp(24px,3vw,32px);background:linear-gradient(135deg,#28b573,#1f9c62);padding:clamp(36px,5vw,64px) clamp(24px,4vw,56px);text-align:center;box-shadow:0 24px 50px -18px rgba(40,181,115,.5)">
      <div style="position:absolute;top:-60px;right:-40px;width:240px;height:240px;border-radius:50%;background:rgba(255,255,255,.09)"></div>
      <div style="position:absolute;bottom:-90px;left:-50px;width:280px;height:280px;border-radius:50%;background:rgba(255,255,255,.07)"></div>
      <div style="position:relative;z-index:1;max-width:560px;margin:0 auto">
        <h2 style="margin:0 0 14px;font-weight:900;font-size:clamp(26px,3.6vw,44px);line-height:1.06;letter-spacing:-.03em;color:#fff">Your first Spanish words are five minutes away.</h2>
        <p style="margin:0 0 24px;font-size:clamp(16px,1.6vw,19px);line-height:1.45;font-weight:600;color:rgba(255,255,255,.9)">Create a free account and start today. No card, no pressure.</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;max-width:460px;margin:0 auto">
          <div style="flex:1 1 220px;min-width:0">${emailField('landing-email-cta')}</div>
          <button ${h(a.onStartSignup)} style="flex:0 0 auto;padding:15px 24px;border-radius:14px;border:none;background:#2c2b2e;color:#fff;font-family:Nunito;font-weight:800;font-size:16px;cursor:pointer">Create free account</button>
        </div>
      </div>
    </div>
  </div>

  <div style="border-top:1px solid var(--line)">
    <div style="max-width:1120px;margin:0 auto;padding:28px ${SIDE};display:flex;align-items:center;justify-content:center;gap:9px;color:var(--muted2)">
      ${brandMark(26, 15)}
      <span style="font-weight:900;font-size:16px;letter-spacing:-.02em;color:var(--ink)">Hablavos</span>
      <span style="font-weight:700;font-size:12.5px">· Real Spanish, one region at a time</span>
    </div>
  </div>

</div>`;
}

// Small decorative flashcard preview shown on the landing hero.
function renderPhoneMock() {
  return `
<div style="max-width:300px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:22px 20px;box-shadow:0 24px 50px -22px rgba(0,0,0,.28)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
    <div style="display:flex;align-items:center;gap:6px;background:var(--g-soft);border-radius:999px;padding:5px 11px">
      ${ms('dictionary', 16, 'var(--g-ink)')}<span style="font-weight:800;font-size:12px;color:var(--g-ink)">Main 3000</span>
    </div>
    <span style="font-weight:800;font-size:12px;color:var(--muted2)">12 / 20</span>
  </div>
  <div style="text-align:center;padding:14px 0 18px">
    <div style="font-size:30px;font-weight:900;color:var(--ink);letter-spacing:-.5px">el trabajo</div>
    <div style="font-size:15px;font-weight:700;color:var(--muted);margin-top:6px">work · the job</div>
    <div style="display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-top:16px;background:#28b573;color:#fff;border-radius:999px;padding:9px 16px;font-weight:800;font-size:13px">${ms('volume_up', 18, '#fff')} Escuchar</div>
  </div>
  <div style="display:flex;gap:8px">
    <div style="flex:1;text-align:center;background:var(--r-soft);color:var(--r-ink);border-radius:12px;padding:10px;font-weight:800;font-size:13px">Again</div>
    <div style="flex:1;text-align:center;background:var(--g-soft);color:var(--g-ink);border-radius:12px;padding:10px;font-weight:800;font-size:13px">Got it</div>
  </div>
</div>`;
}

// Login / signup form card — reachable from the landing.
function renderAuthForm(a) {
  const isSignup = a.view === 'signup';
  const primaryLabel = isSignup ? 'Create account' : 'Log in';
  const field = (label, type, value, handler, fid, extra = '') =>
    `<label style="display:block;margin-bottom:12px">
      <span style="display:block;font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${label}</span>
      <input class="fld" type="${type}" value="${esc(value)}" data-fid="${fid}" ${hi(handler)} ${extra}
        style="width:100%;border:1.5px solid var(--line);background:var(--surface);border-radius:13px;padding:13px 14px;font-family:Nunito;font-size:16px;font-weight:700;color:var(--ink);outline:none">
    </label>`;
  return `
<div style="min-height:100%;display:flex;flex-direction:column;justify-content:center;padding:32px 26px;animation:fadeIn .3s both">
  <button ${h(a.onBack)} style="align-self:flex-start;display:flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--muted);font-family:Nunito;font-size:14px;font-weight:800;cursor:pointer;padding:0 0 18px">${ms('arrow_back', 20, 'var(--muted)')} Back</button>
  <div style="display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:22px">
    ${brandMark(52, 30)}
    <div style="font-size:26px;font-weight:900;color:var(--ink);letter-spacing:-.5px;margin-top:12px">Hablavos</div>
    <div style="font-size:15px;font-weight:600;color:var(--muted);margin-top:3px">Learn the Spanish people actually speak.</div>
  </div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:0 6px 18px rgba(0,0,0,.05)">
    <div style="font-size:19px;font-weight:900;color:var(--ink);margin-bottom:16px">${isSignup ? 'Create your account' : 'Welcome back'}</div>
    ${field('Email', 'email', a.email, a.onEmail, 'auth-email', 'autocomplete="email" inputmode="email"')}
    ${field('Password', 'password', a.password, a.onPassword, 'auth-password', `autocomplete="${isSignup ? 'new-password' : 'current-password'}"`)}
    ${a.error ? `<div data-auth-error style="background:var(--r-soft);color:var(--r-ink);font-size:13.5px;font-weight:700;padding:10px 12px;border-radius:11px;margin-bottom:12px">${esc(a.error)}</div>` : ''}
    <button ${h(a.onSubmit)} ${a.busy ? 'disabled' : ''} style="width:100%;border:none;background:#28b573;color:#fff;font-family:Nunito;font-size:16px;font-weight:800;padding:14px;border-radius:14px;cursor:${a.busy ? 'default' : 'pointer'};opacity:${a.busy ? '.6' : '1'}">${a.busy ? 'Please wait…' : primaryLabel}</button>
  </div>
  <div style="text-align:center;margin-top:16px">
    ${isSignup
      ? `<span style="font-size:14px;font-weight:600;color:var(--muted)">Already have an account? </span><button ${h(a.onShowLogin)} style="border:none;background:transparent;color:#28b573;font-family:Nunito;font-size:14px;font-weight:800;cursor:pointer;padding:0">Log in</button>`
      : `<span style="font-size:14px;font-weight:600;color:var(--muted)">New here? </span><button ${h(a.onShowSignup)} style="border:none;background:transparent;color:#28b573;font-family:Nunito;font-size:14px;font-weight:800;cursor:pointer;padding:0">Create an account</button>`}
  </div>
</div>`;
}

// Full-screen AI tutor chat overlay.
function renderChat(c) {
  const ai = c.ai;
  const ready = ai.status === 'ready';
  const canSend = ready && !c.busy && c.input.trim().length > 0;

  const bubble = (role, text, streaming) => {
    const isUser = role === 'user';
    return `<div style="align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:86%;background:${isUser ? '#5560e0' : 'var(--surface)'};color:${isUser ? '#fff' : 'var(--ink)'};border:${isUser ? 'none' : '1px solid var(--line)'};border-radius:${isUser ? '18px 18px 6px 18px' : '18px 18px 18px 6px'};padding:11px 14px;font-size:15px;font-weight:600;line-height:1.5;white-space:pre-wrap;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.04)">${esc(text)}${streaming ? '<span style="opacity:.45">▍</span>' : ''}</div>`;
  };

  const bubbles = c.messages.map(m => bubble(m.role, m.content)).join('');
  // Streaming bubble: an inner span (id chat-stream-text) that sendChat patches
  // directly as tokens arrive — no per-token re-render.
  const streamBubble = c.busy
    ? `<div style="align-self:flex-start;max-width:86%;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:18px 18px 18px 6px;padding:11px 14px;font-size:15px;font-weight:600;line-height:1.5;white-space:pre-wrap;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.04)"><span id="chat-stream-text">${esc(c.streaming || '')}</span><span style="opacity:.4"> ▍</span></div>`
    : '';
  const showIntro = !c.messages.length && !c.busy;
  const intro = showIntro ? `
    <div style="text-align:center;margin:auto 0;padding:14px 8px">
      <div style="width:58px;height:58px;border-radius:18px;background:var(--p-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 14px">${ms('smart_toy', 30, '#5560e0')}</div>
      <div style="font-size:19px;font-weight:900;color:var(--ink);margin-bottom:6px">${esc(c.hasContext ? c.title : 'Your Spanish tutor')}</div>
      <div style="font-size:14px;font-weight:600;color:var(--muted);max-width:320px;margin:0 auto 18px;line-height:1.45">${esc(c.subtitle)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;max-width:360px;margin:0 auto">
        ${c.suggestions.map(q => `<button ${h(() => { setState({ chat: { ...appState.chat, input: q } }); sendChat(); })} ${ready ? '' : 'disabled'} style="border:1px solid var(--line);background:var(--surface);color:var(--ink);font-family:Nunito;font-weight:700;font-size:13.5px;padding:11px 14px;border-radius:13px;cursor:${ready ? 'pointer' : 'default'};text-align:left;opacity:${ready ? '1' : '.5'}">${esc(q)}</button>`).join('')}
      </div>
    </div>` : '';

  // Model status strip (above the input) — download progress, errors, or unsupported.
  let strip = '';
  if (ai.status === 'unsupported') {
    strip = `<div style="padding:13px 16px;border-top:1px solid var(--line);background:var(--a-soft);color:var(--a-ink);font-size:13px;font-weight:700;line-height:1.4">This device can't run the on-device tutor. Try a recent Chrome, Edge, or Safari on a laptop or desktop.</div>`;
  } else if (ai.status === 'blocked') {
    strip = `<div style="padding:13px 16px;border-top:1px solid var(--line);background:var(--a-soft);color:var(--a-ink);font-size:13px;font-weight:700;line-height:1.4">Gemma 4 is active in another Hablavos tab. Close that tab or leave the tutor there before retrying.</div>`;
  } else if (ai.status === 'error') {
    strip = `<div style="padding:12px 16px;border-top:1px solid var(--line);background:var(--r-soft);color:var(--r-ink);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>Couldn't load the AI model.</span>
      <button ${h(c.onRetry)} style="flex:none;border:none;background:var(--r-ink);color:#fff;font-family:Nunito;font-weight:800;font-size:12.5px;padding:8px 13px;border-radius:10px;cursor:pointer">Try again</button>
    </div>`;
  } else if (!ready) {
    const label = ai.status === 'loading' ? 'Preparing Gemma 4…' : `Downloading the tutor (${ai.sizeLabel}, ~2.4 GB)`;
    strip = `<div style="padding:12px 16px;border-top:1px solid var(--line);background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:13px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:7px">${ms('hourglass_top', 17, '#5560e0')}${esc(label)}</div>
        <div style="font-size:13px;font-weight:900;color:#5560e0">${ai.pct}%</div>
      </div>
      <div style="height:8px;border-radius:6px;background:var(--track);overflow:hidden"><div style="height:100%;width:${ai.pct}%;background:#5560e0;border-radius:6px;transition:width .3s"></div></div>
      <div style="font-size:11.5px;font-weight:600;color:var(--muted2);margin-top:7px">One-time download — saved on your device so it's instant next time.</div>
    </div>`;
  }

  return `
<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg);padding-top:env(safe-area-inset-top,0px)">
  <div style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-bottom:1px solid var(--line);background:var(--bar);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)">
    <button ${h(c.onClose)} style="flex:none;border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('arrow_back', 23, 'var(--ink)')}</button>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:7px">
        ${ms('smart_toy', 18, '#5560e0')}
        <div style="font-size:17px;font-weight:900;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title)}</div>
      </div>
      <div style="font-size:12.5px;font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.subtitle)}</div>
    </div>
    <div style="flex:none;display:flex;align-items:center;gap:5px;font-size:11px;font-weight:800;color:${ready ? 'var(--g-ink)' : 'var(--muted2)'}">
      <span style="width:8px;height:8px;border-radius:50%;background:${ready ? '#28b573' : 'var(--muted2)'}"></span>${ready ? 'Ready' : 'Loading'}
    </div>
  </div>

  <div id="chat-messages" class="scrl" style="flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:12px">
    ${intro}${bubbles}${streamBubble}
  </div>

  ${strip}

  <div style="padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);display:flex;gap:10px;align-items:center;background:var(--surface)">
    <input class="fld" data-fid="chat-input" type="text" enterkeyhint="send" placeholder="${ready ? 'Ask a question…' : 'Preparing your tutor…'}" value="${esc(c.input)}" ${hi(c.onInput)} ${ready && !c.busy ? '' : 'disabled'}
      style="flex:1;min-width:0;border:1.5px solid var(--line);background:var(--bg);border-radius:22px;padding:12px 16px;font-family:Nunito;font-size:15px;font-weight:600;color:var(--ink);outline:none">
    <button ${h(c.onSend)} ${canSend ? '' : 'disabled'} style="flex:none;border:none;width:46px;height:46px;border-radius:50%;background:${canSend ? '#5560e0' : 'var(--track)'};color:#fff;display:flex;align-items:center;justify-content:center;cursor:${canSend ? 'pointer' : 'default'}">${ms(c.busy ? 'more_horiz' : 'arrow_upward', 24, canSend ? '#fff' : 'var(--muted2)')}</button>
  </div>
</div>`;
}

function renderHome(v) {
  const { home, greeting: g, onSettings } = v;
  return `
<div style="padding:8px 22px 120px;animation:fadeIn .3s both">
  <div style="display:flex;align-items:center;gap:7px;margin-bottom:14px">
    ${brandMark(24, 14)}
    <span style="font-weight:900;font-size:15px;letter-spacing:-.02em;color:var(--ink)">Hablavos</span>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px">
    <div>
      <div style="font-size:14px;font-weight:700;color:var(--muted)">${esc(g)}</div>
      <div style="font-size:27px;font-weight:900;color:var(--ink);letter-spacing:-.5px;margin-top:2px">¡Hola! 🇬🇹</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <button ${h(onSettings)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('settings', 23, 'var(--ink)')}</button>
      <div style="display:flex;align-items:center;gap:5px;background:var(--a-soft);border-radius:16px;padding:8px 12px">
        ${ms('local_fire_department', 21, '#f5a524')}
        <span style="font-size:17px;font-weight:900;color:var(--a-ink)">${home.streak}</span>
      </div>
    </div>
  </div>
  <div style="background:linear-gradient(135deg,#28b573,#1f9d63);border-radius:24px;padding:22px;color:#fff;margin-bottom:14px;box-shadow:0 8px 22px rgba(40,181,115,.28)">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:13px;font-weight:800;opacity:.85;text-transform:uppercase;letter-spacing:.5px">Today's reviews</div>
        <div style="font-size:23px;font-weight:900;margin-top:4px;white-space:nowrap">${home.goalDone} / ${home.goalTotal} done</div>
        <div style="font-size:13px;font-weight:700;opacity:.85;margin-top:2px">${home.dueCount} cards due today</div>
      </div>
      <div style="position:relative;width:66px;height:66px;border-radius:50%;background:conic-gradient(#fff ${home.goalPct}%,rgba(255,255,255,.28) 0)">
        <div style="position:absolute;inset:7px;border-radius:50%;background:#239a60;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900">${home.goalPct}%</div>
      </div>
    </div>
  </div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:16px;margin-bottom:14px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="display:flex;gap:10px;margin-bottom:13px">
      <div style="flex:1;text-align:center;background:var(--p-soft);border-radius:14px;padding:12px">
        <div style="font-size:24px;font-weight:900;color:#5560e0">${home.dueCount}</div>
        <div style="font-size:11.5px;font-weight:800;color:var(--muted)">Due today</div>
      </div>
      <div style="flex:1;text-align:center;background:var(--r-soft);border-radius:14px;padding:12px">
        <div style="font-size:24px;font-weight:900;color:var(--r-ink)">${home.weakCount}</div>
        <div style="font-size:11.5px;font-weight:800;color:var(--muted)">Weak spots</div>
      </div>
    </div>
    <div style="display:flex;gap:10px">
      <button ${h(home.onReviewDue)} style="flex:1;border:none;background:#28b573;color:#fff;font-family:Nunito;font-size:14.5px;font-weight:800;padding:13px;border-radius:13px;cursor:pointer">Review due</button>
      <button ${h(home.onReviewWeak)} style="flex:1;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);font-family:Nunito;font-size:14.5px;font-weight:800;padding:13px;border-radius:13px;cursor:pointer">Weak spots</button>
    </div>
  </div>
  <div ${h(home.onContinue)} style="background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:20px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="width:52px;height:52px;border-radius:15px;display:flex;align-items:center;justify-content:center;background:${home.contTint}">
      ${ms(home.contIcon, 27, home.contColor)}
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:800;color:${home.contColor};text-transform:uppercase;letter-spacing:.4px">${home.contKicker}</div>
      <div style="font-size:17px;font-weight:800;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(home.contTitle)}</div>
    </div>
    ${ms('chevron_right', 26, 'var(--muted2)')}
  </div>
  <div ${h(home.onChat)} style="background:linear-gradient(135deg,#5560e0,#7b64e8);border-radius:22px;padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:20px;cursor:pointer;box-shadow:0 8px 22px rgba(85,96,224,.28)">
    <div style="width:52px;height:52px;border-radius:15px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.18);flex:none">${ms('smart_toy', 28, '#fff')}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:800;color:rgba(255,255,255,.85);text-transform:uppercase;letter-spacing:.4px">AI tutor</div>
      <div style="font-size:17px;font-weight:800;color:#fff">Ask anything in Spanish</div>
    </div>
    ${ms('chevron_right', 26, 'rgba(255,255,255,.8)')}
  </div>
  <div style="font-size:13px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Jump back in</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${home.actions.map(a => `
    <div ${h(a.onClick)} style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px 16px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.04)">
      <div style="width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;background:${a.tint};margin-bottom:12px">${ms(a.icon, 24, a.color)}</div>
      <div style="font-size:16px;font-weight:800;color:var(--ink)">${esc(a.label)}</div>
      <div style="font-size:13px;font-weight:600;color:var(--muted)">${esc(a.sub)}</div>
    </div>`).join('')}
  </div>
</div>`;
}

function renderStudy(v) {
  const { study } = v;
  return `
<div style="padding:8px 22px 120px;animation:fadeIn .3s both;height:100%;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-size:28px;font-weight:900;color:var(--ink);letter-spacing:-.6px">Study</div>
    <button ${h(study.onBrowse)} style="display:flex;align-items:center;gap:5px;border:1.5px solid var(--line);background:var(--surface);border-radius:13px;padding:8px 12px;cursor:pointer;font-family:Nunito;font-weight:800;font-size:13px;color:var(--ink)">${ms('tune', 18)}Filters</button>
  </div>
  <div class="hrow" style="display:flex;gap:8px;margin-bottom:18px;padding-bottom:2px">
    ${study.sources.map(s => `<button ${h(s.onClick)} style="${s.style}">${s.label}</button>`).join('')}
  </div>
  ${study.empty ? `
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--muted)">
    ${ms('check_circle', 48, 'var(--muted2)')}
    <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:10px">Nothing here right now</div>
    <div style="font-size:14px;font-weight:600;max-width:230px;margin-top:4px">${study.emptyMsg}</div>
  </div>` : `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:13px;font-weight:700;color:var(--muted)">${esc(study.deckLabel)}</div>
    <div style="font-size:14px;font-weight:800;color:var(--muted)">${study.counter}</div>
  </div>
  <div ${h(study.onFlip)} style="flex:1;min-height:300px;background:var(--surface);border:1px solid var(--line);border-radius:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.07);position:relative;padding:30px;text-align:center">
    <button ${h(study.onStar)} data-fid="study-star" title="${study.starIcon === 'star' ? 'Remove from favorites' : 'Add to favorites'}" style="position:absolute;top:18px;right:18px;border:none;background:transparent;cursor:pointer">${ms(study.starIcon, 28, study.starColor)}</button>
    <div style="position:absolute;top:20px;left:20px;font-size:11px;font-weight:800;color:#fff;background:${study.deckAccent};padding:4px 10px;border-radius:9px">${esc(study.deckShort)}</div>
    ${study.showSentence ? `
    <div style="font-size:13px;font-weight:800;color:var(--muted2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:16px">Example</div>
    <div style="font-size:23px;font-weight:800;color:var(--ink);letter-spacing:-.3px;line-height:1.35">${esc(study.sentenceEs)}</div>
    ${study.sentenceEn ? `<div style="font-size:15px;font-weight:600;color:var(--muted);margin-top:12px;line-height:1.3">${esc(study.sentenceEn)}</div>` : ''}
    <button ${h(study.onSpeakSentence)} style="margin-top:22px;border:none;background:var(--g-soft);width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 25, 'var(--g-ink)')}</button>
    <div style="margin-top:16px;font-size:12px;font-weight:700;color:var(--muted2)">Tap card to go back</div>
    ` : `
    <div style="font-size:13px;font-weight:800;color:var(--muted2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px">${study.faceLabel}</div>
    <div style="font-size:30px;font-weight:900;color:var(--ink);letter-spacing:-.5px;line-height:1.2">${esc(study.faceText)}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:22px">
      <button ${h(study.onSpeak)} style="border:none;background:var(--g-soft);width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 25, 'var(--g-ink)')}</button>
      ${study.hasSentence ? `<button ${h(study.onUse)} style="display:flex;align-items:center;justify-content:center;border:none;background:var(--p-soft);color:#5560e0;font-family:Nunito;font-weight:800;font-size:15px;padding:0 26px;height:50px;border-radius:25px;cursor:pointer">Use</button>` : ''}
      <button ${h(study.onChat)} title="Ask the AI tutor" style="border:none;background:var(--p-soft);width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('smart_toy', 24, '#5560e0')}</button>
    </div>
    ${study.synonyms && study.synonyms.length ? `
    <div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:7px;justify-content:center">
      <div style="width:100%;font-size:11px;font-weight:800;color:var(--muted2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Synonyms</div>
      ${study.synonyms.map(s => `<button ${h(() => speak(s))} style="background:var(--soft2);color:var(--muted);font-family:Nunito;font-size:13px;font-weight:700;padding:5px 11px;border-radius:999px;border:none;cursor:pointer">${esc(s)} ${ms('volume_up', 13, 'var(--muted2)')}</button>`).join('')}
    </div>` : ''}
    `}
  </div>
  <div style="margin-top:14px">
    <div style="font-size:11.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">Mark as</div>
    <div style="display:flex;gap:8px;background:var(--soft2);padding:5px;border-radius:13px">
      ${study.states.map(st => `<button ${h(st.onClick)} style="${st.style}">${st.label}</button>`).join('')}
    </div>
  </div>
  <div style="display:flex;gap:12px;margin-top:14px">
    <button ${h(study.onShuffle)} style="flex:none;width:56px;border:1px solid var(--line);background:var(--surface);border-radius:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:15px 0">${ms('shuffle', 24, 'var(--ink)')}</button>
    <button ${h(study.onNext)} style="flex:1;border:none;background:var(--ink);color:var(--surface);font-family:Nunito;font-size:17px;font-weight:800;padding:15px;border-radius:18px;cursor:pointer">Next card</button>
  </div>`}
</div>`;
}

function renderReadLib(v) {
  const { levels } = v;
  return `
<div style="padding:8px 22px 120px;animation:fadeIn .3s both">
  <div style="font-size:28px;font-weight:900;color:var(--ink);letter-spacing:-.6px;margin-bottom:3px">Read</div>
  <div style="font-size:15px;font-weight:600;color:var(--muted);margin-bottom:22px">Short stories. Tap any word to translate.</div>
  ${!levels.length ? `
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px 24px;color:var(--muted)">
    ${ms('menu_book', 52, 'var(--muted2)')}
    <div style="font-size:18px;font-weight:800;color:var(--ink);margin-top:18px">Stories coming soon</div>
    <div style="font-size:14px;font-weight:600;margin-top:6px;max-width:240px">Short Spanish stories with tap-to-translate are in the works.</div>
  </div>` :
  levels.map(lv => `
  <div style="margin-bottom:26px">
    <div style="display:flex;align-items:center;gap:11px;margin-bottom:13px">
      <div style="width:34px;height:34px;border-radius:11px;background:${lv.color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px">${lv.n}</div>
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--ink);line-height:1.1">${esc(lv.name)}</div>
        <div style="font-size:12px;font-weight:700;color:var(--muted2)">${esc(lv.es)}</div>
      </div>
    </div>
    ${lv.stories.map(st => st.real ? `
    <div ${h(st.onClick)} style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:15px;display:flex;align-items:center;gap:14px;margin-bottom:10px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.04)">
      <div style="width:50px;height:50px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:${st.tint}">${ms(st.icon, 26, st.color)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:16px;font-weight:800;color:var(--ink)">${esc(st.title)}</div>
        <div style="font-size:13px;font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(st.teaser)}</div>
        <div style="font-size:12px;font-weight:700;color:var(--muted2);margin-top:3px">${st.meta}</div>
      </div>
      ${st.done ? msf('check_circle', 24, '#28b573') : ms('chevron_right', 24, 'var(--muted2)')}
    </div>` : `
    <div style="border:1.5px dashed var(--line);border-radius:18px;padding:13px 15px;display:flex;align-items:center;gap:12px;margin-bottom:10px;opacity:.7">
      ${ms('lock', 22, 'var(--muted2)')}
      <div style="font-size:14px;font-weight:700;color:var(--muted)">More stories coming soon</div>
    </div>`).join('')}
  </div>`).join('')}
</div>`;
}

function renderReader(v) {
  const { reader } = v;
  return `
<div style="animation:fadeIn .3s both">
  <div style="position:sticky;top:0;z-index:4;background:var(--bar);backdrop-filter:blur(8px);padding:6px 16px 12px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <button ${h(reader.onBack)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('arrow_back', 24, 'var(--ink)')}</button>
      <div style="display:flex;align-items:center;gap:6px;background:${reader.tint};padding:6px 12px;border-radius:13px"><span style="font-size:13px;font-weight:800;color:${reader.color}">${esc(reader.levelName)}</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <button ${h(reader.onChat)} title="Ask the AI tutor" style="border:none;background:var(--p-soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('smart_toy', 22, '#5560e0')}</button>
        <button ${h(reader.onSpeak)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 23, 'var(--ink)')}</button>
      </div>
    </div>
    <div style="margin-top:11px;height:6px;border-radius:4px;background:var(--track);overflow:hidden"><div style="height:100%;width:${reader.pct}%;background:#28b573;border-radius:4px;transition:width .3s"></div></div>
    <div style="font-size:12px;font-weight:700;color:var(--muted2);margin-top:5px">${reader.lookedUp} words explored</div>
  </div>
  <div style="padding:20px 24px 40px">
    <div style="font-size:25px;font-weight:900;color:var(--ink);letter-spacing:-.4px;line-height:1.15">${esc(reader.title)}</div>
    <div style="font-size:14px;font-weight:600;color:var(--muted);font-style:italic;margin:5px 0 22px">${esc(reader.titleEn)}</div>
    ${reader.paragraphs.map(para => `
    <p style="font-family:'Lora',Georgia,serif;font-size:19.5px;line-height:1.95;color:var(--ink);margin:0 0 18px">
      ${para.tokens.map(tok => tok.tappable ? `<span class="tapw" style="${tok.style}" ${h(tok.onClick)}>${tok.text}</span>` : `<span>${tok.text}</span>`).join('')}
    </p>`).join('')}
    <button ${h(reader.onFinish)} style="margin-top:14px;width:100%;border:none;background:#28b573;color:#fff;font-family:Nunito;font-size:17px;font-weight:800;padding:16px;border-radius:18px;cursor:pointer;box-shadow:0 6px 16px rgba(40,181,115,.3)">I finished — check my understanding</button>
  </div>
</div>`;
}

function renderQuestion(v) {
  const { comp, reader } = v;
  return `
<div style="padding:18px 24px 40px;animation:fadeIn .3s both;min-height:100%;display:flex;flex-direction:column">
  <button ${h(reader.onBack)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-bottom:24px">${ms('close', 24, 'var(--ink)')}</button>
  <div style="font-size:13px;font-weight:800;color:#28b573;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">Comprehension</div>
  <div style="font-size:23px;font-weight:900;color:var(--ink);line-height:1.3;margin-bottom:26px">${esc(comp.q)}</div>
  <div style="display:flex;flex-direction:column;gap:12px">
    ${comp.options.map(op => `
    <button ${h(op.onClick)} style="${op.style}"><span>${esc(op.text)}</span>${op.showIcon ? ms(op.icon, 23) : ''}</button>`).join('')}
  </div>
  <div style="flex:1"></div>
  ${comp.answered ? `
  <div style="background:${comp.fbTint};border-radius:18px;padding:16px;margin-top:24px;animation:pop .25s">
    <div style="font-size:16px;font-weight:900;color:${comp.fbColor}">${comp.fbTitle}</div>
    <button ${h(comp.onNext)} style="margin-top:12px;width:100%;border:none;background:${comp.fbColor};color:#fff;font-family:Nunito;font-size:16px;font-weight:800;padding:14px;border-radius:14px;cursor:pointer">Continue</button>
  </div>` : ''}
</div>`;
}

function renderDone(v) {
  const { done } = v;
  return `
<div style="padding:40px 28px;animation:fadeIn .3s both;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div style="width:96px;height:96px;border-radius:50%;background:var(--g-soft);display:flex;align-items:center;justify-content:center;margin-bottom:22px;animation:pop .4s">${ms('verified', 54, '#28b573')}</div>
  <div style="font-size:27px;font-weight:900;color:var(--ink);letter-spacing:-.5px">¡Bien hecho!</div>
  <div style="font-size:15px;font-weight:600;color:var(--muted);margin-top:6px;max-width:240px">You finished "${esc(done.title)}".</div>
  <div style="display:flex;gap:14px;margin:28px 0 30px">
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px 22px;box-shadow:0 4px 14px rgba(0,0,0,.04)"><div style="font-size:28px;font-weight:900;color:#28b573">${done.looked}</div><div style="font-size:12px;font-weight:700;color:var(--muted)">words explored</div></div>
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px 22px;box-shadow:0 4px 14px rgba(0,0,0,.04)"><div style="font-size:28px;font-weight:900;color:#f5a524">${done.saved}</div><div style="font-size:12px;font-weight:700;color:var(--muted)">saved to deck</div></div>
  </div>
  <button ${h(done.onBack)} style="width:100%;border:none;background:#28b573;color:#fff;font-family:Nunito;font-size:17px;font-weight:800;padding:16px;border-radius:18px;cursor:pointer;box-shadow:0 6px 16px rgba(40,181,115,.3)">Back to library</button>
</div>`;
}

function renderQuiz(v) {
  const { quiz } = v;
  return `
<div style="padding:8px 22px 120px;animation:fadeIn .3s both;height:100%;display:flex;flex-direction:column">
  ${quiz.intro ? `
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
    <div style="width:80px;height:80px;border-radius:24px;background:var(--p-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 18px">${ms('quiz', 44, '#5560e0')}</div>
    <div style="font-size:26px;font-weight:900;color:var(--ink);letter-spacing:-.5px;text-align:center">Quick quiz</div>
    <div style="font-size:14px;font-weight:600;color:var(--muted);margin:6px auto 24px;text-align:center;max-width:250px">Multiple choice, scored, with spaced-repetition updates.</div>
    <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Direction</div>
    <div style="display:flex;gap:8px;background:var(--soft2);padding:5px;border-radius:13px;margin-bottom:18px">
      ${quiz.dirs.map(d => `<button ${h(d.onClick)} style="${d.style}">${d.label}</button>`).join('')}
    </div>
    <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Source</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:26px">
      ${quiz.sources.map(s => `<button ${h(s.onClick)} style="${s.style}">${s.label}</button>`).join('')}
    </div>
    <button ${h(quiz.onStart)} style="width:100%;border:none;background:#5560e0;color:#fff;font-family:Nunito;font-size:17px;font-weight:800;padding:16px;border-radius:18px;cursor:pointer;box-shadow:0 6px 16px rgba(85,96,224,.3)">Start quiz · ${quiz.startCount} cards</button>
  </div>` : ''}
  ${quiz.playing ? `
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">
    <div style="flex:1;height:8px;border-radius:5px;background:var(--track);overflow:hidden"><div style="height:100%;width:${quiz.pct}%;background:#5560e0;border-radius:5px;transition:width .3s"></div></div>
    <div style="font-size:14px;font-weight:800;color:var(--muted)">${quiz.counter}</div>
  </div>
  <div style="font-size:13px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${quiz.ask}</div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:30px 20px;text-align:center;margin-bottom:20px;box-shadow:0 6px 18px rgba(0,0,0,.05);position:relative">
    <div style="font-size:30px;font-weight:900;color:var(--ink);letter-spacing:-.5px">${esc(quiz.prompt)}</div>
    <button ${h(quiz.onSpeak)} style="position:absolute;top:12px;right:12px;border:none;background:var(--g-soft);width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 21, 'var(--g-ink)')}</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px">
    ${(quiz.options || []).map(op => `<button ${h(op.onClick)} style="${op.style}"><span>${esc(op.text)}</span>${op.showIcon ? ms(op.icon, 23) : ''}</button>`).join('')}
  </div>
  <div style="flex:1"></div>
  ${quiz.answered ? `<button ${h(quiz.onNext)} style="width:100%;border:none;background:#5560e0;color:#fff;font-family:Nunito;font-size:17px;font-weight:800;padding:16px;border-radius:18px;cursor:pointer;animation:fadeIn .2s">${quiz.nextLabel}</button>` : ''}` : ''}
  ${quiz.done ? `
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;text-align:center">
    <div style="width:96px;height:96px;border-radius:50%;background:var(--p-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 22px;animation:pop .4s">${ms('emoji_events', 54, '#5560e0')}</div>
    <div style="font-size:27px;font-weight:900;color:var(--ink)">Quiz complete!</div>
    <div style="font-size:54px;font-weight:900;color:#5560e0;margin:14px 0 2px;letter-spacing:-1px">${quiz.accuracy}%</div>
    <div style="font-size:15px;font-weight:700;color:var(--muted);margin-bottom:28px">${quiz.scoreLine} · schedule updated</div>
    <button ${h(quiz.onRestart)} style="width:100%;border:none;background:#5560e0;color:#fff;font-family:Nunito;font-size:17px;font-weight:800;padding:16px;border-radius:18px;cursor:pointer">Done</button>
  </div>` : ''}
</div>`;
}

function renderProgress(v) {
  const { prog, onSettings } = v;
  return `
<div style="padding:8px 22px 120px;animation:fadeIn .3s both">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
    <div style="font-size:28px;font-weight:900;color:var(--ink);letter-spacing:-.6px">Progress</div>
    <button ${h(onSettings)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('settings', 23, 'var(--ink)')}</button>
  </div>
  <div style="background:linear-gradient(135deg,#2c2b2e,#46443f);border-radius:24px;padding:22px;color:#fff;margin-bottom:18px">
    <div style="font-size:13px;font-weight:800;opacity:.75;text-transform:uppercase;letter-spacing:.5px">Cards in catalog</div>
    <div style="font-size:40px;font-weight:900;letter-spacing:-1px;margin:2px 0 14px">${prog.total}</div>
    <div style="display:flex;gap:18px">
      <div><div style="font-size:20px;font-weight:900;color:#7ee2ab">${prog.known}</div><div style="font-size:12px;font-weight:700;opacity:.7">Known</div></div>
      <div><div style="font-size:20px;font-weight:900;color:#ffd27a">${prog.learning}</div><div style="font-size:12px;font-weight:700;opacity:.7">Learning</div></div>
      <div><div style="font-size:20px;font-weight:900;color:#9aa3ff">${prog.fresh}</div><div style="font-size:12px;font-weight:700;opacity:.7">New</div></div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
    ${prog.stats.map(s => `
    <div ${h(s.onClick)} style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 4px 14px rgba(0,0,0,.04);cursor:pointer">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">${ms(s.icon, 20, s.color)}<span style="font-size:13px;font-weight:700;color:var(--muted)">${s.label}</span></div>
      <div style="font-size:26px;font-weight:900;color:var(--ink)">${s.value}</div>
    </div>`).join('')}
  </div>
  <div style="font-size:13px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Decks</div>
  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px">
    ${prog.decks.map(d => `
    <div ${h(d.onClick)} style="background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:13px 15px;display:flex;align-items:center;gap:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.04)">
      <div style="width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${d.tint}">${ms(d.icon, 22, d.accent)}</div>
      <div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:800;color:var(--ink)">${esc(d.name)}</div><div style="font-size:12.5px;font-weight:700;color:var(--muted)">${d.sub}</div></div>
      ${ms('chevron_right', 22, 'var(--muted2)')}
    </div>`).join('')}
  </div>
  <div style="font-size:13px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Your deck</div>
  <button ${h(prog.onMyWords)} style="width:100%;text-align:left;border:none;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.04);margin-bottom:18px">
    <div style="width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:${deckTint('#7b64e8')};flex:none">${ms('edit_note', 26, '#7b64e8')}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:16px;font-weight:800;color:var(--ink)">My Words</div>
      <div style="font-size:12.5px;font-weight:700;color:var(--muted)">${prog.myWordsCount ? prog.myWordsCount + ' custom word' + (prog.myWordsCount === 1 ? '' : 's') + ' · add more anytime' : 'Add your own words to study'}</div>
    </div>
    ${ms('chevron_right', 22, 'var(--muted2)')}
  </button>
  <div style="font-size:13px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Guatemala</div>
  <button ${h(prog.onLexicon)} style="width:100%;text-align:left;border:none;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.04);margin-bottom:18px">
    <div style="width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:${prog.lexTint};flex:none">${ms(prog.lexIcon, 25, prog.lexAccent)}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:16px;font-weight:800;color:var(--ink)">Country Lexicons</div>
      <div style="font-size:12.5px;font-weight:700;color:var(--muted)">${prog.lexCountryCount > 1 ? prog.lexCountryCount + ' countries · regional slang with examples' : prog.lexCount + ' Guatemalan words & phrases with examples'}</div>
    </div>
    ${ms('chevron_right', 22, 'var(--muted2)')}
  </button>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:16px;font-weight:800;color:var(--ink)">Reading</div>
      <div style="font-size:14px;font-weight:800;color:#28b573">${prog.storiesDone}/${prog.storiesTotal} stories</div>
    </div>
    <div style="height:8px;border-radius:5px;background:var(--track);overflow:hidden"><div style="height:100%;width:${prog.readPct}%;background:#28b573;border-radius:5px"></div></div>
  </div>
</div>`;
}

// My Words: the user's private custom deck — add, review, and remove words.
function renderMyWords(v) {
  const { myw } = v;
  const f = myw.form;
  const fld = (ph, val, handler, fid, extra = '') =>
    `<input class="fld" type="text" placeholder="${ph}" value="${esc(val)}" data-fid="${fid}" ${hi(handler)} ${extra}
      style="width:100%;border:1.5px solid var(--line);background:var(--bg);border-radius:12px;padding:11px 13px;font-family:Nunito;font-size:15px;font-weight:700;color:var(--ink);outline:none">`;
  return `
<div style="animation:slideIn .25s both">
  <div style="position:sticky;top:0;z-index:4;background:var(--bar);backdrop-filter:blur(8px);padding:6px 16px 12px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:10px">
      <button ${h(myw.onBack)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('arrow_back', 24, 'var(--ink)')}</button>
      <div style="min-width:0;flex:1">
        <div style="font-size:20px;font-weight:900;color:var(--ink);line-height:1.1">My Words</div>
        <div style="font-size:12.5px;font-weight:700;color:var(--muted)">${myw.count} of ${myw.max} · private to your account, synced to your devices</div>
      </div>
      ${myw.count ? `<button ${h(myw.onStudy)} style="flex:none;border:none;background:${myw.accent};color:#fff;font-family:Nunito;font-weight:800;font-size:13px;padding:9px 14px;border-radius:12px;cursor:pointer">Study</button>` : ''}
    </div>
  </div>
  <div style="padding:14px 16px 40px">

    <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
      <div style="font-size:15px;font-weight:800;color:var(--ink);margin-bottom:12px">Add a word</div>
      <div style="display:flex;flex-direction:column;gap:9px">
        ${fld('Spanish word or phrase *', f.es, f.onEs, 'mw-es', 'autocapitalize="none"')}
        ${f.aiAvailable ? `
        <button ${h(f.onSuggest)} ${f.canSuggest ? '' : 'disabled'} style="display:flex;align-items:center;justify-content:center;gap:7px;border:1.5px dashed ${f.canSuggest ? '#5560e0' : 'var(--line)'};background:${f.suggesting ? 'var(--p-soft)' : 'transparent'};color:${f.canSuggest ? '#5560e0' : 'var(--muted2)'};font-family:Nunito;font-size:13.5px;font-weight:800;padding:10px;border-radius:12px;cursor:${f.canSuggest ? 'pointer' : 'default'}">${ms('auto_awesome', 17, f.canSuggest ? '#5560e0' : 'var(--muted2)')}${esc(f.suggestLabel)}</button>
        <div style="font-size:11px;font-weight:600;color:var(--muted2);text-align:center;margin-top:-3px">AI drafts can make mistakes — double-check before adding.</div>` : ''}
        ${fld('English meaning *', f.en, f.onEn, 'mw-en')}
        ${fld('Example sentence in Spanish (optional)', f.sentEs, f.onSentEs, 'mw-sent-es', 'autocapitalize="none"')}
        ${f.sentEs.trim() ? fld('Example sentence in English (optional)', f.sentEn, f.onSentEn, 'mw-sent-en') : ''}
      </div>
      ${f.error ? `<div style="background:var(--r-soft);color:var(--r-ink);font-size:13px;font-weight:700;padding:9px 12px;border-radius:10px;margin-top:10px">${esc(f.error)}</div>` : ''}
      <button ${h(f.onAdd)} ${f.canAdd ? '' : 'disabled'} style="width:100%;margin-top:12px;border:none;background:${f.canAdd ? myw.accent : 'var(--track)'};color:${f.canAdd ? '#fff' : 'var(--muted2)'};font-family:Nunito;font-size:15px;font-weight:800;padding:13px;border-radius:13px;cursor:${f.canAdd ? 'pointer' : 'default'}">${f.busy ? 'Adding…' : 'Add to My Words'}</button>
    </div>

    ${myw.items.length === 0 ? `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px;color:var(--muted)">
      ${ms('edit_note', 46, 'var(--muted2)')}
      <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:14px">No words yet</div>
      <div style="font-size:14px;font-weight:600;margin-top:4px;max-width:280px;line-height:1.4">Words you add appear here and in Study, Quiz, and Browse as your own “My Words” deck.</div>
    </div>` :
    myw.items.map(it => `
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:15px;margin-bottom:12px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:18px;font-weight:900;color:var(--ink);letter-spacing:-.3px">${esc(it.es)}</div>
          <div style="font-size:14px;font-weight:600;color:var(--muted);margin-top:2px">${esc(it.en)}</div>
        </div>
        <div style="flex:none;display:flex;align-items:center;gap:8px">
          <button ${h(it.onChat)} title="Ask the AI tutor" style="border:none;background:var(--p-soft);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('smart_toy', 20, '#5560e0')}</button>
          <button ${h(it.onSpeak)} style="border:none;background:${myw.tint};width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 20, myw.accent)}</button>
          <button ${h(it.onDelete)} title="Remove from My Words" style="border:none;background:var(--r-soft);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('delete', 19, 'var(--r-ink)')}</button>
        </div>
      </div>
      ${it.sentEs ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div style="font-size:15px;font-weight:700;color:var(--ink);line-height:1.35">${esc(it.sentEs)}</div>
        ${it.sentEn ? `<div style="font-size:13.5px;font-weight:600;color:var(--muted);margin-top:4px;line-height:1.3">${esc(it.sentEn)}</div>` : ''}
      </div>` : ''}
    </div>`).join('')}
  </div>
</div>`;
}

function renderLexicon(v) {
  const { lexicon: lx } = v;
  return `
<div style="animation:slideIn .25s both">
  <div style="position:sticky;top:0;z-index:4;background:var(--bar);backdrop-filter:blur(8px);padding:6px 16px 12px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">
      <button ${h(lx.onBack)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('arrow_back', 24, 'var(--ink)')}</button>
      <div style="min-width:0">
        <div style="font-size:20px;font-weight:900;color:var(--ink);line-height:1.1">${lx.isGT ? 'Guatemalan Lexicon' : esc(lx.countryName) + ' Lexicon'}</div>
        <div style="font-size:12.5px;font-weight:700;color:var(--muted)">${lx.hasQ ? lx.shown + ' of ' + lx.total : lx.total + ' words & phrases'}</div>
      </div>
    </div>
    <div class="hrow" style="display:flex;gap:8px;margin-bottom:11px;padding-bottom:2px">
      ${lx.countries.map(c => `<button ${h(c.onClick)} style="flex:none;display:flex;align-items:center;gap:6px;border:1.5px solid ${c.active ? lx.accent : 'var(--line)'};background:${c.active ? lx.tint : 'var(--surface)'};color:${c.active ? lx.accent : 'var(--muted)'};font-family:Nunito;font-weight:800;font-size:13px;padding:8px 13px;border-radius:999px;cursor:pointer;white-space:nowrap"><span style="font-size:15px;line-height:1">${c.flag}</span>${esc(c.name)}</button>`).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;background:var(--soft2);border-radius:13px;padding:0 12px">
      ${ms('search', 20, 'var(--muted)')}
      <input class="fld" type="text" placeholder="Search lexicon…" value="${esc(lx.q)}" data-fid="lex-search" ${hi(lx.onSearch)} style="flex:1;border:none;background:transparent;outline:none;padding:11px 0">
      ${lx.hasQ ? `<button ${h(lx.onClearQ)} style="border:none;background:transparent;cursor:pointer;display:flex">${ms('cancel', 20, 'var(--muted)')}</button>` : ''}
    </div>
  </div>
  <div style="padding:14px 16px 40px">
    ${lx.items.length === 0 ? `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px 24px;color:var(--muted)">
      ${ms('search_off', 46, 'var(--muted2)')}
      <div style="font-size:16px;font-weight:800;color:var(--ink);margin-top:14px">No matches</div>
      <div style="font-size:14px;font-weight:600;margin-top:4px">Try a different word.</div>
    </div>` :
    lx.items.map(it => `
    <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:15px;margin-bottom:12px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:18px;font-weight:900;color:var(--ink);letter-spacing:-.3px">${esc(it.term)}</div>
          <div style="font-size:14px;font-weight:600;color:var(--muted);margin-top:2px">${esc(it.meaning)}</div>
        </div>
        <div style="flex:none;display:flex;align-items:center;gap:8px">
          <button ${h(it.onChat)} title="Ask the AI tutor" style="border:none;background:var(--p-soft);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('smart_toy', 20, '#5560e0')}</button>
          <button ${h(it.onSpeakTerm)} style="border:none;background:${lx.tint};width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 20, lx.accent)}</button>
        </div>
      </div>
      ${it.cat ? `<div style="display:inline-block;margin-top:10px;font-size:11px;font-weight:800;color:${lx.accent};background:${lx.tint};padding:3px 9px;border-radius:8px;text-transform:capitalize">${esc(it.cat)}</div>` : ''}
      ${it.hasSentence ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:700;color:var(--ink);line-height:1.35">${esc(it.sentEs)}</div>
            ${it.sentEn ? `<div style="font-size:13.5px;font-weight:600;color:var(--muted);margin-top:4px;line-height:1.3">${esc(it.sentEn)}</div>` : ''}
          </div>
          <button ${h(it.onSpeakSentence)} style="flex:none;border:none;background:var(--soft2);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 18, 'var(--muted)')}</button>
        </div>
      </div>` : ''}
    </div>`).join('')}
  </div>
</div>`;
}

function renderBrowse(v) {
  const { browse } = v;
  return `
<div style="animation:slideIn .25s both">
  <div style="position:sticky;top:0;z-index:4;background:var(--bar);backdrop-filter:blur(8px);padding:6px 16px 12px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">
      <button ${h(browse.onBack)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('arrow_back', 24, 'var(--ink)')}</button>
      <div style="font-size:20px;font-weight:900;color:var(--ink)">Browse cards</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;background:var(--soft2);border-radius:13px;padding:0 12px;margin-bottom:10px">
      ${ms('search', 20, 'var(--muted)')}
      <input class="fld" type="text" placeholder="Search Spanish or English…" value="${esc(browse.q)}" data-fid="browse-search" ${hi(browse.onSearch)} style="flex:1;border:none;background:transparent;outline:none;padding:11px 0">
      ${browse.hasQ ? `<button ${h(browse.onClearQ)} style="border:none;background:transparent;cursor:pointer;display:flex">${ms('cancel', 20, 'var(--muted)')}</button>` : ''}
    </div>
    <div class="hrow" style="display:flex;gap:7px;margin-bottom:7px">${browse.deckChips.map(c => `<button ${h(c.onClick)} style="${c.style}">${c.label}</button>`).join('')}</div>
    <div class="hrow" style="display:flex;gap:7px;margin-bottom:7px">${browse.typeChips.map(c => `<button ${h(c.onClick)} style="${c.style}">${c.label}</button>`).join('')}</div>
    <div class="hrow" style="display:flex;gap:7px;margin-bottom:7px">${browse.stateChips.map(c => `<button ${h(c.onClick)} style="${c.style}">${c.label}</button>`).join('')}</div>
    <div class="hrow" style="display:flex;gap:7px;margin-bottom:7px">${browse.bandChips.map(c => `<button ${h(c.onClick)} style="${c.style}">${c.label}</button>`).join('')}</div>
    <div class="hrow" style="display:flex;gap:7px">${browse.sessionChips.map(c => `<button ${h(c.onClick)} style="${c.style}">${c.label}</button>`).join('')}</div>
  </div>
  <div style="padding:14px 18px 30px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:800;color:var(--muted)">${browse.count} cards</div>
      <div style="display:flex;gap:8px">
        <button ${h(browse.onStudy)} style="border:none;background:var(--g-soft);color:var(--g-ink);font-family:Nunito;font-weight:800;font-size:13px;padding:8px 14px;border-radius:11px;cursor:pointer">Study these</button>
        <button ${h(browse.onQuiz)} style="border:none;background:var(--p-soft);color:#5560e0;font-family:Nunito;font-weight:800;font-size:13px;padding:8px 14px;border-radius:11px;cursor:pointer">Quiz these</button>
      </div>
    </div>
    ${browse.none ? '<div style="text-align:center;color:var(--muted);padding:40px 0;font-weight:700">No cards match these filters.</div>' : ''}
    <div style="display:flex;flex-direction:column;gap:9px">
      ${browse.results.map(r => `
      <div ${h(r.onOpen)} style="background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:13px 14px;display:flex;align-items:center;gap:12px;cursor:pointer">
        <div style="width:9px;height:9px;border-radius:50%;background:${r.stateColor};flex:none"></div>
        <div style="flex:1;min-width:0"><div style="font-size:15.5px;font-weight:800;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.es)}</div><div style="font-size:13px;font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.en)}</div></div>
        <button ${h(r.onStar)} style="border:none;background:transparent;cursor:pointer;flex:none;display:flex">${ms(r.starIcon, 22, r.starColor)}</button>
      </div>`).join('')}
    </div>
  </div>
</div>`;
}

function renderCard(v) {
  const { card } = v;
  return `
<div style="animation:slideIn .25s both;padding:6px 22px 40px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
    <button ${h(card.onBack)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('arrow_back', 24, 'var(--ink)')}</button>
    <div style="display:flex;align-items:center;gap:6px;background:${card.deckTint};padding:6px 12px;border-radius:12px"><span style="font-size:13px;font-weight:800;color:${card.deckAccent}">${esc(card.deckName)}</span></div>
    <button ${h(card.onStar)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms(card.starIcon, 23, card.starColor)}</button>
  </div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:30px 24px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.07);margin-bottom:18px">
    <div style="font-size:32px;font-weight:900;color:var(--ink);letter-spacing:-.5px;line-height:1.2">${esc(card.es)}</div>
    <div style="font-size:18px;font-weight:700;color:var(--muted);margin-top:10px">${esc(card.en)}</div>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
      <span style="font-size:12px;font-weight:800;color:var(--muted);background:var(--soft2);padding:4px 11px;border-radius:9px">${esc(card.typeLabel)}</span>
      ${card.hasBand ? `<span style="font-size:12px;font-weight:800;color:var(--muted);background:var(--soft2);padding:4px 11px;border-radius:9px">Band ${esc(card.bandLabel)}</span>` : ''}
    </div>
    <button ${h(card.onSpeak)} style="margin-top:22px;border:none;background:var(--g-soft);width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:auto;margin-right:auto">${ms('volume_up', 28, 'var(--g-ink)')}</button>
  </div>
  <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Progress state</div>
  <div style="display:flex;gap:8px;background:var(--soft2);padding:5px;border-radius:13px;margin-bottom:14px">
    ${card.states.map(st => `<button ${h(st.onClick)} style="${st.style}">${st.label}</button>`).join('')}
  </div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:15px 16px;display:flex;align-items:center;gap:10px">
    ${ms('schedule', 21, 'var(--muted)')}
    <div style="font-size:14px;font-weight:700;color:var(--ink)">${esc(card.dueText)}</div>
  </div>
</div>`;
}

function renderSettings(v) {
  const { settings } = v;
  return `
<div style="animation:slideIn .25s both;padding:6px 22px 40px">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:22px">
    <button ${h(settings.onBack)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('arrow_back', 24, 'var(--ink)')}</button>
    <div style="font-size:24px;font-weight:900;color:var(--ink)">Settings</div>
  </div>
  <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Account</div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:42px;height:42px;border-radius:50%;background:var(--g-soft);display:flex;align-items:center;justify-content:center;flex:none">${ms('person', 24, 'var(--g-ink)')}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:800;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(settings.account.email)}</div>
        <div style="font-size:12.5px;font-weight:700;color:var(--muted)">${settings.account.isAdmin ? 'Admin · ' : ''}${settings.account.syncing ? 'Syncing…' : 'Progress syncs across devices'}</div>
      </div>
      <button ${h(settings.account.onLogout)} style="flex:none;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);font-family:Nunito;font-weight:800;font-size:13px;padding:9px 14px;border-radius:12px;cursor:pointer">Log out</button>
    </div>
  </div>
  ${settings.ai.supported ? `
  <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">AI tutor</div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="display:flex;align-items:center;gap:11px;margin-bottom:14px">
      <div style="width:38px;height:38px;border-radius:11px;background:var(--p-soft);display:flex;align-items:center;justify-content:center;flex:none">${ms('smart_toy', 22, '#5560e0')}</div>
      <div style="min-width:0"><div style="font-size:14.5px;font-weight:800;color:var(--ink)">On-device model</div><div style="font-size:12.5px;font-weight:600;color:var(--muted)">${esc(settings.ai.statusLabel)}</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;border:1.5px solid var(--line);background:var(--surface);padding:12px 14px;border-radius:13px">
      <div style="flex:1;min-width:0">
        <div style="font-size:14.5px;font-weight:800;color:var(--ink)">${esc(settings.ai.modelLabel)} <span style="font-weight:700;color:var(--muted2);font-size:12.5px">· ~2.4 GB first download</span></div>
        <div style="font-size:12px;font-weight:600;color:var(--muted)">${esc(settings.ai.modelNote)}</div>
      </div>
      ${msf('check_circle', 22, '#5560e0')}
    </div>
    <div style="font-size:11.5px;font-weight:600;color:var(--muted2);margin-top:10px;line-height:1.4">Loads only when you use the tutor, then stays cached by your browser for later sessions.</div>
  </div>` : ''}
  <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Pronunciation</div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:8px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:15px;font-weight:800;color:var(--ink)">Speed</div>
      <button ${h(settings.onTest)} style="border:none;background:var(--g-soft);color:var(--g-ink);font-family:Nunito;font-weight:800;font-size:12.5px;padding:6px 12px;border-radius:10px;cursor:pointer">Test voice</button>
    </div>
    <div style="display:flex;gap:8px;background:var(--soft2);padding:5px;border-radius:13px">
      ${settings.speeds.map(sp => `<button ${h(sp.onClick)} style="${sp.style}">${sp.label}</button>`).join('')}
    </div>
  </div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="font-size:15px;font-weight:800;color:var(--ink);margin-bottom:4px">Voice</div>
    <div style="font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:12px">${settings.voiceNote}</div>
    <div class="scrl" style="display:flex;flex-direction:column;gap:7px;max-height:210px">
      ${settings.voices.map(vv => `
      <button ${h(vv.onClick)} style="${vv.style}">
        <div style="text-align:left"><div style="font-size:14px;font-weight:800">${esc(vv.name)}</div><div style="font-size:11.5px;font-weight:600;opacity:.7">${esc(vv.sub)}</div></div>
        ${vv.active ? msf('check_circle', 21, '#28b573') : ''}
      </button>`).join('')}
    </div>
  </div>
  <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Appearance</div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="font-size:15px;font-weight:800;color:var(--ink);margin-bottom:10px">Theme</div>
    <div style="display:flex;gap:8px;background:var(--soft2);padding:5px;border-radius:13px">
      ${settings.themes.map(t => `<button ${h(t.onClick)} style="${t.style}">${ms(t.icon, 18)}&nbsp;${t.label}</button>`).join('')}
    </div>
  </div>
  <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Your data</div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:8px;margin-bottom:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <button ${h(settings.onExport)} style="width:100%;border:none;background:transparent;display:flex;align-items:center;gap:13px;padding:13px;cursor:pointer;border-radius:12px">
      ${ms('download', 23, 'var(--ink)')}
      <div style="text-align:left;flex:1"><div style="font-size:15px;font-weight:800;color:var(--ink)">Export progress</div><div style="font-size:12.5px;font-weight:600;color:var(--muted)">Download a JSON backup</div></div>
    </button>
    <label style="width:100%;display:flex;align-items:center;gap:13px;padding:13px;cursor:pointer;border-radius:12px;border-top:1px solid var(--line)">
      ${ms('upload', 23, 'var(--ink)')}
      <div style="text-align:left;flex:1"><div style="font-size:15px;font-weight:800;color:var(--ink)">Import progress</div><div style="font-size:12.5px;font-weight:600;color:var(--muted)">Restore from a JSON file</div></div>
      <input type="file" accept="application/json,.json" ${hc(settings.onImport)} style="display:none">
    </label>
    <button ${h(settings.onReset)} style="width:100%;border:none;background:transparent;display:flex;align-items:center;gap:13px;padding:13px;cursor:pointer;border-radius:12px;border-top:1px solid var(--line)">
      ${ms('restart_alt', 23, 'var(--r-ink)')}
      <div style="text-align:left;flex:1"><div style="font-size:15px;font-weight:800;color:var(--r-ink)">${settings.resetLabel}</div><div style="font-size:12.5px;font-weight:600;color:var(--muted)">Reset all states to defaults</div></div>
    </button>
  </div>
  <div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">App</div>
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="display:flex;align-items:center;gap:11px;margin-bottom:14px">${ms('wifi_off', 22, '#28b573')}<div><div style="font-size:14.5px;font-weight:800;color:var(--ink)">Works offline</div><div style="font-size:12.5px;font-weight:600;color:var(--muted)">Cards & progress are stored on your device</div></div></div>
    <button ${h(settings.onInstall)} style="width:100%;border:none;background:var(--ink);color:var(--surface);font-family:Nunito;font-size:15px;font-weight:800;padding:14px;border-radius:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">${ms('add_to_home_screen', 20)}&nbsp;${settings.installLabel}</button>
    <div style="font-size:12px;font-weight:600;color:var(--muted);margin-top:9px;text-align:center">${settings.installHint}</div>
  </div>
</div>`;
}

function renderTabBar(tabs) {
  return `
<div style="display:flex;justify-content:space-around;align-items:center;padding:9px 8px max(26px,env(safe-area-inset-bottom,0px));background:var(--bar);backdrop-filter:blur(10px);border-top:1px solid var(--line)">
  ${tabs.map(t => `
  <button ${h(t.onClick)} style="border:none;background:transparent;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;flex:1;padding:4px 0">
    <span style="font-family:'Material Symbols Rounded';font-size:26px;color:${t.color};font-variation-settings:'FILL' ${t.fill}">${t.icon}</span>
    <span style="font-size:10.5px;font-weight:800;color:${t.color}">${t.label}</span>
  </button>`).join('')}
</div>`;
}

function renderWordSheet(word) {
  return `
<div ${h(word.onClose)} style="position:absolute;inset:0;background:rgba(20,18,15,.4);z-index:20;animation:fadeIn .2s;display:flex;align-items:flex-end">
  <div ${h(() => {})} style="width:100%;background:var(--surface);border-radius:28px 28px 0 0;padding:10px 24px 34px;animation:sheetUp .28s cubic-bezier(.2,.9,.3,1)">
    <div style="width:42px;height:5px;border-radius:3px;background:var(--track);margin:0 auto 18px"></div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:30px;font-weight:900;color:var(--ink);letter-spacing:-.5px">${esc(word.es)}</div>
        <div style="display:inline-block;font-size:12px;font-weight:800;color:var(--muted);background:var(--soft2);padding:3px 9px;border-radius:8px;margin-top:6px;text-transform:lowercase">${esc(word.pos)}</div>
      </div>
      <button ${h(word.onSpeak)} style="flex:none;border:none;background:var(--g-soft);width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 28, 'var(--g-ink)')}</button>
    </div>
    <div style="font-size:21px;font-weight:700;color:var(--ink);margin:16px 0 22px;line-height:1.35">${esc(word.en)}</div>
    <button ${h(word.onSave)} style="${word.saveStyle}">${ms(word.saveIcon, 22)}<span>${word.saveLabel}</span></button>
  </div>
</div>`;
}

function renderToast(toast) {
  return `<div style="background:var(--ink);color:var(--surface);font-size:14px;font-weight:800;padding:12px 20px;border-radius:14px;animation:pop .25s;box-shadow:0 8px 20px rgba(0,0,0,.25)">${esc(toast.text)}</div>`;
}

// ===== Main Render =====
function render() {
  // Save focus for inputs
  const focused = document.activeElement;
  const focusId = focused?.dataset?.fid;
  const selStart = focused?.selectionStart ?? null;
  const selEnd = focused?.selectionEnd ?? null;

  handlers = {}; hCount = 0;
  const v = computeVals();

  $screen.dataset.theme = v.themeAttr;

  if (v.loading) {
    $content.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-weight:700;font-size:16px">Cargando…</div>';
    $tabBar.innerHTML = ''; $wordSheet.innerHTML = ''; $toastEl.innerHTML = '';
    return;
  }

  let html = '';
  if (v.vAuth)     html = renderAuth(v);
  else if (v.vHome)     html = renderHome(v);
  else if (v.vStudy)    html = renderStudy(v);
  else if (v.vReadLib)  html = renderReadLib(v);
  else if (v.vReader)   html = renderReader(v);
  else if (v.vQuestion) html = renderQuestion(v);
  else if (v.vDone)     html = renderDone(v);
  else if (v.vQuiz)     html = renderQuiz(v);
  else if (v.vProgress) html = renderProgress(v);
  else if (v.vBrowse)   html = renderBrowse(v);
  else if (v.vCard)     html = renderCard(v);
  else if (v.vSettings) html = renderSettings(v);
  else if (v.vLexicon)  html = renderLexicon(v);
  else if (v.vMyWords)  html = renderMyWords(v);

  $content.innerHTML = html;
  $tabBar.innerHTML = v.showTabs ? renderTabBar(v.tabs) : '';
  $wordSheet.innerHTML = v.word.show ? renderWordSheet(v.word) : '';
  $chatSheet.innerHTML = v.chat.open ? renderChat(v.chat) : '';
  $toastEl.innerHTML = v.toast.show ? renderToast(v.toast) : '';

  // Keep the chat pinned to the latest message as answers stream in.
  if (v.chat.open) { const m = document.getElementById('chat-messages'); if (m) m.scrollTop = m.scrollHeight; }

  // Restore focus
  if (focusId) {
    const el = document.querySelector(`[data-fid="${focusId}"]`);
    if (el) { el.focus(); if (selStart !== null && el.setSelectionRange) el.setSelectionRange(selStart, selEnd); }
  }
}

// ===== Bootstrap =====
async function bootstrap() {
  // Install prompt
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; setState({ canInstall: true }); });

  render(); // show loading state

  try {
    const [persisted, response, readingResp, synResp, sentResp, countryLexResp] = await Promise.all([
      loadState(),
      fetch(DATA_URL),
      fetch('./data/reading-data.json'),
      fetch('./data/synonyms.json'),
      fetch('./data/sentences.json'),
      fetch('./data/country_lexicons.json'),
    ]);

    if (!response.ok) throw new Error(`Failed to load data (${response.status})`);
    const raw = await response.json();
    let reading = null;
    let synonymsMap = {};
    let sentencesMap = {};
    let countryLex = [];
    try { reading = await readingResp.json(); } catch(e) {}
    try { synonymsMap = await synResp.json(); } catch(e) {}
    try { sentencesMap = await sentResp.json(); } catch(e) {}
    try { const cl = await countryLexResp.json(); countryLex = Array.isArray(cl) ? cl : (cl.countries || []); } catch(e) {}
    const data = transformData(raw, reading, synonymsMap, sentencesMap);
    // Per-country lexicon references (all Spanish-speaking countries except
    // Guatemala, whose lexicon is the studyable in-catalog deck).
    data.COUNTRY_LEX = countryLex;

    let cardState = {};
    let settings = appState.settings;
    let saved = [], completed = {}, lookedUp = {}, storyId = null;
    let studySource = 'all', quizDir = 'es-en', quizSource = 'all';
    let browse = appState.browse;
    let reviewedToday = 0, streak = 0;

    if (persisted) {
      if (persisted._migrateFrom) {
        cardState = migrateOldProgress(persisted._migrateFrom, data.CARDS);
      } else {
        cardState = persisted.cardState || {};
        saved = persisted.saved || [];
        completed = persisted.completed || {};
        lookedUp = persisted.lookedUp || {};
        storyId = persisted.storyId || null;
        settings = { ...appState.settings, ...(persisted.settings || {}) };
        studySource = persisted.study?.source || 'all';
        quizDir = persisted.quiz?.dir || 'es-en';
        quizSource = persisted.quiz?.source || 'all';
        browse = { ...appState.browse, ...(persisted.browse || {}) };
        reviewedToday = persisted.reviewedToday || 0;
        streak = persisted.streak || 0;
      }
    }

    cardState = seedStates(data.CARDS, cardState);

    // Restore any saved session.
    const savedAuth = loadAuth();
    const auth = savedAuth && savedAuth.token
      ? { token: savedAuth.token, user: savedAuth.user || null }
      : { token: null, user: null };

    // Rebuild study order with persisted source
    appState = { ...appState, data, cardState };
    const studyOrder = orderFor(studySource);

    setState({
      data, cardState, saved, completed, lookedUp, storyId, settings,
      study: { idx: 0, flipped: false, source: studySource, order: studyOrder },
      quiz: { ...appState.quiz, dir: quizDir, source: quizSource },
      browse, reviewedToday, streak, loaded: true,
      auth,
    });

    initVoices();
    registerServiceWorker();
    initAI();                       // mirror AI engine state into the UI
    if (auth.token) syncOnLogin();  // pull cross-device progress in the background
    if (auth.token) loadMyWords();  // fetch the user's custom deck
  } catch (err) {
    $content.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center;color:var(--muted)"><div style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:8px">Could not load cards</div><div style="font-size:14px;font-weight:600">${esc(err.message)}</div></div>`;
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // When a newly deployed service worker takes control, reload once so the
  // fresh HTML/JS replaces the old cached version instead of getting stuck.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return; // skip the first-ever install
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(r => r.update().catch(() => {})).catch(() => {});
  });
}

bootstrap();
