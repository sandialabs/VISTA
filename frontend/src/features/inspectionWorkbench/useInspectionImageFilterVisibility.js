import { useCallback, useState } from 'react';

function normalizeFilterValues(values = []) {
  return values.map((value) => String(value || '').toLowerCase()).filter(Boolean);
}

export function setAllFilterValuesVisibility(previousValues, values = [], visible) {
  const keys = normalizeFilterValues(values);
  if (keys.length === 0) return previousValues;
  const next = new Set(normalizeFilterValues(previousValues));
  keys.forEach((key) => {
    if (visible) next.delete(key);
    else next.add(key);
  });
  return Array.from(next);
}

export function selectOnlyFilterValue(previousValues, values = [], selectedValue = '') {
  const selectedKey = String(selectedValue || '').toLowerCase();
  const keys = normalizeFilterValues(values);
  if (!selectedKey || keys.length === 0) return previousValues;
  const next = new Set(normalizeFilterValues(previousValues));
  keys.forEach((key) => {
    if (key === selectedKey) next.delete(key);
    else next.add(key);
  });
  return Array.from(next);
}

export default function useInspectionImageFilterVisibility({
  defaultSecondaryImageFilterKey,
  effectiveSecondaryImageFilterKey,
  setAnnotationsVisible,
}) {
  const [hiddenPrimaryImageFilterValues, setHiddenPrimaryImageFilterValues] = useState([]);
  const [hiddenModalityImageFilterValues, setHiddenModalityImageFilterValues] = useState([]);
  const [hiddenSecondaryImageFilterValues, setHiddenSecondaryImageFilterValues] = useState([]);

  const setAllViewVisibility = useCallback((viewNames = [], visible) => {
    setHiddenPrimaryImageFilterValues((prev) => setAllFilterValuesVisibility(prev, viewNames, visible));
  }, []);

  const selectOnlyViewVisibility = useCallback((viewNames = [], selectedViewName = '') => {
    setHiddenPrimaryImageFilterValues((prev) => selectOnlyFilterValue(prev, viewNames, selectedViewName));
  }, []);

  const setAllModalityFilterVisibility = useCallback((values = [], visible) => {
    setHiddenModalityImageFilterValues((prev) => setAllFilterValuesVisibility(prev, values, visible));
  }, []);

  const selectOnlyModalityFilterVisibility = useCallback((values = [], selectedValue = '') => {
    setHiddenModalityImageFilterValues((prev) => selectOnlyFilterValue(prev, values, selectedValue));
  }, []);

  const setAllLayerVisibility = useCallback((visible, layerAvailability = {}) => {
    const values = Object.keys(layerAvailability).filter((category) => layerAvailability[category]);
    setHiddenSecondaryImageFilterValues((prev) => setAllFilterValuesVisibility(prev, values, visible));
    if (
      effectiveSecondaryImageFilterKey === defaultSecondaryImageFilterKey
      && layerAvailability.annotation
      && visible
    ) {
      setAnnotationsVisible(true);
    }
  }, [defaultSecondaryImageFilterKey, effectiveSecondaryImageFilterKey, setAnnotationsVisible]);

  const selectOnlyLayerVisibility = useCallback((categoryId, layerAvailability = {}) => {
    if (!categoryId || !layerAvailability[categoryId]) return;
    const categoryKeys = Object.keys(layerAvailability).filter((category) => layerAvailability[category]);
    setHiddenSecondaryImageFilterValues(categoryKeys.filter((category) => category !== categoryId));
    if (effectiveSecondaryImageFilterKey === defaultSecondaryImageFilterKey && categoryId === 'annotation') {
      setAnnotationsVisible(true);
    }
  }, [defaultSecondaryImageFilterKey, effectiveSecondaryImageFilterKey, setAnnotationsVisible]);

  return {
    hiddenPrimaryImageFilterValues,
    hiddenModalityImageFilterValues,
    hiddenSecondaryImageFilterValues,
    selectOnlyLayerVisibility,
    selectOnlyModalityFilterVisibility,
    selectOnlyViewVisibility,
    setAllLayerVisibility,
    setAllModalityFilterVisibility,
    setAllViewVisibility,
    setHiddenPrimaryImageFilterValues,
    setHiddenModalityImageFilterValues,
    setHiddenSecondaryImageFilterValues,
  };
}
