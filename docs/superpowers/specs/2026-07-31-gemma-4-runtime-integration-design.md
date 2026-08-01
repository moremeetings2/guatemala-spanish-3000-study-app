# Gemma 4 Browser Runtime Integration

## Goal

Replace Hablavos's wllama/LiquidAI in-browser inference stack with the tested Gemma 4 WebGPU model harness and runtime infrastructure from `moorej2400/gemma-4-webml-webgpu`, while preserving the study application's existing tutor and My Words experiences.

## Source And Scope

The integration vendors the source repository's browser runtime loader, model lifecycle, exclusive browser-session ownership, platform profile, Safari memory controls, range-download support, runtime patching, required vendor utilities, model manifest, and third-party notices into this repository. Hablavos will not depend on the source site's deployment at runtime.

The model is the single fixed `google/gemma-4-E2B-it-qat-mobile-transformers` model used by the source project. The current 350M, 700M, and 1.2B LiquidAI choices and their Settings selector will be removed. Model weights remain remotely downloaded from Hugging Face and are not committed to this repository.

## Architecture

The vendored modules remain focused and recognizable so fixes from the source repository can be compared and imported later. Hablavos's `ai.js` becomes a compatibility adapter over those modules and continues exposing the narrow `window.AI` facade consumed by `app.js`:

- capability and state queries
- state-change subscriptions
- demand-driven loading
- streamed chat completion
- device classification and prior-load safety signals where still applicable

Model-size mutation is removed from both the facade and UI. `AI.MODELS` may remain as a one-entry read-only compatibility value only where existing presentation code benefits from it; users receive no model choice.

## Loading And Ownership

The model does not load at page boot or automatically after login. Opening the tutor or invoking My Words AI assist starts loading. This matches the source harness and avoids an unsolicited approximately 2.4 GB transfer.

Before runtime import, adapter creation, or model fetch, the page acquires the source system's origin-wide Web Lock. Only one tab may load or own GPU model resources. A competing tab remains lightweight and receives an actionable blocked state instead of allocating a second model.

Successful loading includes runtime preparation, tokenizer and ranged weight loading, model initialization, and warmup. The model is published to the adapter only after all stages succeed. Failure disposes partial resources and releases ownership. A real page exit disposes the model; a persisted back-forward-cache transition retains valid state according to the source lifecycle behavior.

## Generation

The compatibility adapter converts Hablavos's `{ role, content }` message array to the message shape expected by Gemma 4. It forwards the existing token limit and abort semantics where supported, consumes the runtime's async generation stream, and calls Hablavos's existing `onToken(fullText, newText)` callback without changing chat rendering.

The existing context-specific system prompts for general tutoring, vocabulary, readers, lexicons, and My Words remain application-owned. Only the inference engine changes.

Concurrent tutor and My Words completions remain prohibited by the current application state. The adapter additionally serializes or rejects overlapping generation if necessary to protect the single runtime instance.

## UI States

Settings shows a single on-device model row for Gemma 4 E2B with status and approximate first-download size, without selector controls or language suggesting other model sizes are available.

The existing chat download surface maps source lifecycle events into these user-facing states:

- unsupported browser or insecure context
- another tab owns the model
- requesting WebGPU
- loading tokenizer
- downloading model weights with progress when available
- preparing and warming the model
- ready
- generation or loading failure with retry

Browser requirements are WebGPU, Web Locks, a secure context, sufficient memory, and sufficient browser storage/cache capacity. Chrome and Safari use the source platform-specific runtime profiles.

## Offline And Caching

Static runtime modules and vendored support files are included in the PWA application cache. Multi-gigabyte model files are not added to the service worker cache; the source runtime's browser-cache and range-loading behavior remains authoritative. Existing offline study content continues to work without the model. The tutor requires a completed prior model download/cache state or network access.

## Licensing And Attribution

The source repository's applicable third-party notices and runtime provenance are copied and retained. The Gemma model license is documented separately from the WebML runtime provenance. No generated runtime artifact will be committed unless the source repository's own redistribution and preparation rules permit it; otherwise, its tested build/preparation process will be embedded and run as part of the application's deployment build.

## Error Handling

Capability failures are detected before downloading. Loading errors clear partial model state, dispose GPU resources, release the Web Lock, publish a useful error, and permit retry. A blocked tab does not fetch tokenizer or weight resources. Runtime generation errors leave the chat usable for retry and do not silently return partial success.

## Testing

Development follows red-green-refactor. Integration coverage will verify:

- the one-model Gemma facade and removal of size mutation
- Settings presents one fixed model with no selector
- unsupported and blocked-tab states are surfaced
- only the lock owner begins runtime/model loading
- load failure and page lifecycle cleanup release resources
- Gemma generation streams through the existing tutor UI
- My Words AI assist continues using the shared engine
- no model download occurs during ordinary boot or automated UI tests

The copied source unit and browser tests relevant to the embedded modules will be retained or adapted. Hablavos's complete Playwright suite must pass on Chromium and WebKit. Final browser verification will use the configured testing account without committing or exposing credentials; practical full-model verification remains subject to the approximately 2.4 GB download and local browser WebGPU support.

## Documentation And Deployment

`README.md`, project status documentation, service-worker asset lists, and AI-related comments will describe Gemma 4, the browser requirements, the one-model interface, loading behavior, and first-download cost. After verification, the completed implementation will be committed and pushed through the project's normal GitHub Pages path so the production app receives the replacement.

## Non-Goals

- Changing tutor prompts or study content
- Redesigning the chat interface
- Hosting or proxying model weights
- Supporting multiple selectable models
- Allowing simultaneous model copies in multiple tabs
- Adding server-side inference or sending user prompts off device
