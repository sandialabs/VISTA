import { useCallback, useMemo, useState } from 'react';

export function toggleCollapsedPartId(previousIds, partId) {
  const key = String(partId || '');
  if (!key) return previousIds;
  const normalized = Array.isArray(previousIds) ? previousIds.map((entry) => String(entry)) : [];
  return normalized.includes(key)
    ? normalized.filter((entry) => entry !== key)
    : [...normalized, key];
}

export default function useCollapsedPartRows(initialIds = []) {
  const [collapsedPartIds, setCollapsedPartIds] = useState(initialIds);
  const collapsedPartIdSet = useMemo(
    () => new Set(collapsedPartIds.map((id) => String(id))),
    [collapsedPartIds],
  );
  const togglePartCollapsed = useCallback((partId) => {
    setCollapsedPartIds((prev) => toggleCollapsedPartId(prev, partId));
  }, []);

  return {
    collapsedPartIds,
    collapsedPartIdSet,
    setCollapsedPartIds,
    togglePartCollapsed,
  };
}
