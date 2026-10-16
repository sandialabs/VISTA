import React, { useMemo, useState } from 'react';
import { updateOverlayAssignment } from '../api/parts';
import { buildActiveImageCatalog, parseMetadataBoolean, resolveImageReference } from '../utils/imageIdentity';

function buildImageIndexes(images) {
  const catalog = buildActiveImageCatalog(images);
  const refs = catalog.refs.map((ref) => ({
    ...ref,
    thumbnailUrl: ref.id ? `/api/images/${encodeURIComponent(ref.id)}/thumbnail?width=96&height=96` : '',
    contentUrl: ref.id ? `/api/images/${encodeURIComponent(ref.id)}/content` : '',
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

function makeImageRef(sourceRecord, imageIndexes) {
  const filename = typeof sourceRecord === 'string' ? sourceRecord : String(sourceRecord?.filename || '');
  const result = resolveImageReference({
    image_id: typeof sourceRecord === 'object' ? sourceRecord?.image_id : undefined,
    filename,
  }, imageIndexes);
  return result.status === 'resolved' ? result.ref : null;
}

function getImageKey(image) {
  return image?.id || image?.key || '';
}

function compareImageRefs(left, right) {
  return String(left?.filename || '').localeCompare(String(right?.filename || ''))
    || (Number(left?.displayOrdinal) || 0) - (Number(right?.displayOrdinal) || 0)
    || String(left?.displayName || '').localeCompare(String(right?.displayName || ''));
}

function deriveBaseFilenameFromOverlaySuffix(filename = '') {
  const safeFilename = String(filename || '').trim();
  if (!safeFilename) return '';
  const dotIndex = safeFilename.lastIndexOf('.');
  const stem = dotIndex > 0 ? safeFilename.slice(0, dotIndex) : safeFilename;
  const extension = dotIndex > 0 ? safeFilename.slice(dotIndex) : '';
  if (!stem.toLowerCase().endsWith('_overlay')) return '';
  return `${stem.slice(0, -'_overlay'.length)}${extension}`;
}

function findAutoassignments(buckets) {
  const baseBuckets = Array.isArray(buckets?.baseBuckets) ? buckets.baseBuckets : [];
  const unassignedOverlays = Array.isArray(buckets?.unassignedOverlays) ? buckets.unassignedOverlays : [];
  const assignments = [];

  unassignedOverlays.forEach((overlay) => {
    const overlayKey = getImageKey(overlay);
    const exactCandidates = baseBuckets.filter((bucket) => bucket?.image?.filename === overlay.filename && getImageKey(bucket.image) !== overlayKey);
    const suffixBaseFilename = deriveBaseFilenameFromOverlaySuffix(overlay.filename);
    const suffixCandidates = suffixBaseFilename
      ? baseBuckets.filter((bucket) => bucket?.image?.filename === suffixBaseFilename && getImageKey(bucket.image) !== overlayKey)
      : [];
    const candidates = exactCandidates.length > 0 ? exactCandidates : suffixCandidates;
    if (candidates.length !== 1) return;
    const target = candidates[0];
    if ((target.overlays || []).some((assigned) => getImageKey(assigned) === overlayKey)) return;
    assignments.push({ overlayImage: overlay, baseImage: target.image });
  });

  return assignments;
}

function buildOverlayBuckets({ parts, images }) {
  const imageIndexes = buildImageIndexes(images);
  const assignedOverlayKeys = new Set();
  const assignedBaseKeys = new Set();
  const baseBuckets = [];

  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
    const analysisOutputs = Array.isArray(part?.metadata?.analysis_outputs) ? part.metadata.analysis_outputs : [];
    const overlayRecords = [...sourceImages, ...analysisOutputs];
    const seenBaseKeys = new Set();
    const bases = sourceImages
      .filter((record) => record && !parseMetadataBoolean(record.overlay) && record.filename)
      .map((record) => {
        const image = makeImageRef(record, imageIndexes);
        if (!image) return null;
        const imageKey = getImageKey(image);
        if (!imageKey || seenBaseKeys.has(imageKey) || assignedBaseKeys.has(imageKey)) return null;
        seenBaseKeys.add(imageKey);
        assignedBaseKeys.add(imageKey);
        return {
          partId: part.id,
          partName: part.display_name || part.serial_number || 'Unassigned part',
          image: { ...image, side: record.side || '' },
          overlays: [],
        };
      })
      .filter(Boolean);
    const bucketsByImageId = new Map(bases.filter((bucket) => bucket.image.id).map((bucket) => [bucket.image.id, bucket]));
    const bucketsByFilename = new Map();
    bases.forEach((bucket) => {
      if (!bucketsByFilename.has(bucket.image.filename)) bucketsByFilename.set(bucket.image.filename, []);
      bucketsByFilename.get(bucket.image.filename).push(bucket);
    });
    overlayRecords
      .filter((record) => record && parseMetadataBoolean(record.overlay) && record.filename)
      .forEach((record) => {
        const overlayRef = makeImageRef(record, imageIndexes);
        if (!overlayRef) return;
        const overlayKey = getImageKey(overlayRef);
        if (!overlayKey || assignedOverlayKeys.has(overlayKey)) return;
        const baseImageId = String(record.overlay_base_image_id || '').trim();
        const baseFilename = String(record.overlay_base_filename || '').trim();
        const fallbackSide = String(record.side || '').trim().toLowerCase();
        let target = null;
        if (baseImageId) {
          target = bucketsByImageId.get(baseImageId) || null;
        } else if (baseFilename) {
          const candidates = bucketsByFilename.get(baseFilename) || [];
          if (candidates.length === 1) [target] = candidates;
        } else if (fallbackSide) {
          const candidates = bases.filter((bucket) => String(bucket.image.side || '').trim().toLowerCase() === fallbackSide);
          if (candidates.length === 1) [target] = candidates;
        } else if (bases.length === 1) {
          [target] = bases;
        }
        if (!target) return;
        target.overlays.push(overlayRef);
        assignedOverlayKeys.add(overlayKey);
      });
    baseBuckets.push(...bases);
  });

  const unassignedOverlays = imageIndexes.refs
    .filter((image) => !assignedOverlayKeys.has(getImageKey(image)) && !assignedBaseKeys.has(getImageKey(image)))
    .sort(compareImageRefs);

  baseBuckets.sort((left, right) => compareImageRefs(left.image, right.image));
  baseBuckets.forEach((bucket) => bucket.overlays.sort(compareImageRefs));
  return { baseBuckets, unassignedOverlays };
}
function OverlaysTab({ projectId, parts = [], images = [], onAssignmentsChanged, setError }) {
  const initialBuckets = useMemo(() => buildOverlayBuckets({ parts, images }), [parts, images]);
  const [localBuckets, setLocalBuckets] = useState(initialBuckets);
  const [movingImage, setMovingImage] = useState(null);
  const [autoassigning, setAutoassigning] = useState(false);
  const [autoassignMessage, setAutoassignMessage] = useState('');

  React.useEffect(() => {
    setLocalBuckets(initialBuckets);
  }, [initialBuckets]);

  const assignOverlay = async (overlayImage, baseImage = null, options = {}) => {
    if (!overlayImage?.filename) return false;
    const overlayKey = getImageKey(overlayImage);
    const baseKey = baseImage ? getImageKey(baseImage) : '';
    try {
      await updateOverlayAssignment(projectId, {
        overlay_filename: overlayImage.filename,
        overlay_image_id: overlayImage.id || null,
        base_filename: baseImage?.filename || null,
        base_image_id: baseImage?.id || null,
      });
      setLocalBuckets((previous) => {
        const moved = previous.unassignedOverlays.find((image) => getImageKey(image) === overlayKey)
          || previous.baseBuckets.flatMap((bucket) => bucket.overlays).find((image) => getImageKey(image) === overlayKey)
          || overlayImage;
        return {
          unassignedOverlays: baseImage ? previous.unassignedOverlays.filter((image) => getImageKey(image) !== overlayKey) : [...previous.unassignedOverlays.filter((image) => getImageKey(image) !== overlayKey), moved].sort(compareImageRefs),
          baseBuckets: previous.baseBuckets.map((bucket) => ({
            ...bucket,
            overlays: [
              ...bucket.overlays.filter((image) => getImageKey(image) !== overlayKey),
              ...(baseImage && getImageKey(bucket.image) === baseKey ? [moved] : []),
            ].sort(compareImageRefs),
          })),
        };
      });
      setMovingImage(null);
      if (onAssignmentsChanged && options.refresh !== false) await onAssignmentsChanged();
      if (setError) setError(null);
      return true;
    } catch (err) {
      if (setError) setError(err.message || 'Failed to move overlay');
      return false;
    }
  };

  const handleAutoassign = async () => {
    const assignments = findAutoassignments(localBuckets);
    if (assignments.length === 0) {
      setAutoassignMessage('No filename matches found.');
      return;
    }

    setAutoassigning(true);
    setAutoassignMessage('');
    let assignedCount = 0;
    try {
      for (const assignment of assignments) {
        // Keep assignment requests sequential so the backend always sees the latest part metadata.
        // eslint-disable-next-line no-await-in-loop
        const assigned = await assignOverlay(assignment.overlayImage, assignment.baseImage, { refresh: false });
        if (assigned) assignedCount += 1;
      }
      if (onAssignmentsChanged && assignedCount > 0) await onAssignmentsChanged();
      setAutoassignMessage(assignedCount > 0 ? `Autoassigned ${assignedCount} overlay${assignedCount === 1 ? '' : 's'}.` : 'No overlays were autoassigned.');
    } catch (err) {
      if (setError) setError(err.message || 'Failed to autoassign overlays');
      setAutoassignMessage('Autoassign did not finish.');
    } finally {
      setAutoassigning(false);
    }
  };

  const renderChip = (image, assigned = false) => (
    <button
      key={image.key || image.id || image.filename}
      type="button"
      className="image-part-chip overlay-image-chip"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', image.id || image.filename);
        setMovingImage(image);
      }}
      aria-label={image.displayName || image.filename}
    >
      {image.thumbnailUrl ? <img src={image.thumbnailUrl} alt="" className="image-part-chip-thumbnail" loading="lazy" /> : null}
      <span>{image.displayName || image.filename}</span>
      {assigned ? <small>overlay</small> : null}
    </button>
  );

  const dropToBase = (baseImage) => {
    if (movingImage) assignOverlay(movingImage, baseImage);
  };

  return (
    <div className="project-data-tab-panel" role="tabpanel" aria-label="Overlays">
      <section className="workbench-panel images-to-parts-panel overlays-panel">
        <header className="workbench-header">
          <div>
            <h2>Overlays</h2>
            <p>Drag loaded images onto base images to map them as overlays. Multiple overlays can be assigned to each base image.</p>
            {autoassignMessage ? <p className="muted" role="status">{autoassignMessage}</p> : null}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleAutoassign}
            disabled={autoassigning || localBuckets.unassignedOverlays.length === 0 || localBuckets.baseBuckets.length === 0}
          >
            {autoassigning ? 'Autoassigning…' : 'Autoassign'}
          </button>
        </header>
        <div className="images-to-parts-grid overlays-grid">
          <div className="images-to-parts-column assignment-source-column sticky-assignment-column" onDragOver={(event) => event.preventDefault()} onDrop={() => assignOverlay(movingImage, null)} data-testid="overlays-unassigned-target">
            <h3>Available overlay images</h3>
            <div className="image-part-chip-list">
              {localBuckets.unassignedOverlays.length === 0 ? <p className="muted">No available overlay images.</p> : localBuckets.unassignedOverlays.map((image) => renderChip(image))}
            </div>
          </div>
          <div className="images-to-parts-column parts-column overlays-target-column">
            <div className="parts-column-header">
              <h3>Image / Overlay Assignments</h3>
            </div>
            {localBuckets.baseBuckets.length === 0 ? <p className="muted">Assign images to parts before mapping overlays.</p> : localBuckets.baseBuckets.map((bucket) => (
              <article key={`${bucket.partId}-${bucket.image.id || bucket.image.filename}`} className="images-to-parts-part-card overlay-assignment-card" onDragOver={(event) => event.preventDefault()} onDrop={() => dropToBase(bucket.image)} data-testid={`overlay-target-${bucket.image.id || bucket.image.filename}`}>
                <div className="overlay-base-column">
                  <h3>{bucket.image.displayName || bucket.image.filename}</h3>
                  <p className="muted">{bucket.partName}</p>
                  {renderChip(bucket.image)}
                </div>
                <div className="overlay-side-column">
                  <h4>Overlays</h4>
                  <div className="image-part-chip-list overlay-chip-list">
                    {bucket.overlays.length === 0 ? <p className="muted">Drop overlays here.</p> : bucket.overlays.map((image) => renderChip(image, true))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default OverlaysTab;
export { buildOverlayBuckets, deriveBaseFilenameFromOverlaySuffix, findAutoassignments };
