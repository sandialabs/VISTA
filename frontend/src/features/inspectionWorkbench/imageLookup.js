import { buildActiveImageCatalog, getCanonicalImageId, parseMetadataBoolean } from '../../utils/imageIdentity';
import { metadataKeyFromFilenameEntry } from '../../components/FilenameMetadataExtractor';
import { normalizeConfigurationSection } from '../projectConfiguration/configurationSchema';
import { DEFAULT_SECONDARY_IMAGE_FILTER_KEY, MODALITY_METADATA_KEY } from './inspectionConstants';
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
  const sourceMetadata = entry?.sourceMetadata && typeof entry.sourceMetadata === 'object'
    ? entry.sourceMetadata
    : {};
  const category = entry?.cropChild ? 'crop' : (entry?.overlay ? 'overlay' : 'source');
  // User metadata keys (side, view, modality, or anything else) are returned
  // exactly as stored: the part's source record fields, then its nested
  // metadata, then the image's own metadata (authoritative). VISTA only
  // contributes its own system fields (category/layer/type/filename) and
  // never derives one user key from another or substitutes a placeholder.
  return {
    ...sourceMetadata,
    ...entryMetadata,
    ...imageMetadata,
    layer: imageMetadata.layer ?? entryMetadata.layer ?? category,
    category,
    type: imageMetadata.type ?? entryMetadata.type ?? category,
    filename: getInspectionTileFilename(entry, projectImageLookup),
  };
}

// Per-image identity fields: unique to each image, so never offered as a
// grouping/filter key.
const IDENTITY_METADATA_FILTER_KEYS = new Set(['image_id', 'id']);

function normalizeMetadataFilterValue(value) {
  return formatMetadataValue(value).trim().toLowerCase();
}

export function getMetadataFilterValue(entry, key, projectImageLookup = {}) {
  if (!key) return '';
  return normalizeMetadataFilterValue(getImageRefMetadata(entry, projectImageLookup)[key]);
}

// Filter values are compared case-insensitively (normalized keys), while the
// first-seen original spelling is kept for display so the UI shows exactly
// what the user supplied.
export function getImageMetadataFilterOptions(imageRefs = [], projectImageLookup = {}) {
  const keyValues = new Map();
  const displayValues = new Map();
  imageRefs.forEach((entry) => {
    const metadata = getImageRefMetadata(entry, projectImageLookup);
    Object.entries(metadata).forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      const normalizedValue = normalizeMetadataFilterValue(value);
      if (!normalizedKey || !normalizedValue) return;
      if (!keyValues.has(normalizedKey)) keyValues.set(normalizedKey, new Set());
      keyValues.get(normalizedKey).add(normalizedValue);
      if (!displayValues.has(normalizedKey)) displayValues.set(normalizedKey, new Map());
      if (!displayValues.get(normalizedKey).has(normalizedValue)) {
        displayValues.get(normalizedKey).set(normalizedValue, formatMetadataValue(value).trim());
      }
    });
  });
  const keys = Array.from(keyValues.entries())
    .filter(([key, values]) => values.size > 1 && !IDENTITY_METADATA_FILTER_KEYS.has(key))
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  return { keys, keyValues, displayValues };
}

export function getMetadataFilterDisplayValue(options, key, value) {
  return options?.displayValues?.get(key)?.get(value) ?? String(value ?? '');
}

// VISTA's own image-category vocabulary (source / overlay / crop).
export const SYSTEM_CATEGORY_FILTER_KEYS = new Set(['layer', 'category', 'type']);

