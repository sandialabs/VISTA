import { useCallback, useState } from 'react';

function normalizeModalityValues(values = []) {
  return values.map((value) => String(value || '').toLowerCase()).filter(Boolean);
}

export function setAllModalitiesVisibility(previousModalities, modalities = [], visible) {
  const keys = normalizeModalityValues(modalities);
  if (keys.length === 0) return previousModalities;
  const next = new Set(normalizeModalityValues(previousModalities));
  keys.forEach((key) => {
    if (visible) next.add(key);
    else next.delete(key);
  });
  return Array.from(next);
}

export function selectOnlyModality(modalities = [], selectedModality = '') {
  const selectedKey = String(selectedModality || '').toLowerCase();
  const keys = normalizeModalityValues(modalities);
  if (!selectedKey || !keys.includes(selectedKey)) return null;
  return [selectedKey];
}

export function ensureModalityEnabled(previousModalities, modality = '') {
  const key = String(modality || '').toLowerCase();
  if (!key) return previousModalities;
  const normalized = normalizeModalityValues(previousModalities);
  return normalized.includes(key) ? previousModalities : [...previousModalities, key];
}

export default function useInspectionEnabledModalities(initialModalities = []) {
  const [enabledModalities, setEnabledModalities] = useState(initialModalities);

  const setAllModalityVisibility = useCallback((modalities = [], visible) => {
    setEnabledModalities((prev) => setAllModalitiesVisibility(prev, modalities, visible));
  }, []);

  const selectOnlyModalityVisibility = useCallback((modalities = [], selectedModality = '') => {
    const next = selectOnlyModality(modalities, selectedModality);
    if (next) setEnabledModalities(next);
  }, []);

  const ensureEnabledModality = useCallback((modality = '') => {
    setEnabledModalities((prev) => ensureModalityEnabled(prev, modality));
  }, []);

  return {
    enabledModalities,
    ensureEnabledModality,
    selectOnlyModalityVisibility,
    setAllModalityVisibility,
    setEnabledModalities,
  };
}
