import { getInspectionAnnotationDisplayName, getInspectionAnnotationTypeLabel } from '../../components/inspectionAnnotationAdapter';

export function normalizeSavedMeasurements(measurements) {
  if (!Array.isArray(measurements)) return [];
  return measurements
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      const value = typeof entry.value === 'string'
        ? entry.value.trim()
        : Number.isFinite(entry.value)
          ? String(entry.value)
          : '';
      if (!label || !value) return null;
      return {
        id: entry.id ? String(entry.id) : '',
        label,
        value,
      };
    })
    .filter(Boolean);
}

export function getAnnotationListType(annotation) {
  return getInspectionAnnotationTypeLabel(annotation);
}

export function getAnnotationListValue(annotation) {
  return getInspectionAnnotationDisplayName(annotation);
}

export function getAnnotationTooltip(annotation) {
  if (!annotation || typeof annotation !== 'object') return '';
  const details = [];
  const type = getAnnotationListType(annotation);
  const value = getAnnotationListValue(annotation);
  if (type) details.push(type);
  if (value) details.push(value);
  const createdAt = formatAnnotationTimestamp(getAnnotationCreatedAt(annotation));
  if (createdAt) details.push(`Created: ${createdAt}`);
  details.push(`By: ${getAnnotationCreator(annotation)}`);
  return details.join(' • ');
}

export function getAnnotationCreator(annotation) {
  const creator = String(annotation?.created_by || annotation?.createdBy || '').trim();
  if (creator) return creator;
  const updatedBy = String(annotation?.updated_by || annotation?.updatedBy || '').trim();
  return updatedBy || 'Unknown user';
}

export function getAnnotationCreatedAt(annotation) {
  return annotation?.created_at || annotation?.createdAt || annotation?.updated_at || annotation?.updatedAt || '';
}

export function formatAnnotationTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}
