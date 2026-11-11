// Creates the dedicated worker that fetches and parses PT3 splat assets.
// Kept in its own module because `import.meta` is not available under Jest;
// tests that render the viewer get a module mock from src/setupTests.js.
// The worker file uses ES imports, so it is started as a module worker: the Vite dev
// server serves it unbundled, and the production build bundles it either way.
export function createSplatWorker() {
  return new Worker(new URL('./pt3SplatAsset.worker.js', import.meta.url), { type: 'module' });
}
