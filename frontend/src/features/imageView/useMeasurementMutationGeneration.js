import { useCallback, useRef } from 'react';

// Measurement writes are optimistic in the active route but serialized by
// project-image resource for the lifetime of the view. This hook owns the
// generation counter that decides which mutation attempt is the most recent
// one for a given image: a later mutation (or a navigation away from the
// image) advances the generation, and any earlier in-flight mutation that
// resolves after that must not apply its result to component state.
export default function useMeasurementMutationGeneration() {
  const generationRef = useRef(0);

  // Advances the generation without tracking it as a specific mutation's
  // generation. Used when measurement state is being reset (new image load,
  // route teardown) so any in-flight mutation from before the reset is
  // treated as stale.
  const advanceGeneration = useCallback(() => {
    generationRef.current += 1;
  }, []);

  // Advances the generation and returns the new value so the caller can
  // later confirm its own mutation is still the most recent one.
  const beginGeneration = useCallback(() => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  // True when `generation` (previously returned by beginGeneration) is still
  // the most recent generation, i.e. no later mutation or reset has occurred.
  const isCurrentGeneration = useCallback((generation) => (
    generationRef.current === generation
  ), []);

  return { advanceGeneration, beginGeneration, isCurrentGeneration };
}
