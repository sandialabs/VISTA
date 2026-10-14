import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MPR_AXES, MPR_AXIS_CONFIG, MPR_SERVER_VOLUME_KIND } from '../features/inspectionWorkbench/mprConstants';
import { getMprAxisImageDimensions, getServerVolumeSliceUrl } from '../features/inspectionWorkbench/volumeDescriptors';
import { MprSliceCanvas } from '../features/inspectionWorkbench/MprSliceCanvas';
import { useMprVolumeCache } from '../features/inspectionWorkbench/useMprVolumeCache';
import { buildConfiguredFilenameFields, isFilenameConventionEnabled } from './FilenameMetadataExtractor';
import {
  createPt3VolumeDescriptor,
  getPt3AxisDimensions,
  getPt3VolumeSliceUrl,
} from './pt3VolumeDescriptor';
import { buildActiveImageCatalog, resolveImageReference } from '../utils/imageIdentity';
import { appendHttpCallToErrorMessage } from '../utils/httpErrorMessages';
import { fetchImageVolumeMetadata } from '../api/images';
import { readResponseBlobWithProgress } from '../api/progress';
import {
  assignImageToPart,
  createProjectPart,
  deleteProjectPart,
} from '../api/parts';


function getFilenameStem(filename = '') {
  const base = String(filename || '').split(/[\\/]/).pop() || '';
  const dotIndex = base.lastIndexOf('.');
  return dotIndex > 0 ? base.slice(0, dotIndex) : base;
}

function tokenizeFilename(filename = '', delimiter = '') {
  const stem = getFilenameStem(filename);
  if (delimiter) return stem.split(delimiter).map((token) => token.trim()).filter(Boolean);
  return stem.split(/[^A-Za-z0-9]+/).map((token) => token.trim()).filter(Boolean);
}

function getAutoAssignDelimiter(projectConfiguration = null) {
  const scheme = projectConfiguration?.file_naming_scheme || {};
  const extractor = scheme.metadata_extractor || {};
  if (extractor.mode === 'advanced') return '';
  if (!isFilenameConventionEnabled(scheme) && !extractor.pattern && !extractor.delimiter) return '';
  return String(extractor.pattern || extractor.delimiter || (isFilenameConventionEnabled(scheme) ? scheme.delimiter : '') || '');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPartKeyFromFilenameSegment(segment = '', filenameKey = '') {
  const value = String(segment || '').trim();
  const key = String(filenameKey ?? '').trim();
  const pattern = key ? `^${escapeRegExp(key)}(\\d+)$` : '^(\\d+)$';
  const match = value.match(new RegExp(pattern));
  return match ? match[1] : '';
}

function extractFilenameKeyFromSegment(segment = '') {
  const match = String(segment || '').trim().match(/^([A-Za-z]+)\d+$/);
  return match ? match[1] : '';
}

function buildFilenameKeyOptions(images, delimiter = '') {
  const keys = new Set();
  (Array.isArray(images) ? images : []).forEach((image) => {
    tokenizeFilename(image.filename, delimiter).forEach((token) => {
      const key = extractFilenameKeyFromSegment(token);
      if (key) keys.add(key);
    });
  });
  return Array.from(keys).sort((left, right) => left.localeCompare(right));
}

function getImageMetadata(image) {
  if (image?.metadata && typeof image.metadata === 'object') return image.metadata;
  if (image?.metadata_ && typeof image.metadata_ === 'object') return image.metadata_;
  return {};
}

function compareImageRefs(left, right) {
  return String(left?.filename || '').localeCompare(String(right?.filename || ''))
    || (Number(left?.displayOrdinal) || 0) - (Number(right?.displayOrdinal) || 0)
    || String(left?.displayName || '').localeCompare(String(right?.displayName || ''));
}

function buildAutoAssignFieldOptions(images, projectConfiguration = null, delimiter = '') {
  const conventionEnabled = isFilenameConventionEnabled(projectConfiguration?.file_naming_scheme || null);
  const configuredFields = buildConfiguredFilenameFields(projectConfiguration?.file_naming_scheme || null);
  const configuredOptions = configuredFields
    .map((field) => ({
      filenameKey: String(field.abbreviation || field.id || '').trim(),
      metadataKey: String(field.key || '').trim(),
    }))
    .filter((option) => option.filenameKey && option.metadataKey);

  const inferredFilenameOptions = conventionEnabled ? buildFilenameKeyOptions(images, delimiter).map((key) => ({
    filenameKey: key,
    metadataKey: '',
  })) : [];

  const metadataKeys = new Set();
  (Array.isArray(images) ? images : []).forEach((image) => {
    Object.keys(getImageMetadata(image)).forEach((key) => {
      if (key) metadataKeys.add(key);
    });
  });
  const inferredMetadataOptions = Array.from(metadataKeys).map((key) => ({
    filenameKey: '',
    metadataKey: key,
  }));

  const bySignature = new Map();
  [...configuredOptions, ...inferredFilenameOptions, ...inferredMetadataOptions].forEach((option) => {
    const signature = option.metadataKey || option.filenameKey;
    if (!bySignature.has(signature)) bySignature.set(signature, option);
    else {
      const existing = bySignature.get(signature);
      bySignature.set(signature, {
        filenameKey: existing.filenameKey || option.filenameKey,
        metadataKey: existing.metadataKey || option.metadataKey,
      });
    }
  });

  return Array.from(bySignature.values()).sort((left, right) => {
    const leftLabel = left.metadataKey || left.filenameKey;
    const rightLabel = right.metadataKey || right.filenameKey;
    return leftLabel.localeCompare(rightLabel);
  });
}

function normalizePartKey(value = '') {
  return String(value || '').replace(/[^A-Za-z0-9]+/g, '').trim();
}

function extractAutoAssignValueFromTokens(tokens, level, usedTokenIndexes = new Set()) {
  const filenameKey = String(level?.filenameKey ?? '').trim();
  for (let index = 0; index < tokens.length; index += 1) {
    if (usedTokenIndexes.has(index)) continue;
    const partKey = normalizePartKey(extractPartKeyFromFilenameSegment(tokens[index], filenameKey));
    if (!partKey) continue;
    usedTokenIndexes.add(index);
    return partKey;
  }
  return '';
}

function extractAutoAssignValues(image, levels, delimiter = '') {
  const tokens = tokenizeFilename(image.filename, delimiter);
  const usedTokenIndexes = new Set();
  return levels.map((level) => {
    const source = level?.source === 'metadata' ? 'metadata' : 'filename';
    const metadataKey = String(level?.metadataKey ?? '').trim();
    if (source === 'metadata') return normalizePartKey(getImageMetadata(image)[metadataKey]);
    return extractAutoAssignValueFromTokens(tokens, level, usedTokenIndexes);
  });
}

function buildAutoAssignPreview(images, selectedFilenameKey, delimiter = '', options = {}) {
  const groups = new Map();
  const levels = Array.isArray(options.levels) && options.levels.length > 0
    ? options.levels
    : [{
      source: options.source === 'metadata' ? 'metadata' : 'filename',
      filenameKey: selectedFilenameKey,
      metadataKey: options.selectedMetadataKey || selectedFilenameKey,
    }];
  const hasIncompleteLevel = levels.some((level) => (
    level?.source === 'metadata' && !String(level?.metadataKey || '').trim()
  ));
  if (hasIncompleteLevel) return [];
  const activeLevels = levels.filter((level) => (level?.source === 'metadata' ? String(level?.metadataKey || '').trim() : true));
  if (activeLevels.length === 0) return [];

  (Array.isArray(images) ? images : []).forEach((image) => {
    const levelValues = extractAutoAssignValues(image, activeLevels, delimiter);
    if (levelValues.some((value) => !value)) return;
    const partKey = levelValues.join('-');
    if (!groups.has(partKey)) groups.set(partKey, []);
    groups.get(partKey).push(image);
  });
  return Array.from(groups.entries())
    .map(([partKey, groupedImages]) => ({ partKey, images: groupedImages }))
    .sort((left, right) => left.partKey.localeCompare(right.partKey));
}

function buildAssignmentCatalog(images) {
  const catalog = buildActiveImageCatalog(images);
  const refs = catalog.refs.map((ref) => ({
    ...ref,
    metadata: getImageMetadata(ref),
    contentUrl: ref.id ? `/api/images/${encodeURIComponent(ref.id)}/content` : '',
    thumbnailUrl: ref.id ? `/api/images/${encodeURIComponent(ref.id)}/thumbnail?width=96&height=96` : '',
  }));
  const byId = new Map();
  const byFilename = new Map();
  refs.forEach((ref) => {
    if (ref.id) byId.set(ref.id, ref);
    if (!byFilename.has(ref.filename)) byFilename.set(ref.filename, []);
    byFilename.get(ref.filename).push(ref);
  });
  return { refs, byId, byFilename };
}

function buildImageRefFromSource(sourceRecord, imageCatalog) {
  const filename = typeof sourceRecord?.filename === 'string' ? sourceRecord.filename : '';
  const result = resolveImageReference({
    image_id: sourceRecord?.image_id,
    filename,
  }, imageCatalog);
  return result.status === 'resolved' ? result.ref : null;
}

function getImageAssignmentKey(imageRef) {
  return imageRef?.id || imageRef?.key || '';
}

function buildBuckets({ parts, images }) {
  const imageCatalog = buildAssignmentCatalog(images);
  const assignedImageKeys = new Set();
  const partBuckets = (Array.isArray(parts) ? parts : []).map((part) => {
    const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
    const partImages = sourceImages
      .map((record) => buildImageRefFromSource(record, imageCatalog))
      .filter((image) => {
        if (!image) return false;
        const key = getImageAssignmentKey(image);
        if (!key || assignedImageKeys.has(key)) return false;
        assignedImageKeys.add(key);
        return true;
      });
    return {
      id: part.id,
      serialNumber: part.serial_number,
      displayName: part.display_name || part.serial_number,
      images: partImages,
    };
  });

  const unassigned = imageCatalog.refs
    .filter((image) => !assignedImageKeys.has(getImageAssignmentKey(image)))
    .sort(compareImageRefs);

  return { partBuckets, unassigned };
}


function formatMegabytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  return Math.round(value / (1024 * 1024));
}

