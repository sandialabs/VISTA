import { useEffect, useState } from 'react';

import { DEFAULT_INTERFACE_HIERARCHY, loadInterfaceHierarchy } from '../../utils/interfaceHierarchy';
import { normalizeInterfaceHierarchy, selectMainTab } from './projectTabRouting';

// Loads the interface hierarchy (polling in development) and keeps the active
// main tab inside it. Not project-scoped, so it uses a local cancel flag.
export default function useInterfaceHierarchy({ setActiveMainTab, validQueryMainTab }) {
  const [interfaceHierarchy, setInterfaceHierarchy] = useState(DEFAULT_INTERFACE_HIERARCHY);

  useEffect(() => {
    let cancelled = false;
    let lastSerializedHierarchy = '';

    const loadHierarchy = async ({ cacheBust = false } = {}) => {
      const hierarchy = await loadInterfaceHierarchy({ cacheBust });
      if (cancelled) return;
      const nextHierarchy = normalizeInterfaceHierarchy(hierarchy);
      const serializedHierarchy = JSON.stringify(nextHierarchy);
      if (serializedHierarchy === lastSerializedHierarchy) return;
      lastSerializedHierarchy = serializedHierarchy;
      setInterfaceHierarchy(nextHierarchy);
      setActiveMainTab((prev) => selectMainTab(nextHierarchy.mainTabs, validQueryMainTab, prev));
    };
    loadHierarchy();

    const pollMs = Number(window.__VISTA_INTERFACE_HIERARCHY_POLL_MS || 1500);
    const shouldPollHierarchy = process.env.NODE_ENV === 'development' && Number.isFinite(pollMs) && pollMs > 0;
    const intervalId = shouldPollHierarchy
      ? window.setInterval(() => loadHierarchy({ cacheBust: true }), pollMs)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [setActiveMainTab, validQueryMainTab]);

  return interfaceHierarchy;
}
