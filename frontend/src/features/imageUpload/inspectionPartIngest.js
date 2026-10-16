// Builds the inspection-part ingest payload from uploaded image records, using
// filename-derived hierarchy metadata (design/lot/batch/serial/side/modality).
import { getAssociatedMetadataFields, getNsiproIngestMetadata } from '../../utils/associatedMetadataFile';

const HIERARCHY_KEYS = [
  'design_number',
  'lot_number',
  'serial_number',
  'side',
  'modality',
  'overlay',
];

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
  'side',
  'side_identifier',
  'view',
  'view_name',
  'modality',
  'image_modality',
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

function getAdditionalFilenameMetadata(candidate) {
  if (!candidate || typeof candidate !== 'object') return {};
  return Object.entries(candidate).reduce((acc, [key, value]) => {
    if (!key || RESERVED_INGEST_METADATA_KEYS.has(key)) return acc;
    if (value === undefined || value === null || value === '') return acc;
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
    side: String(firstNonEmptyValue(candidate, ['side', 'side_identifier', 'view', 'view_name'])).trim().toLowerCase(),
    modality: String(firstNonEmptyValue(candidate, ['modality', 'image_modality'])).trim().toLowerCase(),
    overlay: normalizeBoolean(candidate.overlay),
    overlay_base_filename: String(firstNonEmptyValue(candidate, ['overlay_base_filename', 'base_filename'])).trim(),
    overlay_base_image_id: String(firstNonEmptyValue(candidate, ['overlay_base_image_id', 'base_image_id'])).trim(),
    additional_filename_metadata: getAdditionalFilenameMetadata(candidate),
  };
  const hasRequiredHierarchy = HIERARCHY_KEYS
    .filter((key) => key !== 'overlay')
    .every((key) => normalized[key]);
  if (!hasRequiredHierarchy || (!normalized.set_number && !normalized.batch_number)) return null;
  if (!normalized.set_number) delete normalized.set_number;
  if (!normalized.batch_number) delete normalized.batch_number;
  if (!normalized.overlay_base_filename) delete normalized.overlay_base_filename;
  if (!normalized.overlay_base_image_id) delete normalized.overlay_base_image_id;
  if (Object.keys(normalized.additional_filename_metadata).length === 0) delete normalized.additional_filename_metadata;
  return normalized;
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
      const volumePart = volumePartsByKey.get(volumeStackId);
      volumePart.metadata.source_images.push({
        filename,
        image_id: record.image?.id || null,
        slice_axis: recordMetadata.slice_axis || null,
        slice_index: typeof recordMetadata.slice_index === 'number' ? recordMetadata.slice_index : null,
        modality: recordMetadata.modality || null,
        overlay: normalizeBoolean(recordMetadata.overlay),
        overlay_base_filename: recordMetadata.overlay_base_filename || null,
        overlay_base_image_id: recordMetadata.overlay_base_image_id || null,
        ...getAssociatedMetadataFields(recordMetadata),
        ...getNsiproIngestMetadata(recordMetadata),
      });
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

    const additionalFilenameMetadata = metadata.additional_filename_metadata || {};

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
          configured_views: [],
          modalities: [],
          view_images: {},
          overlay_images: {},
          ...getAssociatedMetadataFields(metadata),
          ...getNsiproIngestMetadata(metadata),
          source_images: [],
          ...(Object.keys(additionalFilenameMetadata).length > 0 ? { filename_identifiers: { ...additionalFilenameMetadata } } : {}),
        },
      });
      if (metadata.set_number) {
        partsByKey.get(partKey).metadata.set_number = metadata.set_number;
      }
      if (metadata.batch_number) {
        partsByKey.get(partKey).metadata.batch_number = metadata.batch_number;
      }
    }

    const part = partsByKey.get(partKey);
    const side = metadata.side;
    const modality = metadata.modality;
    if (!part.metadata.configured_views.includes(side)) {
      part.metadata.configured_views.push(side);
    }
    if (!part.metadata.modalities.includes(modality)) {
      part.metadata.modalities.push(modality);
    }
    part.metadata.source_images.push({
      filename,
      side,
      modality,
      overlay: metadata.overlay,
      image_id: record.image?.id || null,
      overlay_base_filename: metadata.overlay_base_filename || null,
      overlay_base_image_id: metadata.overlay_base_image_id || null,
      ...getAssociatedMetadataFields(metadata),
      ...getNsiproIngestMetadata(metadata),
      ...additionalFilenameMetadata,
    });
    if (metadata.overlay) {
      part.metadata.overlay_images[side] = {
        ...(part.metadata.overlay_images[side] || {}),
        [modality]: filename,
      };
    } else if (!part.metadata.view_images[side]) {
      part.metadata.view_images[side] = filename;
    }
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
    if (Array.isArray(part.metadata.configured_views)) {
      part.metadata.configured_views.sort();
    }
    if (Array.isArray(part.metadata.modalities)) {
      part.metadata.modalities.sort();
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
