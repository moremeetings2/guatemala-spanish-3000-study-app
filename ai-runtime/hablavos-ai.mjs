import { loadBrowserRuntime } from "./browser-runtime-loader.mjs";
import { ModelLifecycle } from "./model-lifecycle.mjs";
import { ModelSession } from "./model-session.mjs";
import { installPageLifecycle } from "./page-lifecycle.mjs";
import { getLoaderProfile, isIOSUserAgent } from "./platform-profile.mjs";

export const MODEL_KEY = "gemma-4-e2b";
export const MODEL = Object.freeze({
  id: "google/gemma-4-E2B-it-qat-mobile-transformers",
  label: "Gemma 4 E2B",
  note: "WebGPU on-device model",
  mb: 2400,
});

const STATUS_MAP = {
  idle: "idle",
  acquiring: "loading",
  loading: "downloading",
  warming: "loading",
  ready: "ready",
  blocked: "blocked",
  releasing: "loading",
  error: "error",
};

export function createHablavosAI(deps = {}) {
  const navigatorImpl = deps.navigatorImpl ?? globalThis.navigator;
  const windowImpl = deps.windowImpl ?? globalThis.window;
  const secureContext = deps.secureContext ?? globalThis.isSecureContext;
  const importRuntime = deps.importRuntime ?? loadBrowserRuntime;
  const noAI = deps.noAI ?? Boolean(globalThis.__NO_AI__);
  const listeners = new Set();
  const state = {
    status: isSupported() ? "idle" : "unsupported",
    progress: 0,
    phase: "idle",
    progressText: "",
    size: MODEL_KEY,
    error: "",
    model: MODEL,
  };
  let model = null;
  let generating = false;

  function snapshot() {
    return { ...state, model: MODEL };
  }

  function emit(patch = {}) {
    Object.assign(state, patch);
    const value = snapshot();
    listeners.forEach((listener) => {
      try { listener(value); } catch (_) {}
    });
    deps.onStateChange?.(value);
  }

  function isSupported() {
    return Boolean(
      secureContext
      && navigatorImpl?.gpu
      && navigatorImpl?.locks?.request
    );
  }

  const session = deps.session ?? new ModelSession({
    locks: navigatorImpl?.locks,
    onStateChange(sessionState) {
      if (sessionState === "blocked") {
        emit({
          status: "blocked",
          phase: "blocked",
          error: "The Gemma 4 model is active in another tab.",
        });
      }
    },
  });

  const lifecycle = deps.lifecycle ?? new ModelLifecycle({
    session,
    importRuntime,
    loaderProfile: deps.loaderProfile ?? getLoaderProfile(navigatorImpl?.userAgent),
    onStateChange(lifecycleState) {
      emit({
        status: STATUS_MAP[lifecycleState] ?? state.status,
        phase: lifecycleState,
      });
    },
  });

  function onProgress(event = {}) {
    const progress = Number.isFinite(event.fraction)
      ? Math.max(0, Math.min(1, event.fraction))
      : state.progress;
    const status = event.status === "weights" ? "downloading" : "loading";
    emit({
      status,
      phase: event.status ?? state.phase,
      progress,
      progressText: event.message ?? "",
    });
  }

  async function ensureLoaded() {
    if (!isSupported()) {
      const error = new Error("Gemma 4 requires WebGPU, Web Locks, and a secure browser context.");
      emit({ status: "unsupported", error: error.message });
      throw error;
    }
    if (model) return;
    if (noAI) throw new Error("On-device AI loading is disabled for this test session.");

    emit({ status: "loading", phase: "acquiring", error: "" });
    try {
      const result = await lifecycle.load({ onProgress });
      if (result.status === "blocked") {
        const error = new Error("The Gemma 4 model is active in another tab.");
        emit({ status: "blocked", phase: "blocked", error: error.message });
        throw error;
      }
      model = result.model;
      emit({
        status: "ready",
        phase: "ready",
        progress: 1,
        progressText: "",
        error: "",
      });
    } catch (error) {
      if (state.status !== "blocked") {
        emit({
          status: "error",
          phase: "error",
          error: error?.message || "Could not load Gemma 4.",
        });
      }
      throw error;
    }
  }

  async function chat(messages, opts = {}) {
    if (generating) throw new Error("The on-device tutor is already generating a response.");
    await ensureLoaded();
    generating = true;
    let full = "";
    try {
      model.reset?.();
      const stream = model.generate(messages, {
        maxNewTokens: opts.maxTokens || 400,
        signal: opts.signal,
      });
      for await (const chunk of stream) {
        const next = typeof chunk === "string" ? chunk : String(chunk?.text ?? "");
        const piece = next.startsWith(full) ? next.slice(full.length) : next;
        full = next.startsWith(full) ? next : full + next;
        if (piece) opts.onToken?.(full, piece);
      }
      return full;
    } finally {
      generating = false;
    }
  }

  async function dispose() {
    generating = false;
    await lifecycle.dispose();
    model = null;
    emit({ status: "idle", phase: "idle", progress: 0, progressText: "", error: "" });
  }

  if (windowImpl?.addEventListener) {
    installPageLifecycle({
      window: windowImpl,
      dispose,
      onError: (error) => console.error("[AI] Gemma 4 page teardown failed:", error),
    });
  }

  return {
    MODELS: Object.freeze({ [MODEL_KEY]: MODEL }),
    getState: snapshot,
    isSupported,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensureLoaded,
    chat,
    dispose,
    currentSize: () => MODEL_KEY,
    hadLoadCrash: () => false,
    isMobileDevice: () => isIOSUserAgent(navigatorImpl?.userAgent ?? "")
      || /Android/i.test(navigatorImpl?.userAgent ?? ""),
  };
}
