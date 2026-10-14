import { ALL_PARTS_ID } from './useInspectionPartSelection';
import { parseMetadataBoolean } from '../../utils/imageIdentity';
import { DEFAULT_MODALITIES } from './inspectionConstants';
import { getProjectImageRecord, isDeletedProjectImageRecord } from './imageLookup';
import { safeDecodeFilename } from './inspectionUtils';
import { isServerVolumeDescriptor } from './volumeDescriptors';
import { formatAnnotationTimestamp } from './annotationListHelpers';
import { getInspectionImageOrderKey, applyInspectionImageDisplayOrder } from './imageSorting';

export function getModalities(part) {
  const modalities = part?.metadata?.modalities;
  if (Array.isArray(modalities) && modalities.length > 0) {
    return modalities.map((value) => String(value));
  }
  return DEFAULT_MODALITIES;
}

function getConfiguredProjectModalities(projectConfiguration = null) {
  return Array.isArray(projectConfiguration?.image_modalities)
    ? projectConfiguration.image_modalities
      .map((modality) => String(modality?.id || '').trim())
      .filter(Boolean)
    : [];
}

function getLoadedImageRefModalities(imageRefs = []) {
  const loadedModalities = new Set();
  imageRefs.forEach((entry) => {
    const modality = String(entry?.modality || '').trim().toLowerCase();
    if (!modality || modality === 'analyze-overlay' || modality === 'overlay') return;
    loadedModalities.add(modality);
  });
  return loadedModalities;
}

function orderLoadedModalities(loadedModalities, configuredModalities = [], includeUnconfigured = true) {
  const orderedConfiguredModalities = configuredModalities.filter((modality) =>
    loadedModalities.has(String(modality || '').trim().toLowerCase()),
  );
  const orderedLoadedModalities = includeUnconfigured
    ? Array.from(loadedModalities).filter((modality) =>
      !orderedConfiguredModalities.some((configured) => String(configured || '').trim().toLowerCase() === modality),
    )
    : [];
  return [...orderedConfiguredModalities, ...orderedLoadedModalities];
}

export function getPartSummaryModalities(part, imageRefs = getPartImageRefs(part), projectConfiguration = null) {
  const loadedModalities = getLoadedImageRefModalities(imageRefs);
  const projectModalities = getConfiguredProjectModalities(projectConfiguration);
  const configuredModalities = projectModalities.length > 0 ? projectModalities : getModalities(part);
  if (loadedModalities.size === 0) {
    return imageRefs.length > 0 && configuredModalities.length === 1
      ? [configuredModalities[0]]
      : [];
  }
  return orderLoadedModalities(loadedModalities, configuredModalities, projectModalities.length === 0);
}

export function getDiscoveredModalities(part) {
  if (!part) return [];
  const discovered = [
    ...getModalities(part),
    ...getPartImageRefs(part).map((entry) => entry?.modality),
  ];
  const seen = new Set();
  return discovered
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function getShellImageLayers(part, projectImageLookup = {}) {
  const imagesByView = part?.metadata?.view_images;
  if (!imagesByView || typeof imagesByView !== 'object') return [];
  return Object.entries(imagesByView)
    .map(([viewName, imageRef]) => {
      const filename = String(
        imageRef && typeof imageRef === 'object' ? imageRef.filename || '' : imageRef || '',
      );
      const record = getProjectImageRecord(projectImageLookup, {
        image_id: imageRef && typeof imageRef === 'object' ? imageRef.image_id : '',
        filename,
      });
      const imageId = record?.id;
      if (!imageId) return null;
      return {
        viewName: String(viewName || '').toLowerCase(),
        filename,
        id: String(imageId),
        url: `/api/images/${encodeURIComponent(String(imageId))}/content`,
      };
    })
    .filter(Boolean);
}

function getAssignedOverlayDisplayLabel(record) {
  if (record?.analysis_output || record?.analysis_source_image_id) return '';
  const baseName = String(record?.overlay_base_filename || record?.overlay_base_image_id || '').trim();
  if (!baseName) return '';
  return `overlay for ${safeDecodeFilename(baseName)}`;
}

function getAnalyzeOverlayDisplayLabel(label) {
  const parts = String(label || 'Analyze Overlay')
    .split('::')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] || 'Analyze Overlay';
  return [...parts].reverse().join(' :: ');
}

