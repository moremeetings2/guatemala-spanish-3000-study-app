'use strict';

// ===== Constants =====
const STORAGE_KEY = 'spanishStudyApp.v1';
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
};

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
  detailId: null,
  settings: { speed: 1, voiceURI: 'auto', theme: 'light' },
  voices: [], canInstall: false, confirmReset: false,
  reviewedToday: 0, streak: 0, toast: null,
};

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

// ===== State Management =====
function setState(patch) {
  appState = { ...appState, ...patch };
  render();
  if (appState.loaded) schedSave();
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
}

function toggleStar(id) {
  const m = { ...appState.cardState };
  const c = { ...cs(id) };
  c.star = !c.star;
  m[id] = c;
  setState({ cardState: m });
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
  const cardState = seedStates(appState.data.CARDS, {});
  setState({ cardState, saved: [], completed: {}, lookedUp: {}, confirmReset: false, reviewedToday: 0, streak: 0 });
  flash('Progress reset');
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
      CARDS.push({ id: entry.id, es, en: entry.english || '', deck: deckId, type: entry.type || 'word', band: entry.band || null, synonyms, sentence });
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
  };

  // Word sheet
  const aw = S.activeWord; const isSaved = aw && S.saved.some(s => s.es === aw.es);
  const word = {
    show: !!aw, es: aw ? aw.es : '', en: aw ? aw.en : '', pos: aw ? aw.pos : '',
    onClose: () => setState({ activeWord: null }), onSpeak: () => aw && speak(aw.es), onSave: () => saveWord(),
    saveIcon: isSaved ? 'bookmark_added' : 'bookmark_add', saveLabel: isSaved ? 'Saved to your deck' : 'Save to deck',
    saveStyle: `width:100%;display:flex;align-items:center;justify-content:center;gap:8px;font-family:Nunito;font-size:16px;font-weight:800;padding:15px;border-radius:16px;cursor:pointer;border:none;background:${isSaved ? 'var(--g-soft)' : '#28b573'};color:${isSaved ? 'var(--g-ink)' : '#fff'}`,
  };

  return {
    loading: false, ready: true, themeAttr,
    vHome: tab === 'home' && !route, vStudy: tab === 'study' && !route, vQuiz: tab === 'quiz' && !route,
    vProgress: tab === 'progress' && !route,
    vReadLib: tab === 'read' && S.readView === 'lib' && !route,
    vReader: inReader, vQuestion: inQuestion, vDone: inDone,
    vBrowse: route === 'browse', vCard: route === 'card', vSettings: route === 'settings',
    showTabs: !inReader && !inQuestion && !inDone && !route,
    onSettings: () => setState({ route: 'settings' }),
    tabs, levels, home, study, reader, comp, done, quiz, prog, browse, card, settings, word,
    greeting: greeting(),
    toast: { show: !!S.toast, text: S.toast || '' },
  };
}

// ===== View Renderers =====

function renderHome(v) {
  const { home, greeting: g, onSettings } = v;
  return `
<div style="padding:8px 22px 120px;animation:fadeIn .3s both">
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
    <button ${h(study.onStar)} style="position:absolute;top:18px;right:18px;border:none;background:transparent;cursor:pointer">${ms(study.starIcon, 28, study.starColor)}</button>
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
      ${study.hasSentence ? `<button ${h(study.onUse)} style="display:flex;align-items:center;gap:6px;border:none;background:var(--p-soft);color:#5560e0;font-family:Nunito;font-weight:800;font-size:15px;padding:0 18px;height:50px;border-radius:25px;cursor:pointer">${ms('format_quote', 22, '#5560e0')}Use</button>` : ''}
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
      <button ${h(reader.onSpeak)} style="border:none;background:var(--soft);width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer">${ms('volume_up', 23, 'var(--ink)')}</button>
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
  <div style="background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 4px 14px rgba(0,0,0,.04)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:16px;font-weight:800;color:var(--ink)">Reading</div>
      <div style="font-size:14px;font-weight:800;color:#28b573">${prog.storiesDone}/${prog.storiesTotal} stories</div>
    </div>
    <div style="height:8px;border-radius:5px;background:var(--track);overflow:hidden"><div style="height:100%;width:${prog.readPct}%;background:#28b573;border-radius:5px"></div></div>
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
  if (v.vHome)     html = renderHome(v);
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

  $content.innerHTML = html;
  $tabBar.innerHTML = v.showTabs ? renderTabBar(v.tabs) : '';
  $wordSheet.innerHTML = v.word.show ? renderWordSheet(v.word) : '';
  $toastEl.innerHTML = v.toast.show ? renderToast(v.toast) : '';

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
    const [persisted, response, readingResp, synResp, sentResp] = await Promise.all([
      loadState(),
      fetch(DATA_URL),
      fetch('./data/reading-data.json'),
      fetch('./data/synonyms.json'),
      fetch('./data/sentences.json'),
    ]);

    if (!response.ok) throw new Error(`Failed to load data (${response.status})`);
    const raw = await response.json();
    let reading = null;
    let synonymsMap = {};
    let sentencesMap = {};
    try { reading = await readingResp.json(); } catch(e) {}
    try { synonymsMap = await synResp.json(); } catch(e) {}
    try { sentencesMap = await sentResp.json(); } catch(e) {}
    const data = transformData(raw, reading, synonymsMap, sentencesMap);

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

    // Rebuild study order with persisted source
    appState = { ...appState, data, cardState };
    const studyOrder = orderFor(studySource);

    setState({
      data, cardState, saved, completed, lookedUp, storyId, settings,
      study: { idx: 0, flipped: false, source: studySource, order: studyOrder },
      quiz: { ...appState.quiz, dir: quizDir, source: quizSource },
      browse, reviewedToday, streak, loaded: true,
    });

    initVoices();
    registerServiceWorker();
  } catch (err) {
    $content.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;text-align:center;color:var(--muted)"><div style="font-size:18px;font-weight:800;color:var(--ink);margin-bottom:8px">Could not load cards</div><div style="font-size:14px;font-weight:600">${esc(err.message)}</div></div>`;
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
        .then(r => r.update().catch(() => {})).catch(() => {});
    });
  }
}

bootstrap();
