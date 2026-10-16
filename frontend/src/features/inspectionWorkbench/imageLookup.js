import { buildActiveImageCatalog, getCanonicalImageId, parseMetadataBoolean } from '../../utils/imageIdentity';
import { DEFAULT_PRIMARY_IMAGE_FILTER_KEY, DEFAULT_MODALITY_IMAGE_FILTER_KEY, DEFAULT_SECONDARY_IMAGE_FILTER_KEY } from './inspectionConstants';
import { formatMetadataValue } from './metadataHelpers';

export function getProjectImageRecord(projectImageLookup = {}, entry = {}) {
  const imageId = entry?.image_id ? String(entry.image_id).trim() : '';
  const filename = String(entry?.filename || '');
  const getOwnRecord = (key) => (
    key && Object.prototype.hasOwnProperty.call(projectImageLookup, key)
      ? projectImageLookup[key]
      : null
  );
  if (imageId) return getOwnRecord(imageId);
  return getOwnRecord(filename);
}

export function buildProjectImageLookup(images = []) {
  const records = Array.isArray(images) ? images : [];
  const activeCatalog = buildActiveImageCatalog(
    records.filter((record) => !isDeletedProjectImageRecord(record)),
  );
  const lookup = Object.create(null);

  // Reserve every concrete ID before installing any filename aliases. An
  // active image filename can be UUID-shaped (or equal any other image ID),
  // but it must never shadow that explicit identity, including a deleted ID.
  activeCatalog.refs.forEach((record) => {
    if (record.id) lookup[record.id] = record;
  });
  records.forEach((record) => {
    const id = getCanonicalImageId(record);
    if (!id || Object.prototype.hasOwnProperty.call(lookup, id)) return;
    lookup[id] = {
      ...record,
      id,
      displayName: String(record?.displayName || record?.filename || ''),
    };
  });
  activeCatalog.byFilename.forEach((matches, filename) => {
    if (
      matches.length === 1
      && !Object.prototype.hasOwnProperty.call(lookup, filename)
    ) lookup[filename] = matches[0];
  });
  return lookup;
}

export function getProjectImageLookupRecords(projectImageLookup = {}) {
  const records = [];
  const seen = new Set();
  Object.values(projectImageLookup).forEach((record) => {
    if (!record || typeof record !== 'object') return;
    const id = getCanonicalImageId(record);
    const identity = id || String(record.key || '');
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    records.push(record);
  });
  return records;
}

function getImageRecordForImageRef(entry, projectImageLookup = {}) {
  return getProjectImageRecord(projectImageLookup, {
    image_id: entry?.imageId,
    filename: entry?.filename || entry?.imageRef,
  }) || null;
}

export function getInspectionTileFilename(entry, projectImageLookup = {}) {
  const imageRecord = getImageRecordForImageRef(entry, projectImageLookup);
  return String(
    imageRecord?.displayName
    || imageRecord?.filename
    || entry?.filename
    || entry?.imageRef
    || '',
  );
}

export function getImageRefMetadata(entry, projectImageLookup = {}) {
  const imageRecord = getImageRecordForImageRef(entry, projectImageLookup);
  const entryMetadata = entry?.metadata && typeof entry.metadata === 'object'
    ? entry.metadata
    : {};
  const imageMetadata = imageRecord?.metadata && typeof imageRecord.metadata === 'object'
    ? imageRecord.metadata
    : {};
  const category = entry?.cropChild ? 'crop' : (entry?.overlay ? 'overlay' : 'source');
  return {
    ...entryMetadata,
    ...imageMetadata,
    view: entry?.viewName || imageMetadata.view || entryMetadata.view || imageMetadata.side || entryMetadata.side || '',
    side: imageMetadata.side || entryMetadata.side || entry?.viewName || '',
    modality: entry?.modality || imageMetadata.modality || entryMetadata.modality || '',
    layer: imageMetadata.layer || entryMetadata.layer || category,
    category,
    type: imageMetadata.type || entryMetadata.type || category,
    filename: getInspectionTileFilename(entry, projectImageLookup),
  };
}

function normalizeMetadataFilterValue(value) {
  return formatMetadataValue(value).trim().toLowerCase();
}

export function getMetadataFilterValue(entry, key, projectImageLookup = {}) {
  if (!key) return '';
  return normalizeMetadataFilterValue(getImageRefMetadata(entry, projectImageLookup)[key]);
}

export function getImageMetadataFilterOptions(imageRefs = [], projectImageLookup = {}) {
  const keyValues = new Map();
  imageRefs.forEach((entry) => {
    const metadata = getImageRefMetadata(entry, projectImageLookup);
    Object.entries(metadata).forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      const normalizedValue = normalizeMetadataFilterValue(value);
      if (!normalizedKey || !normalizedValue) return;
      if (!keyValues.has(normalizedKey)) keyValues.set(normalizedKey, new Set());
      keyValues.get(normalizedKey).add(normalizedValue);
    });
  });
  const keys = Array.from(keyValues.entries())
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  return { keys, keyValues };
}

export function getPreferredMetadataFilterKey(options, preferredKey, fallbackKey = '') {
  const keys = options?.keys || [];
  const keyValues = options?.keyValues;
  if (preferredKey && keys.includes(preferredKey)) return preferredKey;
  if (fallbackKey && keys.includes(fallbackKey)) return fallbackKey;
  if (preferredKey && keyValues?.has(preferredKey)) return preferredKey;
  if (fallbackKey && keyValues?.has(fallbackKey)) return fallbackKey;
  return keys[0] || '';
}

export function getMetadataFilterKeySelectOptions(keys = [], selectedKey = '') {
  const selectKeys = selectedKey && !keys.includes(selectedKey) ? [selectedKey, ...keys] : keys;
  return selectKeys.map((key) => ({ key, label: getMetadataFilterKeyLabel(key) }));
}

export function getMetadataFilterKeyLabel(key) {
  if (key === DEFAULT_PRIMARY_IMAGE_FILTER_KEY) return 'View';
  if (key === DEFAULT_MODALITY_IMAGE_FILTER_KEY) return 'Modalities';
  if (key === DEFAULT_SECONDARY_IMAGE_FILTER_KEY) return 'Layer';
  return key;
}

export function getMetadataFilterValuesForKey(options, key) {
  return Array.from(options?.keyValues?.get(key) || [])
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

export function getImageMetadataOverlayLines(entry, projectImageLookup = {}) {
  const metadata = getImageRefMetadata(entry, projectImageLookup);
  return Object.entries(metadata)
    .map(([key, value]) => [String(key || '').trim(), formatMetadataValue(value).trim()])
    .filter(([key, value]) => key && value)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export function upsertProjectImageRecord(projectImageLookup = {}, record = {}) {
  const nextId = getCanonicalImageId(record);
  const records = getProjectImageLookupRecords(projectImageLookup)
    .filter((candidate) => !nextId || getCanonicalImageId(candidate) !== nextId);
  return buildProjectImageLookup([...records, record]);
}

export function isDeletedProjectImageRecord(record) {
  return Boolean(record?.deleted_at || record?.deletedAt)
    || parseMetadataBoolean(record?.is_deleted)
    || parseMetadataBoolean(record?.deleted);
}