function getAnalysisOverlayMethodName(record = {}) {
  return String(
    record.analysis_method_name
    || record.analysis_method_id
    || record.method_name
    || record.function_name
    || record.model_name
    || record.analysis_workflow_name
    || getAnalyzeOverlayDisplayLabel(record.label || record.analysis_label || '')
    || 'analysis',
  ).trim();
}

function getAnalysisOverlayTimestamp(record = {}) {
  return record.completed_at
    || record.completedAt
    || record.analysis_completed_at
    || record.analysisCompletedAt
    || record.created_at
    || record.createdAt
    || record.timestamp
    || '';
}

function getOverlaySourceLabel(record = {}, isAnalysisOverlay = false) {
  if (!isAnalysisOverlay && !parseMetadataBoolean(record.overlay)) return '';
  const filename = safeDecodeFilename(record?.filename || record?.image_id || record?.id || 'overlay');
  if (record.annotation_id || record.annotationId || record.source_annotation_id) return 'Annotation';
  if (
    isAnalysisOverlay
    || parseMetadataBoolean(record.analysis_output)
    || record.analysis_source_image_id
  ) {
    const methodName = getAnalysisOverlayMethodName(record);
    const timestamp = getAnalysisOverlayTimestamp(record);
    const createdAt = timestamp ? formatAnnotationTimestamp(timestamp) : '';
    return `Analysis: ${methodName}${createdAt ? ` • ${createdAt}` : ''}`;
  }
  return `Overlay: ${filename}`;
}

function getImageRecordMetadataSnapshot(record = {}, projectImageLookup = {}) {
  const imageRecord = getProjectImageRecord(projectImageLookup, {
    image_id: record?.image_id || record?.id,
    filename: record?.filename,
  });
  return {
    ...(imageRecord?.metadata && typeof imageRecord.metadata === 'object' ? imageRecord.metadata : {}),
    ...(record?.metadata && typeof record.metadata === 'object' ? record.metadata : {}),
    ...(imageRecord || {}),
    ...(record || {}),
  };
}

function isAnalysisOverlayRecord(record = {}) {
  return Boolean(
    parseMetadataBoolean(record.analysis_output)
    || record.analysis_source_image_id
    || record.analysis_method_id
    || record.analysis_method_name
    || record.analysis_workflow_name
    || String(record?.modality || '').toLowerCase() === 'analyze-overlay'
  );
}

