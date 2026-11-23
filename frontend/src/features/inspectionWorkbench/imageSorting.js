import { formatMetadataValue } from './metadataHelpers';
import {
  getProjectImageRecord,
  getProjectImageLookupRecords,
  getImageRefMetadata,
  getMetadataFilterKeyLabel,
} from './imageLookup';

export function getInspectionImageOrderKey(entry) {
  return String(entry?.imageId || entry?.filename || entry?.imageRef || '').trim();
}

export function applyInspectionImageDisplayOrder(entries, imageRefs) {
  const remaining = Array.isArray(entries) ? [...entries] : [];
  const ordered = [];
  const requestedRefs = Array.isArray(imageRefs)
    ? imageRefs.map((imageRef) => String(imageRef || '').trim()).filter(Boolean)
    : [];
  requestedRefs.forEach((imageRef) => {
    let matchIndex = remaining.findIndex(
      (entry) => getInspectionImageOrderKey(entry) === imageRef,
    );
    if (matchIndex < 0) {
      matchIndex = remaining.findIndex((entry) => (
        [entry?.filename, entry?.imageRef]
          .map((candidate) => String(candidate || '').trim())
          .includes(imageRef)
      ));
    }
    if (matchIndex >= 0) {
      ordered.push(remaining.splice(matchIndex, 1)[0]);
    }
  });
  return [...ordered, ...remaining];
}

const INSPECTION_IMAGE_SORT_OPTIONS = [
  { id: 'filename_asc', label: 'Filename' },
  { id: 'type_asc', label: 'Image type' },
];
export const DEFAULT_INSPECTION_IMAGE_SORT_ID = 'filename_asc';
const INSPECTION_IMAGE_METADATA_SORT_PREFIX = 'metadata:';
// A layer sorts descending when its id carries this prefix, e.g. "desc:metadata:camera".
const INSPECTION_IMAGE_SORT_DESC_PREFIX = 'desc:';

export function isInspectionImageSortDescending(sortId) {
  const normalized = String(sortId || '').trim();
  return normalized === 'filename_desc' || normalized.startsWith(INSPECTION_IMAGE_SORT_DESC_PREFIX);
}

// The sort category without its direction; legacy "filename_desc" maps to "filename_asc".
export function getInspectionImageSortBaseId(sortId) {
  const normalized = String(sortId || '').trim();
  if (normalized === 'filename_desc') return 'filename_asc';
  return normalized.startsWith(INSPECTION_IMAGE_SORT_DESC_PREFIX)
    ? normalized.slice(INSPECTION_IMAGE_SORT_DESC_PREFIX.length)
    : normalized;
}

export function setInspectionImageSortDirection(sortId, descending) {
  const baseId = getInspectionImageSortBaseId(sortId);
  return descending ? `${INSPECTION_IMAGE_SORT_DESC_PREFIX}${baseId}` : baseId;
}

export function getInspectionImageSortLayerLabel(sortId, sortOptions = INSPECTION_IMAGE_SORT_OPTIONS) {
  const baseId = getInspectionImageSortBaseId(sortId);
  const label = sortOptions.find((option) => option.id === baseId)?.label || baseId;
  return `${label} (${isInspectionImageSortDescending(sortId) ? 'descending' : 'ascending'})`;
}

const INSPECTION_IMAGE_TYPE_ORDER = { source: 0, overlay: 1, crop: 2 };

function getInspectionImageType(entry) {
  if (entry?.cropChild) return 'crop';
  if (entry?.overlay) return 'overlay';
  return 'source';
}

function getInspectionImageSortFilename(entry, projectImageLookup = {}) {
  const record = getProjectImageRecord(projectImageLookup, {
    image_id: entry?.imageId,
    filename: entry?.filename || entry?.imageRef,
  });
  return String(
    record?.displayName
    || record?.filename
    || entry?.filename
    || entry?.imageRef
    || entry?.label
    || '',
  );
}

// Secondary ordering by the image's own label/filename. User metadata such
// as side or view is sorted through the generic "metadata:<key>" options.
function getInspectionImageSortLabel(entry) {
  return String(entry?.label || entry?.filename || entry?.imageRef || '');
}

