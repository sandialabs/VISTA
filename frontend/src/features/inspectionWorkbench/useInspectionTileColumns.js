import { useEffect, useMemo, useState } from 'react';

export function clampTileColumnCount(value, maxColumns, fallbackColumns = 3) {
  const max = Math.max(1, Number(maxColumns) || 1);
  const fallback = Math.max(1, Math.min(Number(fallbackColumns) || 1, max));
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  return Math.round(Math.min(Math.max(base, 1), max));
}

export default function useInspectionTileColumns({
  configuredMaxColumns,
  imageCount,
  initialColumnCount = 3,
}) {
  const [tileColumnCount, setTileColumnCount] = useState(initialColumnCount);
  const loadedTileColumnMax = Math.max(1, Number(imageCount) || 1);
  const tileColumnMax = Math.max(1, Math.min(Number(configuredMaxColumns) || 1, loadedTileColumnMax));
  const normalizedTileColumnCount = useMemo(
    () => clampTileColumnCount(tileColumnCount, tileColumnMax, Math.min(3, tileColumnMax)),
    [tileColumnCount, tileColumnMax],
  );

  useEffect(() => {
    if (imageCount === 0) return;
    if (tileColumnCount !== normalizedTileColumnCount) {
      setTileColumnCount(normalizedTileColumnCount);
    }
  }, [imageCount, normalizedTileColumnCount, tileColumnCount]);

  return {
    loadedTileColumnMax,
    normalizedTileColumnCount,
    setTileColumnCount,
    tileColumnCount,
    tileColumnMax,
  };
}