// VISTA structural / identity fields. They are never chosen as a *default*
// user-metadata grouping, because they identify an image rather than
// describe it.
export const SYSTEM_METADATA_FILTER_KEYS = new Set([
  ...SYSTEM_CATEGORY_FILTER_KEYS,
  ...IDENTITY_METADATA_FILTER_KEYS,
  'filename',
  'label',
  'metadata',
  'part_id',
  'serial_number',
  'display_name',
  'content_type',
  'overlay',
  'overlay_base_filename',
  'overlay_base_image_id',
  'overlay_color',
  'overlay_opacity',
  'hidden',
  'parent_image_id',
  'parent_image_filename',
  'crop_child_image',
  'crop_annotation_id',
  'crop_title',
  'crop_subtitle',
  'crop_bbox',
  'slice_axis',
  'slice_index',
  'analysis_output',
  'analysis_source_image_id',
  'analysis_source_filename',
  'analysis_method_id',
  'analysis_method_name',
  'analysis_workflow_name',
  'completed_at',
  'created_at',
  'updated_at',
]);

export function getPreferredMetadataFilterKey(options, preferredKey, fallbackKey = '', { allowAnyKey = true } = {}) {
  const keys = options?.keys || [];
  const keyValues = options?.keyValues;
  if (preferredKey && keys.includes(preferredKey)) return preferredKey;
  if (fallbackKey && keys.includes(fallbackKey)) return fallbackKey;
  if (preferredKey && keyValues?.has(preferredKey)) return preferredKey;
  if (fallbackKey && keyValues?.has(fallbackKey)) return fallbackKey;
  return allowAnyKey ? (keys[0] || '') : '';
}

// Ordered metadata keys for the project's configured per-image descriptors
// (Project Configuration > Filename Convention > image descriptors). These are
// the project's own grouping keys; VISTA does not assume any particular name.
// Uses the project's effective filename convention (the same one uploads use
// to name metadata keys).
export function getConfiguredImageDescriptorFilterKeys(projectConfiguration = null) {
  const scheme = normalizeConfigurationSection('file_naming_scheme', {
    file_naming_scheme: projectConfiguration?.file_naming_scheme,
  });
  if (!scheme || scheme.use_filename_convention === false) return [];
  const overlayKey = String(scheme.overlay_indicator?.field_key || 'overlay');
  const seen = new Set();
  return (Array.isArray(scheme.image_descriptors) ? scheme.image_descriptors : [])
    .map((descriptor) => metadataKeyFromFilenameEntry(descriptor))
    .filter((key) => {
      if (!key || key === overlayKey || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Default keys for the two user-metadata filter rows.
// - The modality row drives VISTA's modality-visibility toggles (tied to the
//   project's `image_modalities` configuration), so it reads the key literally
//   named "modality" when images carry it. No other key is treated as one.
// - The primary row prefers the project's configured descriptors present on
//   the shown images (in configured order), then other user keys whose values
//   vary, then other user keys that are present.
export function getDefaultMetadataFilterKeys(options, configuredKeys = []) {
  const varyingKeys = options?.keys || [];
  const presentKeys = Array.from(options?.keyValues?.keys() || [])
    .filter((key) => !IDENTITY_METADATA_FILTER_KEYS.has(key))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  const isUserKey = (key) => !SYSTEM_METADATA_FILTER_KEYS.has(key);
  const modality = presentKeys.includes(MODALITY_METADATA_KEY) ? MODALITY_METADATA_KEY : '';
  const ordered = [
    ...configuredKeys.filter((key) => presentKeys.includes(key)),
    ...varyingKeys.filter(isUserKey),
    ...presentKeys.filter(isUserKey),
  ].filter((key, index, list) => key !== modality && list.indexOf(key) === index);
  const [primary = ''] = ordered;
  return { primary, modality };
}

export function getMetadataFilterKeySelectOptions(keys = [], selectedKey = '') {
  const selectKeys = selectedKey && !keys.includes(selectedKey) ? [selectedKey, ...keys] : keys;
  return selectKeys.map((key) => ({ key, label: getMetadataFilterKeyLabel(key) }));
}

// User metadata keys are shown exactly as named; only VISTA's own system
// field ("layer") gets a friendly label.
export function getMetadataFilterKeyLabel(key) {
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