function compareInspectionImageSortText(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function makeInspectionImageMetadataSortId(key) {
  return `${INSPECTION_IMAGE_METADATA_SORT_PREFIX}${String(key || '')}`;
}

function getInspectionImageMetadataSortKey(sortId) {
  const normalizedSortId = String(sortId || '');
  if (!normalizedSortId.startsWith(INSPECTION_IMAGE_METADATA_SORT_PREFIX)) return '';
  return normalizedSortId.slice(INSPECTION_IMAGE_METADATA_SORT_PREFIX.length);
}

function getImageMetadataSortKeyOptions(imageRefs = [], projectImageLookup = {}) {
  const keys = new Set();
  getProjectImageLookupRecords(projectImageLookup).forEach((record) => {
    const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    Object.entries(metadata).forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || !formatMetadataValue(value).trim()) return;
      keys.add(normalizedKey);
    });
  });
  imageRefs.forEach((entry) => {
    const metadata = getImageRefMetadata(entry, projectImageLookup);
    Object.entries(metadata).forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || !formatMetadataValue(value).trim()) return;
      keys.add(normalizedKey);
    });
  });
  return Array.from(keys)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .map((key) => ({ id: makeInspectionImageMetadataSortId(key), label: `Metadata: ${getMetadataFilterKeyLabel(key)}` }));
}

export function getInspectionImageSortSelectOptions(imageRefs = [], projectImageLookup = {}) {
  return [
    ...INSPECTION_IMAGE_SORT_OPTIONS,
    ...getImageMetadataSortKeyOptions(imageRefs, projectImageLookup),
  ];
}

export function normalizeInspectionImageSortLayers(
  sortLayers,
  sortOptions = INSPECTION_IMAGE_SORT_OPTIONS,
  allowMetadataSortIds = true,
) {
  const optionIds = new Set(sortOptions.map((option) => option.id));
  const normalized = (Array.isArray(sortLayers) ? sortLayers : [sortLayers])
    .map((sortId) => String(sortId || '').trim())
    .filter((sortId) => {
      const baseId = getInspectionImageSortBaseId(sortId);
      return baseId && (
        optionIds.has(baseId)
        || (allowMetadataSortIds && getInspectionImageMetadataSortKey(baseId))
      );
    })
    .map((sortId) => setInspectionImageSortDirection(sortId, isInspectionImageSortDescending(sortId)));
  return normalized.length > 0 ? normalized : [DEFAULT_INSPECTION_IMAGE_SORT_ID];
}

function compareInspectionImageMetadataSortValue(left, right, direction = 1) {
  const leftValue = formatMetadataValue(left).trim();
  const rightValue = formatMetadataValue(right).trim();
  if (!leftValue && !rightValue) return 0;
  // Missing values stay last in either direction.
  if (!leftValue) return 1;
  if (!rightValue) return -1;
  return direction * compareInspectionImageSortText(leftValue, rightValue);
}

function compareInspectionImageDisplayEntryByLayer(leftEntry, rightEntry, layerSortId, projectImageLookup = {}) {
  const sortId = getInspectionImageSortBaseId(layerSortId);
  const direction = isInspectionImageSortDescending(layerSortId) ? -1 : 1;
  const metadataSortKey = getInspectionImageMetadataSortKey(sortId);
  if (metadataSortKey) {
    return compareInspectionImageMetadataSortValue(
      getImageRefMetadata(leftEntry, projectImageLookup)[metadataSortKey],
      getImageRefMetadata(rightEntry, projectImageLookup)[metadataSortKey],
      direction,
    );
  }
  if (sortId === 'type_asc') {
    return direction * ((
      INSPECTION_IMAGE_TYPE_ORDER[getInspectionImageType(leftEntry)]
      - INSPECTION_IMAGE_TYPE_ORDER[getInspectionImageType(rightEntry)]
    ) || compareInspectionImageSortText(
      getInspectionImageSortLabel(leftEntry),
      getInspectionImageSortLabel(rightEntry),
    ));
  }
  return direction * compareInspectionImageSortText(
    getInspectionImageSortFilename(leftEntry, projectImageLookup),
    getInspectionImageSortFilename(rightEntry, projectImageLookup),
  );
}

export function sortInspectionImageDisplayEntries(entries, sortId, projectImageLookup = {}) {
  const sortLayers = normalizeInspectionImageSortLayers(sortId);
  const indexedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index }));
  indexedEntries.sort((left, right) => {
    const comparison = sortLayers.reduce((result, layerSortId) => (
      result || compareInspectionImageDisplayEntryByLayer(
        left.entry,
        right.entry,
        layerSortId,
        projectImageLookup,
      )
    ), 0);
    return comparison || left.index - right.index;
  });
  return indexedEntries.map(({ entry }) => entry);
}