export function getPartImageRefs(part, projectImageLookup = {}) {
  const refs = [];
  const claimedImages = [];
  const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
  const analysisOutputs = Array.isArray(part?.metadata?.analysis_outputs) ? part.metadata.analysis_outputs : [];
  const backingImageRecords = [...sourceImages, ...analysisOutputs]
    .filter((record) => record && typeof record === 'object');
  const isDeleteCandidate = (record) => (
    parseMetadataBoolean(record?.overlay_delete_candidate)
    || parseMetadataBoolean(record?.delete_candidate)
  );
  const activeBackingRecords = backingImageRecords.filter((record) => !isDeleteCandidate(record));
  const activeBackingRecordsByFilename = activeBackingRecords.reduce((acc, record) => {
    const filename = String(record?.filename || '').trim();
    if (!filename) return acc;
    if (!acc.has(filename)) acc.set(filename, []);
    const imageId = String(record?.image_id || '').trim();
    const existingRecord = imageId
      ? acc.get(filename).find(
        (candidate) => String(candidate?.image_id || '').trim() === imageId,
      )
      : null;
    if (!existingRecord) acc.get(filename).push(record);
    return acc;
  }, new Map());
  const getRecordModality = (record) => String(record?.modality || record?.metadata?.modality || '').toLowerCase();
  const claimImageIdentity = (record = {}) => {
    const imageId = String(record.image_id || '').trim();
    const filename = String(record.filename || '').trim();
    let existing = imageId
      ? claimedImages.find((candidate) => candidate.imageId === imageId)
      : null;
    if (!existing && filename) {
      const filenameMatches = claimedImages.filter((candidate) => (
        candidate.filename === filename && !candidate.imageId
      ));
      if (!imageId && filenameMatches.length === 1) [existing] = filenameMatches;
    }
    if (existing) {
      if (!existing.filename && filename) {
        existing.filename = filename;
        if (existing.ref && !existing.ref.filename) existing.ref.filename = filename;
      }
      return { claimed: false, entry: existing };
    }
    const entry = { imageId, filename, ref: null };
    claimedImages.push(entry);
    return { claimed: true, entry };
  };
  const isAnalyzeOutputRecord = (record) => {
    const modality = String(record?.modality || '').toLowerCase();
    return Boolean(
      parseMetadataBoolean(record?.analysis_output)
      || record?.analysis_source_image_id
      || record?.analysis_method_id
      || record?.analysis_method_name
      || record?.analysis_workflow_name
      || modality === 'analyze-overlay'
    );
  };
  const pushRecord = (record, index, forceOverlay = false) => {
    if (!record || typeof record !== 'object') return;
    if (isDeleteCandidate(record)) return;
    const overlay = forceOverlay
      || parseMetadataBoolean(record.overlay)
      || parseMetadataBoolean(record.analysis_output);
    const analysisOverlay = isAnalysisOverlayRecord(record) || forceOverlay;
    const cropChild = parseMetadataBoolean(record.crop_child_image)
      || parseMetadataBoolean(record.cropChildImage);
    const cropSubtitle = String(record.crop_subtitle || record.cropSubtitle || '').trim();
    const imageRef = String(record.image_id || record.filename || '');
    if (!imageRef) return;
    const identity = claimImageIdentity(record);
    if (!identity.claimed) return;
    const modality = getRecordModality(record);
    const metadataSnapshot = getImageRecordMetadataSnapshot(record, projectImageLookup);
    const label = cropChild
      ? String(record.crop_title || record.filename || `CROP ${index + 1}`)
      : overlay
        ? (getAssignedOverlayDisplayLabel(record) || getAnalyzeOverlayDisplayLabel(record.label || record.analysis_label || modality || 'Analyze Overlay'))
        : String(record.side || record.modality || `IMAGE ${index + 1}`).toUpperCase();
    const imageReference = {
      id: `${part.id}-${overlay ? 'analysis' : 'source'}-${index}`,
      viewName: String(record.side || record.modality || (overlay ? 'overlay' : 'image')).toLowerCase(),
      modality,
      label,
      imageRef,
      filename: String(record.filename || ''),
      imageId: record.image_id ? String(record.image_id) : '',
      overlay,
      overlaySourceLabel: getOverlaySourceLabel(metadataSnapshot, analysisOverlay),
      cropChild,
      cropSubtitle,
      parentImageId: record.parent_image_id ? String(record.parent_image_id) : '',
      parentImageFilename: record.parent_image_filename ? String(record.parent_image_filename) : '',
      overlayBaseImageId: record.overlay_base_image_id ? String(record.overlay_base_image_id) : '',
      overlayBaseFilename: record.overlay_base_filename ? String(record.overlay_base_filename) : '',
      color: record.overlay_color || record.metadata?.overlay_color || '',
      opacity: record.overlay_opacity ?? record.metadata?.overlay_opacity,
      hidden: parseMetadataBoolean(record.hidden),
      metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
    };
    identity.entry.ref = imageReference;
    refs.push(imageReference);
  };
  sourceImages.forEach((record, index) => {
    pushRecord(record, index, isAnalyzeOutputRecord(record));
  });
  analysisOutputs.forEach((record, index) => {
    pushRecord(record, index, true);
  });

  // source_images and analysis_outputs carry persisted UUIDs and are
  // authoritative. view_images is a legacy presentation mapping: it may
  // enrich one exact backing record, but an ambiguous filename must never
  // collapse or hide same-name UUID-backed records.
  const imagesByView = part?.metadata?.view_images;
  if (imagesByView && typeof imagesByView === 'object') {
    Object.entries(imagesByView).forEach(([viewName, imageRef]) => {
      const viewImageId = String(
        imageRef && typeof imageRef === 'object' ? imageRef.image_id || '' : '',
      ).trim();
      const viewFilename = String(
        imageRef && typeof imageRef === 'object' ? imageRef.filename || '' : imageRef || '',
      ).trim();
      if (!viewImageId && !viewFilename) return;

      let sourceRecord = null;
      if (viewImageId) {
        sourceRecord = activeBackingRecords.find(
          (record) => String(record?.image_id || '').trim() === viewImageId,
        ) || null;
        const deletedMatches = backingImageRecords.filter(
          (record) => String(record?.image_id || '').trim() === viewImageId,
        );
        if (!sourceRecord && deletedMatches.length > 0 && deletedMatches.every(isDeleteCandidate)) return;
      } else if (viewFilename) {
        const filenameMatches = activeBackingRecordsByFilename.get(viewFilename) || [];
        if (filenameMatches.length > 1) return;
        sourceRecord = filenameMatches[0] || null;
        const deletedMatches = backingImageRecords.filter(
          (record) => String(record?.filename || '').trim() === viewFilename,
        );
        if (!sourceRecord && deletedMatches.length > 0 && deletedMatches.every(isDeleteCandidate)) return;
      }

      const identityRecord = {
        ...(sourceRecord || {}),
        image_id: viewImageId || sourceRecord?.image_id || '',
        filename: viewFilename || sourceRecord?.filename || '',
      };
      const identity = claimImageIdentity(identityRecord);
      if (!identity.claimed) return;
      const resolvedImageRef = String(identityRecord.image_id || identityRecord.filename || '');
      const imageReference = {
        id: `${part.id}-view-${viewName}`,
        viewName: String(viewName || '').toLowerCase(),
        modality: getRecordModality(sourceRecord),
        label: String(viewName || 'image').toUpperCase(),
        imageRef: resolvedImageRef,
        filename: String(identityRecord.filename || ''),
        imageId: identityRecord.image_id ? String(identityRecord.image_id) : '',
        overlay: false,
        hidden: parseMetadataBoolean(sourceRecord?.hidden),
        metadata: sourceRecord?.metadata && typeof sourceRecord.metadata === 'object' ? sourceRecord.metadata : {},
      };
      identity.entry.ref = imageReference;
      refs.push(imageReference);
    });
  }
  return refs;
}

