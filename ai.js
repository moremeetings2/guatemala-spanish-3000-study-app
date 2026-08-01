"use strict";

// Synchronous facade for the module-backed Gemma 4 WebGPU runtime.
(function () {
  const MODEL_KEY = "gemma-4-e2b";
  const MODEL = Object.freeze({
    id: "google/gemma-4-E2B-it-qat-mobile-transformers",
    label: "Gemma 4 E2B",
    note: "WebGPU on-device model",
    mb: 2400,
  });
  const listeners = new Set();
  let implementation = null;
  let state = {
    status: "idle",
    progress: 0,
    phase: "idle",
    progressText: "",
    size: MODEL_KEY,
    error: "",
    model: MODEL,
  };

  function snapshot() {
    return { ...state, model: MODEL };
  }

  function publish(next) {
    state = { ...state, ...next, model: MODEL, size: MODEL_KEY };
    const value = snapshot();
    listeners.forEach((listener) => {
      try { listener(value); } catch (_) {}
    });
  }

  const moduleReady = import("./ai-runtime/hablavos-ai.js")
    .then(({ createHablavosAI }) => {
      implementation = createHablavosAI({
        noAI: Boolean(window.__NO_AI__),
        onStateChange: publish,
      });
      publish(implementation.getState());
      return implementation;
    })
    .catch((error) => {
      publish({
        status: "error",
        phase: "error",
        error: error?.message || "Could not initialize Gemma 4.",
      });
      throw error;
    });

  // Avoid an unhandled rejection while preserving the original error for callers.
  moduleReady.catch(() => {});

  window.AI = {
    MODELS: Object.freeze({ [MODEL_KEY]: MODEL }),
    getState: snapshot,
    isSupported() {
      if (implementation) return implementation.isSupported();
      return Boolean(
        window.isSecureContext
        && navigator.gpu
        && navigator.locks?.request
      );
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async ensureLoaded() {
      return (await moduleReady).ensureLoaded();
    },
    async chat(messages, opts) {
      return (await moduleReady).chat(messages, opts);
    },
    async dispose() {
      return (await moduleReady).dispose();
    },
    currentSize: () => MODEL_KEY,
    hadLoadCrash: () => false,
    isMobileDevice: () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
  };
})();
