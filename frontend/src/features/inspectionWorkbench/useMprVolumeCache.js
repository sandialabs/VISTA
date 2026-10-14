import { useEffect, useMemo, useState } from 'react';
import { isServerVolumeDescriptor, hasMprVolumeSource } from './volumeDescriptors';
import {
  mprVolumeCacheStore,
  getMprVolumeCacheKey,
  rememberMprVolumeCache,
  createServerMprVolumeCache,
  getStackOverlayStyle,
  buildMprVolumeCache,
} from './mprSliceCache';

export function useMprVolumeCache(imageStack, dimensions) {
  const cacheKey = useMemo(() => getMprVolumeCacheKey(imageStack, dimensions), [dimensions, imageStack]);
  const [cacheState, setCacheState] = useState({ key: '', status: 'idle', cache: null, progress: { loadedSlices: 0, totalSlices: 0 } });

  useEffect(() => {
    if (!cacheKey || !hasMprVolumeSource(imageStack)) {
      setCacheState({ key: '', status: 'idle', cache: null, progress: { loadedSlices: 0, totalSlices: 0 } });
      return undefined;
    }
    if (isServerVolumeDescriptor(imageStack)) {
      const cached = mprVolumeCacheStore.get(cacheKey);
      const cache = cached || createServerMprVolumeCache(cacheKey, imageStack, dimensions);
      if (!cached) rememberMprVolumeCache(cacheKey, cache);
      setCacheState({ key: cacheKey, status: 'ready', cache, progress: { loadedSlices: 0, totalSlices: 0 } });
      return undefined;
    }
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      setCacheState({ key: cacheKey, status: 'idle', cache: null, progress: { loadedSlices: 0, totalSlices: imageStack.length } });
      return undefined;
    }

    const cached = mprVolumeCacheStore.get(cacheKey);
    if (cached) {
      setCacheState({ key: cacheKey, status: 'ready', cache: cached, progress: { loadedSlices: imageStack.length, totalSlices: imageStack.length } });
      return undefined;
    }

    let cancelled = false;
    setCacheState({ key: cacheKey, status: 'loading', cache: null, progress: { loadedSlices: 0, totalSlices: imageStack.length } });
    buildMprVolumeCache(cacheKey, imageStack, dimensions, (progress) => {
      if (!cancelled) setCacheState((previous) => ({ ...previous, status: 'loading', progress }));
    }).then((cache) => {
      if (cancelled) return;
      if (!cache) {
        setCacheState({ key: cacheKey, status: 'error', cache: null, progress: { loadedSlices: 0, totalSlices: imageStack.length } });
        return;
      }
      rememberMprVolumeCache(cacheKey, cache);
      setCacheState({ key: cacheKey, status: 'ready', cache, progress: { loadedSlices: imageStack.length, totalSlices: imageStack.length } });
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, dimensions, imageStack]);

  return cacheState;
}

export function useMprVolumeCaches(imageStacks, dimensions) {
  const cacheKeys = useMemo(
    () => (Array.isArray(imageStacks) ? imageStacks : []).map((stack) => getMprVolumeCacheKey(stack.stack || stack, dimensions)),
    [dimensions, imageStacks],
  );
  const [cacheStates, setCacheStates] = useState([]);

  useEffect(() => {
    const stacks = Array.isArray(imageStacks) ? imageStacks : [];
    const sources = stacks.map((stack) => stack.stack || stack);
    if (stacks.length === 0) {
      setCacheStates([]);
      return undefined;
    }
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      setCacheStates(cacheKeys.map((key, index) => {
        const source = sources[index];
        if (!key || !isServerVolumeDescriptor(source)) return { key, status: 'idle', cache: null };
        const cached = mprVolumeCacheStore.get(key);
        const cache = cached || createServerMprVolumeCache(key, source, dimensions);
        if (!cached) rememberMprVolumeCache(key, cache);
        return { key, status: 'ready', cache };
      }));
      return undefined;
    }

    let cancelled = false;
    setCacheStates(cacheKeys.map((key) => ({ key, status: key ? 'loading' : 'idle', cache: key ? (mprVolumeCacheStore.get(key) || null) : null })));
    Promise.all(sources.map(async (stack, index) => {
      const key = cacheKeys[index];
      const overlayStyle = getStackOverlayStyle(stacks[index]);
      if (!key || !hasMprVolumeSource(stack)) return { key: '', status: 'idle', cache: null };
      const cached = mprVolumeCacheStore.get(key);
      if (cached) return { key, status: 'ready', cache: { ...cached, ...overlayStyle } };
      if (isServerVolumeDescriptor(stack)) {
        const cache = { ...createServerMprVolumeCache(key, stack, dimensions), ...overlayStyle };
        rememberMprVolumeCache(key, cache);
        return { key, status: 'ready', cache };
      }
      const cache = await buildMprVolumeCache(key, stack, dimensions);
      if (!cache) return { key, status: 'error', cache: null };
      const styledCache = { ...cache, ...overlayStyle };
      rememberMprVolumeCache(key, styledCache);
      return { key, status: 'ready', cache: styledCache };
    })).then((states) => {
      if (!cancelled) setCacheStates(states);
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKeys, dimensions, imageStacks]);

  return cacheStates;
}