function getPartDisplayLabel(part) {
  return String(part?.display_name || part?.serial_number || part?.id || '').trim();
}

function getOrderedLoadedPartImageRefs(part, projectImageLookup = {}) {
  if (!part?.metadata || typeof part.metadata !== 'object') return [];
  const mappedEntries = getPartImageRefs(part)
    .filter((entry) => isInspectionImageRefLoaded(entry, projectImageLookup));
  const persistedOrder = Array.isArray(part.metadata.image_display_order)
    ? part.metadata.image_display_order
    : [];
  return applyInspectionImageDisplayOrder(mappedEntries, persistedOrder);
}

export function getAggregatePartImageRefs(parts = [], projectImageLookup = {}) {
  return parts.flatMap((part) => {
    const partId = String(part?.id || '');
    const partLabel = getPartDisplayLabel(part) || partId;
    return getOrderedLoadedPartImageRefs(part, projectImageLookup).map((entry, index) => ({
      ...entry,
      id: `${ALL_PARTS_ID}-${partId}-${entry.id || getInspectionImageOrderKey(entry) || index}`,
      aggregatePartId: partId,
      aggregatePartLabel: partLabel,
    }));
  });
}

export function getAggregateViews(imageRefs = []) {
  const seen = new Set();
  return imageRefs
    .map((entry) => String(entry?.viewName || '').toLowerCase())
    .filter((viewName) => {
      if (!viewName || seen.has(viewName)) return false;
      seen.add(viewName);
      return true;
    });
}

export function getAggregateModalities(imageRefs = [], projectConfiguration = null) {
  const loadedModalities = getLoadedImageRefModalities(imageRefs);
  const projectModalities = getConfiguredProjectModalities(projectConfiguration);
  const configuredModalities = projectModalities.length > 0 ? projectModalities : DEFAULT_MODALITIES;
  return orderLoadedModalities(loadedModalities, configuredModalities, projectModalities.length === 0);
}

export function getAllLoadedImageRefModalities(imageRefs = [], projectConfiguration = null) {
  const loadedModalities = getLoadedImageRefModalities(imageRefs);
  const projectModalities = getConfiguredProjectModalities(projectConfiguration);
  const configuredModalities = projectModalities.length > 0 ? projectModalities : DEFAULT_MODALITIES;
  return orderLoadedModalities(loadedModalities, configuredModalities, true);
}

