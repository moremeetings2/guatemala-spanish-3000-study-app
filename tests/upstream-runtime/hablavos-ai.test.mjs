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

