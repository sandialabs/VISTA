// Builds the inspection-part ingest payload from uploaded image records.
//
// Part identity comes from filename-derived hierarchy metadata
// (design/lot/set-or-batch/serial). Per-image descriptors such as side,
// modality, view, channel, or any project-configured key are user metadata:
// they are stored on each source_images record exactly as supplied. VISTA does
// not rename them, treat alternate spellings as synonyms, lower-case them,
// require them, default missing values, or aggregate them into derived groups
// (no configured_views / modalities / view_images / overlay_images).
// Overlays are paired only through explicit overlay_base_filename /
// overlay_base_image_id references.
import { getAssociatedMetadataFields, getNsiproIngestMetadata } from '../../utils/associatedMetadataFile';

// Fields required to decide which inspection part an image belongs to.
const PART_IDENTITY_KEYS = [
  'design_number',
  'lot_number',
  'serial_number',
];

// Keys consumed as part-identity or VISTA structural fields. They are excluded
// from the per-image user metadata copy because they are already written to
// the part/source record under their own names. Per-image user descriptors (side,
// modality, view, ...) are intentionally NOT listed here: they flow through
// verbatim like any other user key.
const RESERVED_INGEST_METADATA_KEYS = new Set([
  'design_number',
  'drawing_number',
  'drawing',
  'design',
  'lot_number',
  'lot',
  'set_number',
  'part_number',
  'part',
  'part_group',
  'batch_number',
  'batch',
  'serial_number',
  'serial',
  'sn',
  'overlay',
  'overlay_base_filename',
  'base_filename',
  'overlay_base_image_id',
  'base_image_id',
  'associated_metadata_ref',
  'associated_metadata',
  'nsipro_metadata',
  'nsipro_payload',
]);

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function firstNonEmptyValue(candidate, keys) {
  for (const key of keys) {
    const value = candidate?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return '';
}

function isPresentValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function getAdditionalFilenameMetadata(candidate) {
  if (!candidate || typeof candidate !== 'object') return {};
  return Object.entries(candidate).reduce((acc, [key, value]) => {
    if (!key || RESERVED_INGEST_METADATA_KEYS.has(key)) return acc;
    if (!isPresentValue(value)) return acc;
    acc[key] = value;
    return acc;
  }, {});
}

export function normalizeHierarchyMetadata(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const normalized = {
    ...candidate,
    design_number: String(firstNonEmptyValue(candidate, ['design_number', 'drawing_number', 'drawing', 'design'])).trim(),
    lot_number: String(firstNonEmptyValue(candidate, ['lot_number', 'lot'])).trim(),
    set_number: String(firstNonEmptyValue(candidate, ['set_number', 'part_number', 'part', 'part_group'])).trim(),
    batch_number: String(firstNonEmptyValue(candidate, ['batch_number', 'batch'])).trim(),
    serial_number: String(firstNonEmptyValue(candidate, ['serial_number', 'serial', 'sn'])).trim(),
    overlay: normalizeBoolean(candidate.overlay),
    overlay_base_filename: String(firstNonEmptyValue(candidate, ['overlay_base_filename', 'base_filename'])).trim(),
    overlay_base_image_id: String(firstNonEmptyValue(candidate, ['overlay_base_image_id', 'base_image_id'])).trim(),
  };
  const hasPartIdentity = PART_IDENTITY_KEYS.every((key) => normalized[key]);
  if (!hasPartIdentity || (!normalized.set_number && !normalized.batch_number)) return null;
  if (!normalized.set_number) delete normalized.set_number;
  if (!normalized.batch_number) delete normalized.batch_number;
  if (!normalized.overlay_base_filename) delete normalized.overlay_base_filename;
  if (!normalized.overlay_base_image_id) delete normalized.overlay_base_image_id;
  return normalized;
}

function buildVolumeStackSourceRecord(record, recordMetadata, filename) {
  return {
    filename,
    image_id: record.image?.id || null,
    slice_axis: recordMetadata.slice_axis || null,
    slice_index: typeof recordMetadata.slice_index === 'number' ? recordMetadata.slice_index : null,
    // Copied verbatim when supplied; never defaulted to a placeholder.
    ...(isPresentValue(recordMetadata.modality) ? { modality: recordMetadata.modality } : {}),
    overlay: normalizeBoolean(recordMetadata.overlay),
    overlay_base_filename: recordMetadata.overlay_base_filename || null,
    overlay_base_image_id: recordMetadata.overlay_base_image_id || null,
    ...getAssociatedMetadataFields(recordMetadata),
    ...getNsiproIngestMetadata(recordMetadata),
  };
}

export function buildInspectionPartIngestPayload(uploadedRecords) {
  const partsByKey = new Map();
  const volumePartsByKey = new Map();

  uploadedRecords.forEach((record) => {
    const metadata = normalizeHierarchyMetadata(record.metadata);
    if (!metadata) {
      const recordMetadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      const volumeStackId = String(recordMetadata.volume_stack_id || '').trim();
      const filename = record.image?.filename || record.filename;
      if (!volumeStackId || !filename) return;
      if (!volumePartsByKey.has(volumeStackId)) {
        volumePartsByKey.set(volumeStackId, {
          batchName: `PT3_${volumeStackId}`,
          batchDescription: `PT3 stack ${volumeStackId}`,
          serialNumber: String(recordMetadata.serial_number || volumeStackId),
          displayName: String(recordMetadata.display_name || `PT3 stack ${volumeStackId}`),
          metadata: {
            source: recordMetadata.source || 'manual-build-it',
            project_type: 'PT3',
            volume_stack_id: volumeStackId,
            ...getAssociatedMetadataFields(recordMetadata),
            ...getNsiproIngestMetadata(recordMetadata),
            source_images: [],
          },
        });
      }
      volumePartsByKey.get(volumeStackId).metadata.source_images.push(
        buildVolumeStackSourceRecord(record, recordMetadata, filename),
      );
      return;
    }

    const partGroupNumber = metadata.set_number || metadata.batch_number;
    const batchName = metadata.batch_number
      ? [
        metadata.design_number,
        metadata.lot_number,
        metadata.batch_number,
      ].join('_')
      : null;
    const partKey = [
      metadata.design_number,
      metadata.lot_number,
      partGroupNumber,
      metadata.serial_number,
    ].join('_');
    const filename = record.image?.filename || record.filename;
    if (!filename) return;

    // Every non-structural user key (side, modality, view, version, ...) is
    // copied onto the image's source record verbatim.
    const userImageMetadata = getAdditionalFilenameMetadata(record.metadata);

    if (!partsByKey.has(partKey)) {
      partsByKey.set(partKey, {
        batchName,
        batchDescription: metadata.batch_number
          ? `Design ${metadata.design_number}, lot ${metadata.lot_number}, batch ${metadata.batch_number}`
          : null,
        serialNumber: metadata.serial_number,
        displayName: `${metadata.design_number} ${metadata.lot_number} ${partGroupNumber} ${metadata.serial_number}`,
        metadata: {
          design_number: metadata.design_number,
          lot_number: metadata.lot_number,
          serial_number: metadata.serial_number,
          ...getAssociatedMetadataFields(metadata),
          ...getNsiproIngestMetadata(metadata),
          source_images: [],
        },
      });
      if (metadata.set_number) {
        partsByKey.get(partKey).metadata.set_number = metadata.set_number;
      }
      if (metadata.batch_number) {
        partsByKey.get(partKey).metadata.batch_number = metadata.batch_number;
      }
    }

    // User metadata first, so VISTA structural fields cannot be spoofed by an
    // identically named user key.
    partsByKey.get(partKey).metadata.source_images.push({
      ...userImageMetadata,
      filename,
      overlay: metadata.overlay,
      image_id: record.image?.id || null,
      overlay_base_filename: metadata.overlay_base_filename || null,
      overlay_base_image_id: metadata.overlay_base_image_id || null,
      ...getAssociatedMetadataFields(metadata),
      ...getNsiproIngestMetadata(metadata),
    });
  });

  const batchesByName = new Map();
  const unassignedParts = [];
  [...Array.from(partsByKey.values()), ...Array.from(volumePartsByKey.values())].forEach((part) => {
    if (part.batchName && !batchesByName.has(part.batchName)) {
      batchesByName.set(part.batchName, {
        name: part.batchName,
        description: part.batchDescription,
        parts: [],
      });
    }
    const ingestPart = {
      serial_number: part.serialNumber,
      display_name: part.displayName,
      metadata: part.metadata,
    };
    if (part.batchName) {
      batchesByName.get(part.batchName).parts.push(ingestPart);
    } else {
      unassignedParts.push(ingestPart);
    }
  });

  const batches = Array.from(batchesByName.values()).map((batch) => ({
    ...batch,
    parts: batch.parts.sort((left, right) => left.serial_number.localeCompare(right.serial_number)),
  }));

  return {
    batches,
    unassigned_parts: unassignedParts.sort((left, right) => (
      left.serial_number.localeCompare(right.serial_number)
    )),
  };
}