export function getAggregateLayerAvailability(imageRefs = [], parts = []) {
  return {
    source: imageRefs.some((entry) => !entry.overlay && !entry.cropChild),
    overlay: imageRefs.some((entry) => entry.overlay),
    annotation: parts.some((part) => Array.isArray(part?.metadata?.annotations) && part.metadata.annotations.length > 0),
    crop: imageRefs.some((entry) => entry.cropChild),
  };
}

export function isInspectionImageRefLoaded(entry, projectImageLookup = {}) {
  const imageId = String(entry?.imageId || '').trim();
  if (imageId) {
    const record = getProjectImageRecord(projectImageLookup, { image_id: imageId });
    return Boolean(record && !isDeletedProjectImageRecord(record));
  }
  const filename = String(entry?.filename || entry?.imageRef || '').trim();
  const record = getProjectImageRecord(projectImageLookup, { filename });
  return Boolean(record && !isDeletedProjectImageRecord(record));
}

export function getAnnotationSourceImageId(entry, projectImageLookup) {
  const imageRecord = getProjectImageRecord(projectImageLookup, {
    image_id: entry?.imageId,
    filename: entry?.filename || entry?.imageRef,
  });
  const imageId = imageRecord?.id ? String(imageRecord.id) : '';
  if (!imageId) return '';
  if (!entry?.overlay) return imageId;
  const explicitBaseImageId = String(
    entry?.overlayBaseImageId
      || imageRecord?.metadata?.overlay_base_image_id
      || imageRecord?.metadata?.analysis_source_image_id
      || '',
  );
  const baseFilename = String(
    entry?.overlayBaseFilename
      || imageRecord?.metadata?.overlay_base_filename
      || '',
  );
  const baseRecord = getProjectImageRecord(projectImageLookup, {
    image_id: explicitBaseImageId,
    filename: baseFilename,
  });
  return baseRecord?.id ? String(baseRecord.id) : imageId;
}

export function getAnnotationSourceImageIdLookup(imageEntries, projectImageLookup) {
  return imageEntries.reduce((acc, entry) => {
    const imageRecord = getProjectImageRecord(projectImageLookup, {
      image_id: entry?.imageId,
      filename: entry?.filename || entry?.imageRef,
    });
    const imageId = imageRecord?.id ? String(imageRecord.id) : '';
    const sourceImageId = getAnnotationSourceImageId(entry, projectImageLookup);
    if (imageId && sourceImageId) acc[imageId] = sourceImageId;
    if (sourceImageId) acc[sourceImageId] = sourceImageId;
    return acc;
  }, {});
}

function getInspectionItemImageIdentities(item) {
  if (!item) return [];
  if (item.kind === 'external_overlay') {
    return [
      item.source?.resourceId,
      item.overlay?.imageId,
      item.overlay?.imageRef,
      item.overlay?.filename,
    ].map((value) => String(value || '').trim()).filter(Boolean);
  }
  const annotation = item.annotation;
  const values = [annotation?.image_id];
  const geometry = annotation?.geometry || {};
  const line = geometry.line || {};
  const box = geometry.box || annotation?.bbox || {};
  [
    line.imageId,
    line.image_id,
    box.imageId,
    box.image_id,
    geometry.imageId,
    geometry.image_id,
  ].forEach((value) => values.push(value));
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

export function getOverlayStackResourceId(stack) {
  if (isServerVolumeDescriptor(stack)) return String(stack.imageId || stack.id || '').trim();
  const entries = Array.isArray(stack?.stack) ? stack.stack : (Array.isArray(stack) ? stack : []);
  const first = entries[0] || {};
  return String(first.imageId || first.id || stack?.id || '').trim();
}

export function isInspectionItemForImageEntry(item, entry, projectImageLookup) {
  const itemIdentities = new Set(getInspectionItemImageIdentities(item));
  if (itemIdentities.size === 0) return false;
  const record = getProjectImageRecord(projectImageLookup, {
    image_id: entry?.imageId,
    filename: entry?.filename || entry?.imageRef,
  });
  const sourceImageId = getAnnotationSourceImageId(entry, projectImageLookup);
  return [
    entry?.imageId,
    entry?.imageRef,
    entry?.filename,
    record?.id,
    record?.filename,
    record?.displayName,
    sourceImageId,
  ].some((value) => itemIdentities.has(String(value || '').trim()));
}
