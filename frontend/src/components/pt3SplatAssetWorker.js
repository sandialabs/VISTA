// Creates the dedicated worker that fetches and parses PT3 splat assets.
// Kept in its own module because `import.meta` is not available under Jest;
// tests that render the viewer get a module mock via jest moduleNameMapper.
export function createSplatWorker() {
  return new Worker(new URL('./pt3SplatAsset.worker.js', import.meta.url));
}