function getSliceCachingMessage(progress = {}) {
  const loaded = formatMegabytes(progress.loadedBytes);
  const totalBytes = Number(progress.totalBytes) || 0;
  if (totalBytes > 0) return `Caching ${loaded}/${formatMegabytes(totalBytes)} MB`;
  return `Caching ${loaded} MB`;
}

function readResponseBytesWithProgress(response, onProgress) {
  // Translate cumulative progress into per-response deltas for the stack total.
  let previous = { loaded: 0, total: 0 };
  return readResponseBlobWithProgress(response, (progress) => {
    onProgress?.({
      loadedBytesDelta: progress.loaded - previous.loaded,
      totalBytesDelta: progress.total - previous.total,
    });
    previous = progress;
  }, { defaultType: 'image/png' });
}

function usePreviewSliceCache(imageStack) {
  const [state, setState] = useState({ status: 'idle', imageStack, progress: { loadedBytes: 0, totalBytes: 0 }, error: '' });
  const stackKey = useMemo(() => (Array.isArray(imageStack) ? imageStack.map((entry) => `${entry.id}:${entry.url}`).join('|') : ''), [imageStack]);

  useEffect(() => {
    const stack = Array.isArray(imageStack) ? imageStack : [];
    if (stack.length === 0) {
      setState({ status: 'idle', imageStack: [], progress: { loadedBytes: 0, totalBytes: 0 }, error: '' });
      return undefined;
    }
    if (typeof window === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setState({ status: 'ready', imageStack: stack, progress: { loadedBytes: 0, totalBytes: 0 }, error: '' });
      return undefined;
    }

    const controller = new AbortController();
    const objectUrls = [];
    let loadedBytes = 0;
    let totalBytes = 0;
    let cancelled = false;

    const updateProgress = ({ loadedBytesDelta = 0, totalBytesDelta = 0 } = {}) => {
      loadedBytes += loadedBytesDelta;
      totalBytes += totalBytesDelta;
      if (!cancelled) setState((previous) => ({ ...previous, status: 'loading', progress: { loadedBytes, totalBytes } }));
    };

    setState({ status: 'loading', imageStack: stack, progress: { loadedBytes: 0, totalBytes: 0 }, error: '' });
    Promise.all(stack.map(async (entry) => {
      const response = await fetch(entry.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Failed to cache preview slice (${response.status})`);
      const blob = await readResponseBytesWithProgress(response, updateProgress);
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      return { ...entry, url: objectUrl };
    })).then((cachedStack) => {
      if (!cancelled) setState({ status: 'ready', imageStack: cachedStack, progress: { loadedBytes, totalBytes: totalBytes || loadedBytes }, error: '' });
    }).catch((err) => {
      if (err?.name === 'AbortError' || cancelled) return;
      setState({ status: 'error', imageStack: stack, progress: { loadedBytes, totalBytes }, error: err.message || 'Failed to cache preview slices' });
    });

    return () => {
      cancelled = true;
      controller.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageStack, stackKey]);

  return state;
}

function VolumeSliceViewer({ viewer, onChange, onClose }) {
  const { imageRef, axis, metadata, status, error } = viewer;
  useEffect(() => {
    let cancelled = false;
    fetchImageVolumeMetadata(imageRef.id)
      .then((data) => {
        if (cancelled) return;
        const hasDeclaredColorLayout = (
          data?.channel_count !== undefined
          || data?.channelCount !== undefined
          || data?.color_mode !== undefined
          || data?.colorMode !== undefined
        );
        const volumeDescriptor = createPt3VolumeDescriptor({
          sourceKind: 'server-volume',
          sourceEntry: {
            image_id: imageRef.id,
            filename: imageRef.filename,
            ...(imageRef.metadata || {}),
          },
          // Older metadata endpoints predate explicit channel fields and only
          // served scalar slices. Keep that compatibility at this boundary;
          // any explicitly declared RGB/RGBA layout is still validated.
          probeMetadata: hasDeclaredColorLayout
            ? data
            : { ...data, channel_count: 1, color_mode: 'scalar' },
        });
        if (!volumeDescriptor) throw new Error('Volume metadata response did not include valid dimensions and color layout');
        const dims = getPt3AxisDimensions(volumeDescriptor);
        onChange((previous) => ({
          ...previous,
          metadata: { ...data, dimensions: dims, volumeDescriptor },
          status: 'ready',
          slicePosition: {
            axial: Math.floor((dims.axial - 1) / 2),
            coronal: Math.floor((dims.coronal - 1) / 2),
            sagittal: Math.floor((dims.sagittal - 1) / 2),
          },
        }));
      })
      .catch((err) => { if (!cancelled) onChange((previous) => ({ ...previous, status: 'error', error: err.message || 'Failed to load volume metadata' })); });
    return () => { cancelled = true; };
  }, [imageRef.filename, imageRef.id, imageRef.metadata, onChange]);

  const volumeDescriptor = metadata?.volumeDescriptor || null;
  const dimensions = useMemo(
    () => getPt3AxisDimensions(volumeDescriptor) || { axial: 1, coronal: 1, sagittal: 1 },
    [volumeDescriptor],
  );
  const metadataImageCount = metadata?.image_count ?? dimensions.axial;
  const metadataHeight = metadata?.height ?? dimensions.coronal;
  const metadataWidth = metadata?.width ?? dimensions.sagittal;
  const metadataInterpretation = metadata?.interpretation
    ?? volumeDescriptor?.source?.interpretation;
  const metadataBitDepth = metadata?.bit_depth
    ?? metadata?.metadata_bit_depth
    ?? volumeDescriptor?.samples?.bitDepth;
  const metadataDtype = metadata?.pixel_dtype
    ?? metadata?.voxel_dtype
    ?? volumeDescriptor?.samples?.dtype
    ?? '';
  const slicePosition = viewer.slicePosition || { axial: 0, coronal: 0, sagittal: 0 };
  const axisMax = Math.max(0, Number(dimensions[axis] || 1) - 1);
  const filename = String(imageRef.filename || '').toLowerCase();
  const sourceKind = String(metadata?.source_kind || '').toLowerCase();
  const isServerBackedVolume = /\.(npy|npz|inspiro)$/.test(filename)
    || sourceKind === 'tiff';
  const volumeColorLayout = useMemo(() => ({
    channelCount: volumeDescriptor?.samples?.channelCount || 1,
    colorMode: volumeDescriptor?.samples?.colorMode || 'scalar',
  }), [volumeDescriptor]);
  const serverVolumeSource = useMemo(() => {
    if (!isServerBackedVolume) return null;
    const descriptor = {
      kind: MPR_SERVER_VOLUME_KIND,
      id: String(imageRef.id),
      imageId: String(imageRef.id),
      filename: imageRef.filename,
      dimensions,
      volumeDescriptor,
      ...volumeColorLayout,
      sliceIndex: Math.floor((Math.max(1, Number(dimensions.axial) || 1) - 1) / 2),
    };
    return {
      ...descriptor,
      url: getPt3VolumeSliceUrl(volumeDescriptor, 'axial', descriptor.sliceIndex, {
        rendererVersion: 'rgba-segments-v2',
      }) || getServerVolumeSliceUrl(descriptor, 'axial', descriptor.sliceIndex),
    };
  }, [dimensions, imageRef.filename, imageRef.id, isServerBackedVolume, volumeColorLayout, volumeDescriptor]);
  const axialStack = useMemo(() => (
    isServerBackedVolume
      ? []
      : Array.from({ length: Math.max(1, Number(dimensions.axial) || 1) }, (_, index) => ({
        id: `${imageRef.id}-${index}`,
        sliceIndex: index,
        url: getServerVolumeSliceUrl({ imageId: imageRef.id, dimensions }, 'axial', index),
      }))
  ), [dimensions, imageRef.id, isServerBackedVolume]);
  const previewSliceCache = usePreviewSliceCache(axialStack);
  const volumeCacheState = useMprVolumeCache(serverVolumeSource || previewSliceCache.imageStack, dimensions);
  const previewIsLoading = previewSliceCache.status === 'loading' || volumeCacheState.status === 'loading';
  const imageDimensions = getMprAxisImageDimensions(axis, dimensions, volumeCacheState.cache);
  const setAxis = (nextAxis) => onChange((previous) => ({ ...previous, axis: nextAxis }));
  const setSlice = (value) => {
    const next = Math.max(0, Math.min(axisMax, Math.round(Number(value) || 0)));
    onChange((previous) => ({ ...previous, slicePosition: { ...(previous.slicePosition || slicePosition), [axis]: next } }));
  };
  const handleWheel = (event) => { event.preventDefault(); setSlice((slicePosition[axis] || 0) + (event.deltaY > 0 ? 1 : -1)); };
  return <div className="modal image-part-viewer-modal" role="dialog" aria-modal="true" aria-labelledby="volume-slice-viewer-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-content image-part-viewer-content volume-slice-viewer"><div className="modal-header"><div><h3 id="volume-slice-viewer-title">{imageRef.displayName || imageRef.filename}</h3><p className="muted">Multi-image volume preview</p></div><button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close volume viewer">&times;</button></div><div className="modal-body">{status === 'error' ? <p className="error-message">{error}</p> : null}{metadata ? <><dl className="volume-slice-metadata"><div><dt>Total images</dt><dd>{metadataImageCount}</dd></div><div><dt>Height × Width</dt><dd>{metadataHeight} × {metadataWidth}</dd></div><div><dt>Type</dt><dd>{metadataInterpretation === 'voxel_array' ? 'Voxel array' : 'Stack of 2D images'}</dd></div><div><dt>Bit depth</dt><dd>{metadataBitDepth ?? 'Unknown'}-bit {metadataDtype}</dd></div></dl><div className="volume-slice-controls"><label>Slice axis<select value={axis} onChange={(event) => setAxis(event.target.value)}>{MPR_AXES.map((option) => <option key={option} value={option}>{MPR_AXIS_CONFIG[option].label} ({MPR_AXIS_CONFIG[option].sliceLabel} slices)</option>)}</select></label><label>Slice<input type="range" min="0" max={axisMax} value={slicePosition[axis] || 0} onChange={(event) => setSlice(event.target.value)} onWheel={handleWheel} /></label><label>Current slice<input type="number" min="0" max={axisMax} value={slicePosition[axis] || 0} onChange={(event) => setSlice(event.target.value)} /></label><span>{(slicePosition[axis] || 0) + 1} / {axisMax + 1}</span></div><div className="volume-slice-stage" data-testid="volume-slice-stage" onWheel={handleWheel}>{previewIsLoading ? <div className="volume-slice-loading" role="status" aria-live="polite">{getSliceCachingMessage(previewSliceCache.progress)}</div> : null}{previewSliceCache.status === 'error' ? <div className="volume-slice-loading error-message" role="alert">{previewSliceCache.error}</div> : null}<MprSliceCanvas axis={axis} volumeCache={volumeCacheState.cache} volumeCacheStatus={volumeCacheState.status} slicePosition={slicePosition} dimensions={dimensions} displayWindow={{ min: 0, max: 255 }} displayDomain={{ min: 0, max: 255, step: 1, label: '8-bit preview' }} aria-label={`${MPR_AXIS_CONFIG[axis].label} slice ${slicePosition[axis] || 0}`} style={{ aspectRatio: `${imageDimensions.width} / ${imageDimensions.height}` }} /></div></> : <p className="muted">Loading volume metadata…</p>}</div></div></div>;
}

function ImagesToPartsTab({ projectId, parts = [], images = [], projectConfiguration = null, onAssignmentsChanged, setError }) {
  const initialBuckets = useMemo(() => buildBuckets({ parts, images }), [parts, images]);
  const [localBuckets, setLocalBuckets] = useState(initialBuckets);
  const [movingImages, setMovingImages] = useState([]);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [activeImageModal, setActiveImageModal] = useState(null);
  const [volumeViewer, setVolumeViewer] = useState(null);
  const [selectedUnassigned, setSelectedUnassigned] = useState([]);
  const [selectionDrag, setSelectionDrag] = useState(null);
  const [showSomeModal, setShowSomeModal] = useState(false);
  const [someFilter, setSomeFilter] = useState('');
  const [selectedFilenameKey, setSelectedFilenameKey] = useState('');
  const [autoAssignKeySource, setAutoAssignKeySource] = useState('filename');
  const [autoAssignLevelMode, setAutoAssignLevelMode] = useState('single');
  const [autoAssignLevels, setAutoAssignLevels] = useState([{ id: 1, source: 'filename', value: '' }]);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const unassignedRef = useRef(null);
  const nextAutoAssignLevelId = useRef(2);

  React.useEffect(() => {
    setLocalBuckets(initialBuckets);
    setSelectedUnassigned([]);
  }, [initialBuckets]);

  React.useEffect(() => {
    if (!activeImageModal && !volumeViewer) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') { setActiveImageModal(null); setVolumeViewer(null); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeImageModal, volumeViewer]);

  const findImageRef = (imageKeyOrFilename) => {
    const allImages = [
      ...localBuckets.unassigned,
      ...localBuckets.partBuckets.flatMap((part) => part.images),
    ];
    return allImages.find((image) => image.key === imageKeyOrFilename || image.id === imageKeyOrFilename) || null;
  };

  const isMultiImageRef = (imageRef) => {
    const filename = String(imageRef?.filename || '').toLowerCase();
    const metadata = imageRef?.metadata || {};
    if (!imageRef?.id) return false;
    if (filename.endsWith('.npy') || filename.endsWith('.npz') || filename.endsWith('.inspiro')) return true;
    const isTiff = filename.endsWith('.tif') || filename.endsWith('.tiff');
    if (isTiff) {
      if (metadata.tiff_dimensionality === '2d' || metadata.load_mode === 'single_image') return false;
      return metadata.tiff_dimensionality === '3d' || Number(metadata.frame_count) > 1 || metadata.load_mode === 'volume';
    }
    return Number(metadata.frame_count) > 1 || metadata.load_mode === 'volume' || Boolean(metadata.volume_shape);
  };

  const openImageModal = (imageRef) => {
    if (isMultiImageRef(imageRef)) {
      setVolumeViewer({ imageRef, axis: 'axial', slicePosition: { axial: 0, coronal: 0, sagittal: 0 }, metadata: null, status: 'loading', error: '' });
      return;
    }
    setActiveImageModal({ title: imageRef.displayName || imageRef.filename, images: [imageRef], mode: 'single' });
  };

  const openPartModal = (part) => {
    setActiveImageModal({ title: part.displayName, images: part.images, mode: 'part' });
  };

  const handleCreatePart = async () => {
    const partNameInput = window.prompt('Enter a name for the new part:');
    const partName = typeof partNameInput === 'string' ? partNameInput.trim() : '';
    if (!partName) return;
    try {
      // A malformed 2xx body still means the part was created; fall back to local ids.
      const createdPart = await createProjectPart(projectId, {
        serial_number: partName,
        display_name: partName,
      }, { errorLabel: 'Failed to create part' }).catch((err) => {
        if (err instanceof SyntaxError) return null;
        throw err;
      });
      const createdPartId = createdPart?.id ? String(createdPart.id) : `new-${Date.now()}`;
      const createdSerialNumber = createdPart?.serial_number || partName;
      const createdDisplayName = createdPart?.display_name || partName;
      setLocalBuckets((previous) => ({
        ...previous,
        partBuckets: [
          {
            id: createdPartId,
            serialNumber: createdSerialNumber,
            displayName: createdDisplayName,
            images: [],
          },
          ...previous.partBuckets,
        ],
      }));
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to create part');
    }
  };

  const assignImagesToPart = async (imageKeys, toPartId) => {
    const imagesToMove = imageKeys.map(findImageRef).filter((image) => image?.filename);
    if (!imagesToMove.length) return;
    try {
      for (const image of imagesToMove) {
        await assignImageToPart(projectId, {
          filename: image.filename,
          image_id: image.id || null,
          to_part_id: toPartId || null,
        }, { errorLabel: 'Failed to move image' });
      }
      const movedSet = new Set(imagesToMove.map((image) => image.key || image.id || image.filename));
      const movedImages = imagesToMove;
      const nextBuckets = {
        partBuckets: localBuckets.partBuckets.map((part) => {
          const withoutMoved = part.images.filter((image) => !movedSet.has(image.key || image.id || image.filename));
          if (part.id !== toPartId) return { ...part, images: withoutMoved };
          return {
            ...part,
            images: [...withoutMoved, ...movedImages.filter((img) => !withoutMoved.some((existing) => (existing.key || existing.id || existing.filename) === (img.key || img.id || img.filename)))]
              .sort(compareImageRefs),
          };
        }),
        unassigned: toPartId
          ? localBuckets.unassigned.filter((image) => !movedSet.has(image.key || image.id || image.filename))
          : [...localBuckets.unassigned, ...movedImages.filter((img) => !localBuckets.unassigned.some((existing) => (existing.key || existing.id || existing.filename) === (img.key || img.id || img.filename)))]
            .sort(compareImageRefs),
      };
      setLocalBuckets(nextBuckets);
      setSelectedUnassigned((prev) => prev.filter((key) => !movedSet.has(key)));
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to assign image(s) to part');
    } finally {
      setMovingImages([]);
    }
  };

  const handleDropToPart = async (toPartId) => {
    await assignImagesToPart(movingImages, toPartId);
  };

  const handleDropToUnassigned = async () => {
    await assignImagesToPart(movingImages, null);
  };

  const handleDeletePart = async (part) => {
    const confirmed = window.confirm(`Delete ${part.displayName}? Images assigned to this part will move to Unassigned.`);
    if (!confirmed) return;
    try {
      await deleteProjectPart(projectId, part.id);
      setLocalBuckets((previous) => ({
        partBuckets: previous.partBuckets.filter((entry) => entry.id !== part.id),
        unassigned: [...previous.unassigned, ...part.images]
          .filter((image, index, all) => all.findIndex((candidate) => (candidate.key || candidate.id || candidate.filename) === (image.key || image.id || image.filename)) === index)
          .sort(compareImageRefs),
      }));
      setSelectedUnassigned([]);
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(appendHttpCallToErrorMessage(err.message || 'Failed to delete part', {
        method: 'DELETE',
        url: `/api/projects/${projectId}/parts/${encodeURIComponent(String(part.id))}`,
      }));
    }
  };

  const handleChipDragStart = (imageRef) => {
    const imageKey = imageRef.key || imageRef.id || imageRef.filename;
    if (selectedUnassigned.includes(imageKey)) setMovingImages(selectedUnassigned);
    else setMovingImages([imageKey]);
  };

  const toggleUnassignedSelection = (imageRef) => {
    const imageKey = imageRef.key || imageRef.id || imageRef.filename;
    setSelectedUnassigned((prev) => (prev.includes(imageKey) ? prev.filter((item) => item !== imageKey) : [...prev, imageKey]));
  };

  const updateSelectionFromRect = (rect) => {
    if (!unassignedRef.current) return;
    const chips = Array.from(unassignedRef.current.querySelectorAll('[data-image-filename]'));
    const selected = chips
      .filter((node) => {
        const bounds = node.getBoundingClientRect();
        return !(bounds.right < rect.left || bounds.left > rect.right || bounds.bottom < rect.top || bounds.top > rect.bottom);
      })
      .map((node) => node.getAttribute('data-image-key'))
      .filter(Boolean);
    setSelectedUnassigned(Array.from(new Set(selected)));
  };

  const startDragSelect = (event) => {
    if (event.target.closest('button')) return;
    const origin = { x: event.clientX, y: event.clientY };
    setSelectionDrag({ origin, current: origin });
  };

  React.useEffect(() => {
    if (!selectionDrag) return undefined;
    const onMove = (event) => {
      const next = { ...selectionDrag, current: { x: event.clientX, y: event.clientY } };
      setSelectionDrag(next);
      const rect = {
        left: Math.min(next.origin.x, next.current.x),
        right: Math.max(next.origin.x, next.current.x),
        top: Math.min(next.origin.y, next.current.y),
        bottom: Math.max(next.origin.y, next.current.y),
      };
      updateSelectionFromRect(rect);
    };
    const onUp = () => setSelectionDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [selectionDrag]);

  const renderImageChip = (imageRef, isUnassigned = false) => (
    <button
      key={imageRef.key || imageRef.id || imageRef.filename}
      type="button"
      className={`image-part-chip ${isUnassigned && selectedUnassigned.includes(imageRef.key || imageRef.id || imageRef.filename) ? 'selected' : ''}`}
      draggable
      data-image-filename={imageRef.filename}
      data-image-key={imageRef.key || imageRef.id || imageRef.filename}
      onClick={() => (isUnassigned ? toggleUnassignedSelection(imageRef) : openImageModal(imageRef))}
      onDoubleClick={() => openImageModal(imageRef)}
      onDragStart={() => handleChipDragStart(imageRef)}
      title={imageRef.displayName && imageRef.displayName !== imageRef.filename ? `${imageRef.filename} (${imageRef.id || 'duplicate upload'})` : (imageRef.id ? `Open ${imageRef.filename}` : `${imageRef.filename} has no image record`)}
    >
      {showThumbnails && imageRef.thumbnailUrl ? <img src={imageRef.thumbnailUrl} alt="" className="image-part-chip-thumbnail" loading="lazy" /> : null}
      <span>{imageRef.displayName || imageRef.filename}</span>
    </button>
  );

  const autoAssignDelimiter = useMemo(() => getAutoAssignDelimiter(projectConfiguration), [projectConfiguration]);
  const autoAssignFieldOptions = useMemo(
    () => buildAutoAssignFieldOptions(images, projectConfiguration, autoAssignDelimiter),
    [images, projectConfiguration, autoAssignDelimiter]
  );
  const selectedAutoAssignOption = useMemo(
    () => autoAssignFieldOptions.find((option) => (autoAssignKeySource === 'metadata' ? option.metadataKey === selectedFilenameKey : option.filenameKey === selectedFilenameKey)) || null,
    [autoAssignFieldOptions, autoAssignKeySource, selectedFilenameKey]
  );
  const normalizedAutoAssignLevels = useMemo(() => {
    if (autoAssignLevelMode !== 'multi') {
      return [{
        source: autoAssignKeySource,
        filenameKey: selectedAutoAssignOption?.filenameKey || selectedFilenameKey,
        metadataKey: selectedAutoAssignOption?.metadataKey || selectedFilenameKey,
      }];
    }
    return autoAssignLevels.map((level) => {
      const selected = autoAssignFieldOptions.find((option) => (level.source === 'metadata' ? option.metadataKey === level.value : option.filenameKey === level.value)) || null;
      return {
        source: level.source === 'metadata' ? 'metadata' : 'filename',
        filenameKey: selected?.filenameKey || level.value,
        metadataKey: selected?.metadataKey || level.value,
      };
    });
  }, [autoAssignLevelMode, autoAssignLevels, autoAssignFieldOptions, autoAssignKeySource, selectedAutoAssignOption, selectedFilenameKey]);

  const autoAssignPreview = useMemo(
    () => buildAutoAssignPreview(localBuckets.unassigned, selectedAutoAssignOption?.filenameKey || selectedFilenameKey, autoAssignDelimiter, {
      source: autoAssignKeySource,
      selectedMetadataKey: selectedAutoAssignOption?.metadataKey || selectedFilenameKey,
      levels: normalizedAutoAssignLevels,
    }),
    [localBuckets.unassigned, selectedFilenameKey, autoAssignDelimiter, autoAssignKeySource, selectedAutoAssignOption, normalizedAutoAssignLevels]
  );

  const findPartByKey = (partKey, buckets = localBuckets.partBuckets) => buckets.find((part) => normalizePartKey(part.serialNumber || part.displayName) === partKey);

  const handleAutoAssignParts = async () => {
    const preview = buildAutoAssignPreview(localBuckets.unassigned, selectedAutoAssignOption?.filenameKey || selectedFilenameKey, autoAssignDelimiter, {
      source: autoAssignKeySource,
      selectedMetadataKey: selectedAutoAssignOption?.metadataKey || selectedFilenameKey,
      levels: normalizedAutoAssignLevels,
    });
    if (preview.length === 0) return;
    setAutoAssigning(true);
    try {
      const nextPartBuckets = [...localBuckets.partBuckets];
      const partByKey = new Map(nextPartBuckets.map((part) => [normalizePartKey(part.serialNumber || part.displayName), part]));
      const newlyAssignedKeys = new Set();

      for (const group of preview) {
        let targetPart = partByKey.get(group.partKey) || findPartByKey(group.partKey, nextPartBuckets);
        if (!targetPart) {
          const createdPart = await createProjectPart(projectId, {
            serial_number: group.partKey,
            display_name: group.partKey,
          }, { errorLabel: `Failed to create part ${group.partKey}` });
          targetPart = {
            id: createdPart?.id ? String(createdPart.id) : `new-${group.partKey}-${Date.now()}`,
            serialNumber: createdPart?.serial_number || group.partKey,
            displayName: createdPart?.display_name || group.partKey,
            images: [],
          };
          nextPartBuckets.push(targetPart);
          partByKey.set(group.partKey, targetPart);
        }

        for (const image of group.images) {
          await assignImageToPart(projectId, {
            filename: image.filename,
            image_id: image.id || null,
            to_part_id: targetPart.id,
          }, { errorLabel: `Failed to assign ${image.filename}` });
          const imageKey = image.key || image.id || image.filename;
          newlyAssignedKeys.add(imageKey);
          if (!targetPart.images.some((existing) => (existing.key || existing.id || existing.filename) === imageKey)) {
            targetPart.images.push(image);
          }
        }
        targetPart.images.sort(compareImageRefs);
      }

      setLocalBuckets({
        partBuckets: nextPartBuckets.sort((left, right) => (left.displayName || '').localeCompare(right.displayName || '')),
        unassigned: localBuckets.unassigned.filter((image) => !newlyAssignedKeys.has(image.key || image.id || image.filename)),
      });
      setSelectedUnassigned((prev) => prev.filter((key) => !newlyAssignedKeys.has(key)));
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to auto-assign images to parts');
    } finally {
      setAutoAssigning(false);
    }
  };

  const filteredUnassigned = useMemo(() => {
    if (!someFilter.trim()) return localBuckets.unassigned;
    try {
      const regex = new RegExp(someFilter, 'i');
      return localBuckets.unassigned.filter((img) => regex.test(img.filename));
    } catch {
      return [];
    }
  }, [localBuckets.unassigned, someFilter]);

  return (
    <div className="project-data-tab-panel" role="tabpanel" aria-label="Images to Parts">
      <section className="workbench-panel">
        <header className="workbench-header"><div><h2>Images to Parts</h2><p>Drag images into target parts to repair or refine image assignments.</p></div>
          <label className="thumbnail-switch"><input type="checkbox" checked={showThumbnails} onChange={(event) => setShowThumbnails(event.target.checked)} aria-label="Show image thumbnails" />
            <span className="thumbnail-switch-track" aria-hidden="true"><span className="thumbnail-switch-thumb" /></span><span>Thumbnails</span></label></header>

        <section className="auto-assign-parts-panel" aria-label="Automatically assign images to parts">
          <div className="auto-assign-panel-header">
            <div>
              <h3>Automatically Assign Images to Parts</h3>
              <p className="muted">Select whether autoassign should use filename elements or their mapped metadata labels. Use Blank key to match delimiter-separated numeric filename segments.</p>
            </div>
            <div className="auto-assign-switch-group">
              <label className="auto-assign-source-switch" htmlFor="auto-assign-key-source">
                <span className={autoAssignKeySource === 'filename' ? 'active' : ''}>Filename</span>
                <input
                  id="auto-assign-key-source"
                  type="checkbox"
                  checked={autoAssignKeySource === 'metadata'}
                  onChange={(event) => { setAutoAssignKeySource(event.target.checked ? 'metadata' : 'filename'); setSelectedFilenameKey(''); }}
                  aria-label="Use metadata labels for autoassign"
                />
                <span className="auto-assign-source-switch-track" aria-hidden="true"><span className="auto-assign-source-switch-thumb" /></span>
                <span className={autoAssignKeySource === 'metadata' ? 'active' : ''}>Metadata</span>
              </label>
              <label className="auto-assign-source-switch" htmlFor="auto-assign-level-mode">
                <span className={autoAssignLevelMode === 'single' ? 'active' : ''}>Single-level</span>
                <input
                  id="auto-assign-level-mode"
                  type="checkbox"
                  checked={autoAssignLevelMode === 'multi'}
                  onChange={(event) => setAutoAssignLevelMode(event.target.checked ? 'multi' : 'single')}
                  aria-label="Use multi-level autoassign"
                />
                <span className="auto-assign-source-switch-track" aria-hidden="true"><span className="auto-assign-source-switch-thumb" /></span>
                <span className={autoAssignLevelMode === 'multi' ? 'active' : ''}>Multi-level</span>
              </label>
            </div>
          </div>
          <div className="auto-assign-token-list">
            {autoAssignLevelMode === 'single' ? (
              <label className="auto-assign-token-option" htmlFor="auto-assign-filename-key">
                <span><strong>{autoAssignKeySource === 'metadata' ? 'Metadata label' : 'Filename key'}</strong><small>Delimiter: {autoAssignDelimiter || 'automatic non-alphanumeric split'}</small></span>
                <select
                  id="auto-assign-filename-key"
                  value={selectedFilenameKey}
                  onChange={(event) => setSelectedFilenameKey(event.target.value)}
                  aria-label="Filename key for autoassign"
                >
                  {autoAssignKeySource === 'filename' ? <option value="">Blank key (numeric segment)</option> : <option value="">Select metadata label</option>}
                  {Array.from(new Set(autoAssignFieldOptions
                    .map((option) => (autoAssignKeySource === 'metadata' ? option.metadataKey : option.filenameKey))
                    .filter(Boolean)))
                    .map((value) => <option key={`${autoAssignKeySource}:${value}`} value={value}>{value}</option>)}
                </select>
              </label>
            ) : (
              <div className="auto-assign-multi-level-editor" aria-label="Multi-level autoassign levels">
                {autoAssignLevels.map((level, index) => (
                  <div className="auto-assign-level-row" key={level.id}>
                    <label htmlFor={`auto-assign-level-source-${level.id}`}>Level {index + 1} source</label>
                    <select
                      id={`auto-assign-level-source-${level.id}`}
                      value={level.source}
                      onChange={(event) => setAutoAssignLevels((prev) => prev.map((item) => (item.id === level.id ? { ...item, source: event.target.value, value: '' } : item)))}
                    >
                      <option value="filename">Filename</option>
                      <option value="metadata">Metadata</option>
                    </select>
                    <label htmlFor={`auto-assign-level-key-${level.id}`}>{level.source === 'metadata' ? 'Metadata label' : 'Filename key'}</label>
                    <select
                      id={`auto-assign-level-key-${level.id}`}
                      value={level.value}
                      onChange={(event) => setAutoAssignLevels((prev) => prev.map((item) => (item.id === level.id ? { ...item, value: event.target.value } : item)))}
                    >
                      {level.source === 'filename' ? <option value="">Blank key (numeric segment)</option> : <option value="">Select metadata label</option>}
                      {Array.from(new Set(autoAssignFieldOptions
                        .map((option) => (level.source === 'metadata' ? option.metadataKey : option.filenameKey))
                        .filter(Boolean)))
                        .map((value) => <option key={`${level.id}:${level.source}:${value}`} value={value}>{value}</option>)}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAutoAssignLevels((prev) => prev.filter((item) => item.id !== level.id))} disabled={autoAssignLevels.length === 1}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAutoAssignLevels((prev) => [...prev, { id: nextAutoAssignLevelId.current++, source: 'filename', value: '' }])}>Add level</button>
                <small>Each image must match every configured level; created part names join matched values in level order.</small>
              </div>
            )}
          </div>
          <div className="auto-assign-preview-row">
            <span>{autoAssignPreview.length} part{autoAssignPreview.length === 1 ? '' : 's'} will be updated from {autoAssignPreview.reduce((sum, group) => sum + group.images.length, 0)} image{autoAssignPreview.reduce((sum, group) => sum + group.images.length, 0) === 1 ? '' : 's'}.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleAutoAssignParts} disabled={autoAssigning || autoAssignPreview.length === 0}>{autoAssigning ? 'Assigning…' : 'Assign Parts'}</button>
          </div>
          {autoAssignPreview.length > 0 ? (
            <div className="auto-assign-preview-list" aria-label="Autoassign preview by part">
              {autoAssignPreview.slice(0, 8).map((group) => (
                <div className="auto-assign-preview-card" key={group.partKey}>
                  <div className="auto-assign-preview-part">
                    <strong>Part {group.partKey}</strong>
                    <span>{group.images.length} image{group.images.length === 1 ? '' : 's'}</span>
                  </div>
                  <ul className="auto-assign-preview-filenames">
                    {group.images.map((image) => (
                      <li key={image.key || image.id || image.filename} title={image.displayName || image.filename}>{image.displayName || image.filename}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <div className="images-to-parts-grid">
          <div className="images-to-parts-column assignment-source-column sticky-assignment-column" onDragOver={(event) => event.preventDefault()} onDrop={handleDropToUnassigned} data-testid="images-to-parts-unassigned-target">
            <div className="unassigned-header-row"><h3>Unassigned</h3><div className="unassigned-actions"><button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedUnassigned(localBuckets.unassigned.map((img) => img.key || img.id || img.filename))}>All</button><button type="button" className="btn-secondary btn-sm" onClick={() => setShowSomeModal(true)}>Some</button><button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedUnassigned([])}>None</button></div></div>
            {localBuckets.unassigned.length === 0 ? <p className="muted">No unassigned images.</p> : null}
            <div className="unassigned-selection-surface" onMouseDown={startDragSelect} ref={unassignedRef}>
              <div className="image-part-chip-list">{localBuckets.unassigned.map((img) => renderImageChip(img, true))}</div>
              {selectionDrag ? <div className="selection-rect" style={{ left: Math.min(selectionDrag.origin.x, selectionDrag.current.x), top: Math.min(selectionDrag.origin.y, selectionDrag.current.y), width: Math.abs(selectionDrag.current.x - selectionDrag.origin.x), height: Math.abs(selectionDrag.current.y - selectionDrag.origin.y) }} /> : null}
            </div>
          </div>

          <div className="images-to-parts-column parts-column">
            <div className="parts-column-header"><h3>Parts</h3><button type="button" className="btn-secondary btn-sm" onClick={handleCreatePart}>Create new part</button></div>
            {localBuckets.partBuckets.map((part) => (
              <div key={part.id} className="images-to-parts-part-card" onDragOver={(event) => event.preventDefault()} onDrop={() => handleDropToPart(part.id)} data-testid={`images-to-parts-target-${part.id}`}>
                <div className="part-card-header-row">
                  <h3><button type="button" className="part-heading-button" onClick={() => openPartModal(part)}>{part.displayName}</button></h3>
                  <button type="button" className="part-delete-button" onClick={() => handleDeletePart(part)} aria-label={`Delete part ${part.displayName}`} title="Delete part">×</button>
                </div>
                <div className="image-part-chip-list">{part.images.length === 0 ? <p className="muted">No mapped images.</p> : part.images.map((img) => renderImageChip(img, false))}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {showSomeModal ? <div className="modal image-part-viewer-modal" role="dialog" aria-modal="true" aria-label="Some selection modal"><div className="modal-content image-part-viewer-content fullscreen-some-modal"><div className="modal-header"><h3>Select Some Images</h3><button type="button" className="modal-close-btn" onClick={() => setShowSomeModal(false)} aria-label="Close some selection">&times;</button></div><div className="modal-body"><label>Regex filter<input type="text" value={someFilter} onChange={(e) => setSomeFilter(e.target.value)} placeholder="e.g. ^cam1_.*\\.png$" /></label><div className="image-part-chip-list">{filteredUnassigned.map((img) => renderImageChip(img, true))}</div></div></div></div> : null}

      {volumeViewer ? <VolumeSliceViewer viewer={volumeViewer} onChange={setVolumeViewer} onClose={() => setVolumeViewer(null)} /> : null}

      {activeImageModal && (
        <div className="modal image-part-viewer-modal" role="dialog" aria-modal="true" aria-labelledby="image-part-viewer-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveImageModal(null); }}>
          <div className="modal-content image-part-viewer-content"><div className="modal-header"><div><h3 id="image-part-viewer-title">{activeImageModal.title}</h3>{activeImageModal.subtitle ? <p className="muted">{activeImageModal.subtitle}</p> : null}</div><button type="button" className="modal-close-btn" onClick={() => setActiveImageModal(null)} aria-label="Close image viewer">&times;</button></div>
            <div className="modal-body">{activeImageModal.images.length === 0 ? <p className="muted">No mapped images for this part.</p> : <div className={activeImageModal.mode === 'single' ? 'image-part-single-view' : 'image-part-tile-grid'}>{activeImageModal.images.map((imageRef) => (<figure className="image-part-viewer-tile" key={imageRef.key || imageRef.id || imageRef.filename}>{imageRef.contentUrl ? <img src={imageRef.contentUrl} alt={imageRef.displayName || imageRef.filename} loading="lazy" onError={(event) => { if (imageRef.thumbnailUrl && event.currentTarget.src !== imageRef.thumbnailUrl) event.currentTarget.src = imageRef.thumbnailUrl; }} /> : <div className="image-part-missing-preview">Image unavailable</div>}<figcaption>{imageRef.displayName || imageRef.filename}</figcaption></figure>))}</div>}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImagesToPartsTab;
export { buildBuckets };
