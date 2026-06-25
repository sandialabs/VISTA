import React, { useMemo, useState } from 'react';

function tagDuplicateFilename(filename = '', occurrence = 0) {
  const safeFilename = String(filename || 'image').trim() || 'image';
  if (occurrence <= 0) return safeFilename;
  const dotIndex = safeFilename.lastIndexOf('.');
  const suffix = occurrence === 1 ? ' (duplicate)' : ` (duplicate ${occurrence})`;
  if (dotIndex > 0) return `${safeFilename.slice(0, dotIndex)}${suffix}${safeFilename.slice(dotIndex)}`;
  return `${safeFilename}${suffix}`;
}

function buildImageIndexes(images) {
  const refs = [];
  const byId = new Map();
  const byFilename = new Map();
  const filenameCounts = new Map();
  (Array.isArray(images) ? images : [])
    .filter((image) => image?.filename && !image?.deleted_at)
    .forEach((image, index) => {
      const filename = String(image.filename || '');
      const occurrence = filenameCounts.get(filename) || 0;
      filenameCounts.set(filename, occurrence + 1);
      const id = image?.id ? String(image.id) : '';
      if (id && byId.has(id)) return;
      const ref = {
        key: id || `filename:${filename}:${index}`,
        filename,
        displayName: tagDuplicateFilename(filename, occurrence),
        id,
        thumbnailUrl: id ? `/api/images/${encodeURIComponent(id)}/thumbnail?width=96&height=96` : '',
        contentUrl: id ? `/api/images/${encodeURIComponent(id)}/content` : '',
      };
      refs.push(ref);
      if (id) byId.set(id, ref);
      if (!byFilename.has(filename)) byFilename.set(filename, []);
      byFilename.get(filename).push(ref);
    });
  return { refs, byId, byFilename };
}

function makeImageRef(sourceRecord, imageIndexes) {
  const filename = typeof sourceRecord === 'string' ? sourceRecord : String(sourceRecord?.filename || '');
  const imageId = typeof sourceRecord === 'object' && sourceRecord?.image_id ? String(sourceRecord.image_id) : '';
  const matched = (imageId && imageIndexes.byId.get(imageId)) || (filename && (imageIndexes.byFilename.get(filename) || [])[0]) || null;
  if (!matched && !filename) return null;
  return {
    ...(matched || {}),
    key: imageId || matched?.key || filename,
    filename: filename || matched?.filename || '',
    displayName: matched?.displayName || filename,
    id: imageId || matched?.id || '',
    thumbnailUrl: (imageId || matched?.id) ? `/api/images/${encodeURIComponent(imageId || matched.id)}/thumbnail?width=96&height=96` : '',
    contentUrl: (imageId || matched?.id) ? `/api/images/${encodeURIComponent(imageId || matched.id)}/content` : '',
  };
}

function getImageKey(image) {
  return image?.id ? `id:${image.id}` : `filename:${image?.filename || ''}`;
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
    const target = candidates.find((bucket) => !(bucket.overlays || []).some((assigned) => getImageKey(assigned) === overlayKey));
    if (!target) return;
    assignments.push({ overlayImage: overlay, baseImage: target.image });
  });

  return assignments;
}

function buildOverlayBuckets({ parts, images }) {
  const imageIndexes = buildImageIndexes(images);
  const overlayKeys = new Set();
  const assignedBaseKeys = new Set();
  const baseBuckets = [];

  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
    const seenBaseKeys = new Set();
    const bases = sourceImages
      .filter((record) => record && !record.overlay && record.filename)
      .map((record) => {
        const image = makeImageRef(record, imageIndexes);
        if (!image?.id && !imageIndexes.byFilename.has(record.filename)) return null;
        const imageKey = getImageKey(image);
        if (seenBaseKeys.has(imageKey)) return null;
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
    const bucketsByFilename = new Map(bases.map((bucket) => [bucket.image.filename, bucket]));
    sourceImages
      .filter((record) => record && record.overlay && record.filename)
      .forEach((record) => {
        const overlayRef = makeImageRef(record, imageIndexes);
        if (!overlayRef?.id && !imageIndexes.byFilename.has(record.filename)) return;
        overlayKeys.add(getImageKey(overlayRef));
        const baseImageId = String(record.overlay_base_image_id || '').trim();
        const baseFilename = String(record.overlay_base_filename || '').trim();
        const fallbackSide = String(record.side || '').trim().toLowerCase();
        let target = baseImageId ? bucketsByImageId.get(baseImageId) : null;
        if (!target) target = baseFilename ? bucketsByFilename.get(baseFilename) : null;
        if (!target && fallbackSide) {
          target = bases.find((bucket) => String(bucket.image.side || '').toLowerCase() === fallbackSide) || null;
        }
        if (!target && bases.length === 1) target = bases[0];
        if (target && !target.overlays.some((assigned) => getImageKey(assigned) === getImageKey(overlayRef))) {
          target.overlays.push(overlayRef);
        }
      });
    baseBuckets.push(...bases);
  });

  const unassignedOverlays = imageIndexes.refs
    .filter((image) => !overlayKeys.has(getImageKey(image)) && !assignedBaseKeys.has(getImageKey(image)))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  baseBuckets.sort((left, right) => left.image.displayName.localeCompare(right.image.displayName));
  baseBuckets.forEach((bucket) => bucket.overlays.sort((left, right) => left.displayName.localeCompare(right.displayName)));
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
      const response = await fetch(`/api/projects/${projectId}/parts/overlay-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overlay_filename: overlayImage.filename,
          overlay_image_id: overlayImage.id || null,
          base_filename: baseImage?.filename || null,
          base_image_id: baseImage?.id || null,
        }),
      });
      if (!response.ok) throw new Error(`Failed to move overlay (${response.status})`);
      setLocalBuckets((previous) => {
        const moved = previous.unassignedOverlays.find((image) => getImageKey(image) === overlayKey)
          || previous.baseBuckets.flatMap((bucket) => bucket.overlays).find((image) => getImageKey(image) === overlayKey)
          || overlayImage;
        return {
          unassignedOverlays: baseImage ? previous.unassignedOverlays.filter((image) => getImageKey(image) !== overlayKey) : [...previous.unassignedOverlays.filter((image) => getImageKey(image) !== overlayKey), moved].sort((a, b) => a.displayName.localeCompare(b.displayName)),
          baseBuckets: previous.baseBuckets.map((bucket) => ({
            ...bucket,
            overlays: [
              ...bucket.overlays.filter((image) => getImageKey(image) !== overlayKey),
              ...(baseImage && getImageKey(bucket.image) === baseKey ? [moved] : []),
            ].sort((a, b) => a.displayName.localeCompare(b.displayName)),
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
