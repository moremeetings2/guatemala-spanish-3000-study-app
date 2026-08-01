import assert from "node:assert/strict";
import test from "node:test";

import { createHablavosAI } from "../../ai-runtime/hablavos-ai.mjs";

test("streams Gemma full-text snapshots through the Hablavos callback contract", async () => {
  let resets = 0;
  const model = {
    reset() { resets += 1; },
    async *generate(messages, options) {
      assert.deepEqual(messages, [{ role: "user", content: "Hola" }]);
      assert.equal(options.maxNewTokens, 16);
      yield { text: "Hola, " };
      yield { text: "Hola, ¿cómo estás?" };
    },
  };
  const lifecycle = {
    async load() { return { status: "ready", model }; },
    async dispose() {},
  };
  const navigatorImpl = {
    gpu: {},
    locks: { request() {} },
    userAgent: "Desktop Test",
  };
  const windowImpl = {
    addEventListener() {},
    removeEventListener() {},
  };
  const ai = createHablavosAI({
    lifecycle,
    navigatorImpl,
    windowImpl,
    secureContext: true,
    noAI: false,
  });
  const emissions = [];

  const answer = await ai.chat([{ role: "user", content: "Hola" }], {
    maxTokens: 16,
    onToken: (full, piece) => emissions.push({ full, piece }),
  });

  assert.equal(answer, "Hola, ¿cómo estás?");
  assert.equal(resets, 1);
  assert.deepEqual(emissions, [
    { full: "Hola, ", piece: "Hola, " },
    { full: "Hola, ¿cómo estás?", piece: "¿cómo estás?" },
  ]);
});

test("rejects an overlapping completion while the first completion is loading", async () => {
  let finishLoad;
  const loadGate = new Promise((resolve) => { finishLoad = resolve; });
  const model = {
    async *generate() { yield { text: "listo" }; },
  };
  const ai = createHablavosAI({
    lifecycle: {
      async load() {
        await loadGate;
        return { status: "ready", model };
      },
      async dispose() {},
    },
    navigatorImpl: { gpu: {}, locks: { request() {} }, userAgent: "Desktop Test" },
    windowImpl: { addEventListener() {}, removeEventListener() {} },
    secureContext: true,
    noAI: false,
  });

  const first = ai.chat([{ role: "user", content: "primero" }]);
  await assert.rejects(
    ai.chat([{ role: "user", content: "segundo" }]),
    /already generating/
  );
  finishLoad();
  assert.equal(await first, "listo");
});
