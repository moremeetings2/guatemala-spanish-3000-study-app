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
  const DEFAULT_SIZE = '1.2B';
  const SIZE_KEY = 'spanishAiModelSize.v1';
  const N_CTX = 2048;

  const state = { status: 'idle', progress: 0, size: DEFAULT_SIZE, error: '' };
  const listeners = new Set();
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
      await importWllama();
      wllama = new WllamaCtor(WasmCdn, { logger: quietLogger });
      await wllama.loadModelFromHF(
        { repo: model.repo, file: model.file },
        {
          n_ctx: N_CTX,
          useCache: true,
          progressCallback: ({ loaded, total }) => {
            if (!total) return;
            const p = Math.min(1, loaded / total);
            // Once bytes are in, the WASM still has to build the model: show that as "loading".
            set({ status: p >= 1 ? 'loading' : 'downloading', progress: p });
          },
        }
      );
      set({ status: 'ready', progress: 1, error: '' });
    } catch (e) {
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
  };
})();
