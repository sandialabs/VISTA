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
  { id: 'filename_asc', label: 'Filename A-Z' },
  { id: 'filename_desc', label: 'Filename Z-A' },
  { id: 'view_asc', label: 'View A-Z' },
  { id: 'type_asc', label: 'Image type' },
];
export const DEFAULT_INSPECTION_IMAGE_SORT_ID = 'filename_asc';
const INSPECTION_IMAGE_METADATA_SORT_PREFIX = 'metadata:';

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

function getInspectionImageSortView(entry) {
  return String(entry?.viewName || entry?.label || entry?.filename || entry?.imageRef || '');
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
    .filter((sortId) => sortId && (
      optionIds.has(sortId)
      || (allowMetadataSortIds && getInspectionImageMetadataSortKey(sortId))
    ));
  return normalized.length > 0 ? normalized : [DEFAULT_INSPECTION_IMAGE_SORT_ID];
}

function compareInspectionImageMetadataSortValue(left, right) {
  const leftValue = formatMetadataValue(left).trim();
  const rightValue = formatMetadataValue(right).trim();
  if (!leftValue && !rightValue) return 0;
  if (!leftValue) return 1;
  if (!rightValue) return -1;
  return compareInspectionImageSortText(leftValue, rightValue);
}

function compareInspectionImageDisplayEntryByLayer(leftEntry, rightEntry, sortId, projectImageLookup = {}) {
  const metadataSortKey = getInspectionImageMetadataSortKey(sortId);
  if (metadataSortKey) {
    return compareInspectionImageMetadataSortValue(
      getImageRefMetadata(leftEntry, projectImageLookup)[metadataSortKey],
      getImageRefMetadata(rightEntry, projectImageLookup)[metadataSortKey],
    );
  }
  if (sortId === 'filename_desc') {
    return -compareInspectionImageSortText(
      getInspectionImageSortFilename(leftEntry, projectImageLookup),
      getInspectionImageSortFilename(rightEntry, projectImageLookup),
    );
  }
  if (sortId === 'view_asc') {
    return compareInspectionImageSortText(
      getInspectionImageSortView(leftEntry),
      getInspectionImageSortView(rightEntry),
    );
  }
  if (sortId === 'type_asc') {
    return (
      INSPECTION_IMAGE_TYPE_ORDER[getInspectionImageType(leftEntry)]
      - INSPECTION_IMAGE_TYPE_ORDER[getInspectionImageType(rightEntry)]
    ) || compareInspectionImageSortText(
      getInspectionImageSortView(leftEntry),
      getInspectionImageSortView(rightEntry),
    );
  }
  return compareInspectionImageSortText(
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
