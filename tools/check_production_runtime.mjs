const origin = process.env.HABLAVOS_ORIGIN || "https://hablavos.com";
const modules = [
  "ai-runtime/hablavos-ai.js",
  "ai-runtime/browser-runtime-loader.js",
  "ai-runtime/disk-backed-embedding.js",
  "ai-runtime/model-lifecycle.js",
  "ai-runtime/model-session.js",
  "ai-runtime/page-lifecycle.js",
  "ai-runtime/platform-profile.js",
  "ai-runtime/runtime-patch.js",
  "ai-runtime/weight-range-plan.js",
  "ai-runtime/vendor/es-module-lexer.js",
];

for (const modulePath of modules) {
  const url = new URL(modulePath, `${origin}/`);
  url.searchParams.set("mimecheck", Date.now());
  const response = await fetch(url, { cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !/javascript/i.test(contentType)) {
    throw new Error(
      `${modulePath}: expected JavaScript response, got HTTP ${response.status} ${contentType || "without Content-Type"}`,
    );
  }
  process.stdout.write(`${modulePath}: ${contentType}\n`);
}
