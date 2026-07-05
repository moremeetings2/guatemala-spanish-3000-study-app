'use strict';

// On-device LLM for the in-app AI tutor.
//
// Uses wllama (llama.cpp compiled to WASM) to run LiquidAI's LFM2 GGUF models
// entirely in the browser — no server, no API keys. The model is fetched once
// and cached in OPFS, so return visits load instantly and work offline.
//
// Exposes a tiny `window.AI` façade so the app never touches wllama directly:
//   AI.isSupported()          -> boolean
//   AI.getState()             -> { status, progress, size, error, model }
//   AI.onChange(fn)           -> unsubscribe(); fires on every state change
//   AI.ensureLoaded()         -> Promise; starts/awaits the background load
//   AI.setModelSize(size)     -> Promise; switch model and reload
//   AI.chat(messages, opts)   -> Promise<string>; streams via opts.onToken
//   AI.currentSize()          -> persisted size key
//
// status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error' | 'unsupported'
(function () {
  const VERSION = '3.5.1';
  const WLLAMA_ESM = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${VERSION}/esm/index.js`;
  // 3.5.x takes AssetsPathConfig ({ default: <wasm url> }); the wasm ships in the package.
  const WLLAMA_WASM_URL = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${VERSION}/esm/wasm/wllama.wasm`;

  // LiquidAI LFM2 in GGUF (Q4_K_M). Sizes ascend in quality and download cost.
  const MODELS = {
    '350M': { repo: 'LiquidAI/LFM2-350M-GGUF', file: 'LFM2-350M-Q4_K_M.gguf', mb: 229, label: '350M', note: 'Fastest · smallest download' },
    '700M': { repo: 'LiquidAI/LFM2-700M-GGUF', file: 'LFM2-700M-Q4_K_M.gguf', mb: 469, label: '700M', note: 'Balanced' },
    '1.2B': { repo: 'LiquidAI/LFM2-1.2B-GGUF', file: 'LFM2-1.2B-Q4_K_M.gguf', mb: 731, label: '1.2B', note: 'Best answers · largest download' },
  };
  // Device profile: phones get the small model and a smaller context. iOS
  // Safari kills any tab that grows past roughly a gigabyte, and the 1.2B
  // model (731MB of weights alone) crashes the page with Safari's
  // "A problem repeatedly occurred" screen. Desktop defaults to the best model.
  const IS_MOBILE = /iPhone|iPod|Android/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Mac|iPad/i.test(navigator.userAgent)); // iPadOS reports as Mac
  const SIZE_ORDER = ['350M', '700M', '1.2B'];
  const DEFAULT_SIZE = IS_MOBILE ? '350M' : '1.2B';
  const SIZE_KEY = 'spanishAiModelSize.v1';
  const GUARD_KEY = 'spanishAiLoadGuard.v1';
  const N_CTX = IS_MOBILE ? 1024 : 2048;

  const state = { status: 'idle', progress: 0, size: DEFAULT_SIZE, error: '' };
  const listeners = new Set();

  // Crash guard: a marker is set just before a model load and cleared when the
  // load finishes (or fails with a normal error). If it's still there at boot,
  // the page died mid-load — usually Safari's out-of-memory kill. Step down one
  // model size and let the app know not to auto-load again this session.
  let hadLoadCrash = false;
  try {
    const guard = localStorage.getItem(GUARD_KEY);
    if (guard) {
      hadLoadCrash = true;
      localStorage.removeItem(GUARD_KEY);
      const idx = SIZE_ORDER.indexOf(guard);
      localStorage.setItem(SIZE_KEY, SIZE_ORDER[Math.max(0, idx - 1)]);
    }
  } catch (e) {}

  let WllamaCtor = null;
  let WasmCdn = null;
  let wllama = null;
  let loadPromise = null;

  function getState() { return { ...state, model: MODELS[state.size] || MODELS[DEFAULT_SIZE] }; }
  function emit() { const s = getState(); listeners.forEach((fn) => { try { fn(s); } catch (e) {} }); }
  function set(patch) { Object.assign(state, patch); emit(); }

  function isSupported() {
    // wllama needs WebAssembly; dynamic import() is available in every browser
    // that has it. OPFS caching needs a secure context (HTTPS/localhost), which
    // is a soft requirement — without it the model just isn't cached.
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  }

  function savedSize() {
    try {
      const s = localStorage.getItem(SIZE_KEY);
      return MODELS[s] ? s : DEFAULT_SIZE;
    } catch (e) { return DEFAULT_SIZE; }
  }

  async function importWllama() {
    if (WllamaCtor) return;
    const mod = await import(/* @vite-ignore */ WLLAMA_ESM);
    WllamaCtor = mod.Wllama;
    WasmCdn = { default: WLLAMA_WASM_URL };
    if (!WllamaCtor) throw new Error('wllama failed to load.');
  }

  const quietLogger = {
    debug() {}, log() {},
    warn: (...a) => console.warn(...a),
    error: (...a) => console.error(...a),
  };

  async function doLoad(size) {
    const model = MODELS[size] || MODELS[DEFAULT_SIZE];
    set({ status: 'downloading', progress: 0, size, error: '' });
    try {
      try { localStorage.setItem(GUARD_KEY, size); } catch (e) {}
      await importWllama();
      wllama = new WllamaCtor(WasmCdn, { logger: quietLogger });
      // The download fires a progress event per network chunk — hundreds per
      // second. Each emit re-renders the app, so only emit on whole-percent
      // changes (≤100 emits for the entire download).
      let lastPct = -1;
      await wllama.loadModelFromHF(
        { repo: model.repo, file: model.file },
        {
          n_ctx: N_CTX,
          useCache: true,
          progressCallback: ({ loaded, total }) => {
            if (!total) return;
            const p = Math.min(1, loaded / total);
            const pct = Math.floor(p * 100);
            if (pct === lastPct) return;
            lastPct = pct;
            // Once bytes are in, the WASM still has to build the model: show that as "loading".
            set({ status: p >= 1 ? 'loading' : 'downloading', progress: p });
          },
        }
      );
      try { localStorage.removeItem(GUARD_KEY); } catch (e) {}
      set({ status: 'ready', progress: 1, error: '' });
    } catch (e) {
      // A normal JS error (not a crash) — clear the guard so we don't misread it.
      try { localStorage.removeItem(GUARD_KEY); } catch (_) {}
      // A half-downloaded file can poison the cache — clear it so a retry is clean.
      try { if (wllama && wllama.cacheManager) await wllama.cacheManager.clear(); } catch (_) {}
      try { if (wllama && wllama.exit) await wllama.exit(); } catch (_) {}
      wllama = null;
      loadPromise = null; // allow a fresh retry
      set({ status: 'error', error: (e && e.message) || 'Could not load the AI model.' });
      throw e;
    }
  }

  function ensureLoaded() {
    if (!isSupported()) { set({ status: 'unsupported' }); return Promise.reject(new Error('On-device AI is not supported on this browser.')); }
    if (state.status === 'ready') return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = doLoad(savedSize());
    return loadPromise;
  }

  async function setModelSize(size) {
    if (!MODELS[size]) return;
    try { localStorage.setItem(SIZE_KEY, size); } catch (e) {}
    if (size === state.size && state.status === 'ready') return;
    try { if (wllama && wllama.exit) await wllama.exit(); } catch (e) {}
    wllama = null;
    loadPromise = null;
    set({ status: 'idle', progress: 0, size, error: '' });
    return ensureLoaded();
  }

  async function chat(messages, opts = {}) {
    await ensureLoaded();
    const onToken = typeof opts.onToken === 'function' ? opts.onToken : () => {};
    let full = '';
    // Keep this call to the minimal, verified-working shape — extra params
    // (sampling/temperature/onNewToken) were the source of a completion error.
    await wllama.createChatCompletion({
      messages,
      stream: true,
      nPredict: opts.maxTokens || 400,
      onData: (chunk) => {
        const piece = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (piece) { full += piece; onToken(full, piece); }
      },
    });
    return full;
  }

  state.size = savedSize();

  window.AI = {
    MODELS,
    getState,
    isSupported,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    ensureLoaded,
    setModelSize,
    chat,
    currentSize: savedSize,
    // True when the previous load never completed (page likely crashed mid-load).
    hadLoadCrash: () => hadLoadCrash,
  };
})();
