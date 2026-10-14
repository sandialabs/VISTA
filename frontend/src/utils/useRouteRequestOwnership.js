import { useCallback, useEffect, useRef } from 'react';

/**
 * Owns asynchronous work for a mounted component and a specific route key.
 *
 * AbortController alone is not sufficient: test doubles and already-completed
 * network requests may still resolve after abort. The route generation check is
 * the final authority for whether a response may update component state.
 */
export default function useRouteRequestOwnership(routeKey) {
  const normalizedRouteKey = String(routeKey ?? '');
  const identityRef = useRef({
    routeKey: normalizedRouteKey,
    generation: 0
  });
  const mountedRef = useRef(true);
  const requestsRef = useRef(new Set());

  if (identityRef.current.routeKey !== normalizedRouteKey) {
    identityRef.current = {
      routeKey: normalizedRouteKey,
      generation: identityRef.current.generation + 1
    };
  }

  const abortGeneration = useCallback((generation) => {
    requestsRef.current.forEach((request) => {
      if (request.generation === generation) {
        request.controller.abort();
        requestsRef.current.delete(request);
      }
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const generation = identityRef.current.generation;

    return () => {
      abortGeneration(generation);
    };
  }, [abortGeneration, normalizedRouteKey]);

  useEffect(() => {
    const requests = requestsRef.current;
    return () => {
      mountedRef.current = false;
      requests.forEach((request) => request.controller.abort());
      requests.clear();
    };
  }, []);

  const captureOwner = useCallback(() => {
    return { ...identityRef.current };
  }, []);

  const beginRequest = useCallback(() => {
    const request = {
      ...identityRef.current,
      controller: new AbortController()
    };
    requestsRef.current.add(request);
    return request;
  }, []);

  const isCurrent = useCallback((owner) => {
    const current = identityRef.current;
    return Boolean(
      owner &&
      mountedRef.current &&
      owner.routeKey === current.routeKey &&
      owner.generation === current.generation &&
      !owner.controller?.signal.aborted
    );
  }, []);

  const releaseRequest = useCallback((request) => {
    requestsRef.current.delete(request);
  }, []);

  return {
    beginRequest,
    captureOwner,
    isCurrent,
    releaseRequest
  };
}

export function isAbortError(error, request) {
  return Boolean(
    request?.controller.signal.aborted ||
    error?.name === 'AbortError'
  );
}
