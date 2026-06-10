import React, { useMemo, useState } from 'react';

function buildImageLookup(images) {
  return (Array.isArray(images) ? images : []).reduce((lookup, image) => {
    if (image?.filename && !image?.deleted_at) lookup.set(image.filename, image);
    return lookup;
  }, new Map());
}

function makeImageRef(filename, imageLookup, sourceRecord = {}) {
  const image = imageLookup.get(filename) || {};
  const imageId = sourceRecord?.image_id || image.id || '';
  return {
    filename,
    id: imageId ? String(imageId) : '',
    thumbnailUrl: imageId ? `/api/images/${encodeURIComponent(String(imageId))}/thumbnail?width=96&height=96` : '',
    contentUrl: imageId ? `/api/images/${encodeURIComponent(String(imageId))}/content` : '',
  };
}

function buildOverlayBuckets({ parts, images }) {
  const imageLookup = buildImageLookup(images);
  const overlayFilenames = new Set();
  const baseBuckets = [];

  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
    const bases = sourceImages
      .filter((record) => record && !record.overlay && record.filename && imageLookup.has(record.filename))
      .map((record) => ({
        partId: part.id,
        partName: part.display_name || part.serial_number || 'Unassigned part',
        image: { ...makeImageRef(record.filename, imageLookup, record), side: record.side || '' },
        overlays: [],
      }));
    const bucketsByFilename = new Map(bases.map((bucket) => [bucket.image.filename, bucket]));
    sourceImages
      .filter((record) => record && record.overlay && record.filename && imageLookup.has(record.filename))
      .forEach((record) => {
        overlayFilenames.add(record.filename);
        const baseFilename = String(record.overlay_base_filename || '').trim();
        const fallbackSide = String(record.side || '').trim().toLowerCase();
        let target = baseFilename ? bucketsByFilename.get(baseFilename) : null;
        if (!target && fallbackSide) {
          target = bases.find((bucket) => String(bucket.image.side || '').toLowerCase() === fallbackSide) || null;
        }
        if (!target && bases.length === 1) target = bases[0];
        if (target) target.overlays.push(makeImageRef(record.filename, imageLookup, record));
      });
    baseBuckets.push(...bases);
  });

  const assignedBaseFilenames = new Set(baseBuckets.map((bucket) => bucket.image.filename));
  const unassignedOverlays = (Array.isArray(images) ? images : [])
    .filter((image) => image?.filename && !image?.deleted_at)
    .filter((image) => !overlayFilenames.has(image.filename) && !assignedBaseFilenames.has(image.filename))
    .sort((left, right) => left.filename.localeCompare(right.filename))
    .map((image) => makeImageRef(image.filename, imageLookup));

  baseBuckets.sort((left, right) => left.image.filename.localeCompare(right.image.filename));
  baseBuckets.forEach((bucket) => bucket.overlays.sort((left, right) => left.filename.localeCompare(right.filename)));
  return { baseBuckets, unassignedOverlays };
}

function OverlaysTab({ projectId, parts = [], images = [], onAssignmentsChanged, setError }) {
  const initialBuckets = useMemo(() => buildOverlayBuckets({ parts, images }), [parts, images]);
  const [localBuckets, setLocalBuckets] = useState(initialBuckets);
  const [movingFilename, setMovingFilename] = useState('');

  React.useEffect(() => {
    setLocalBuckets(initialBuckets);
  }, [initialBuckets]);

  const assignOverlay = async (overlayFilename, baseFilename) => {
    if (!overlayFilename) return;
    try {
      const response = await fetch(`/api/projects/${projectId}/parts/overlay-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overlay_filename: overlayFilename, base_filename: baseFilename || null }),
      });
      if (!response.ok) throw new Error(`Failed to move overlay (${response.status})`);
      setLocalBuckets((previous) => {
        const moved = previous.unassignedOverlays.find((image) => image.filename === overlayFilename)
          || previous.baseBuckets.flatMap((bucket) => bucket.overlays).find((image) => image.filename === overlayFilename)
          || { filename: overlayFilename };
        return {
          unassignedOverlays: baseFilename ? previous.unassignedOverlays.filter((image) => image.filename !== overlayFilename) : [...previous.unassignedOverlays.filter((image) => image.filename !== overlayFilename), moved].sort((a, b) => a.filename.localeCompare(b.filename)),
          baseBuckets: previous.baseBuckets.map((bucket) => ({
            ...bucket,
            overlays: [
              ...bucket.overlays.filter((image) => image.filename !== overlayFilename),
              ...(baseFilename && bucket.image.filename === baseFilename ? [moved] : []),
            ].sort((a, b) => a.filename.localeCompare(b.filename)),
          })),
        };
      });
      setMovingFilename('');
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to move overlay');
    }
  };

  const renderChip = (image, assigned = false) => (
    <button
      key={image.filename}
      type="button"
      className="image-part-chip overlay-image-chip"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', image.filename);
        setMovingFilename(image.filename);
      }}
      aria-label={image.filename}
    >
      {image.thumbnailUrl ? <img src={image.thumbnailUrl} alt="" className="image-part-chip-thumbnail" loading="lazy" /> : null}
      <span>{image.filename}</span>
      {assigned ? <small>overlay</small> : null}
    </button>
  );

  const dropToBase = (baseFilename) => {
    if (movingFilename) assignOverlay(movingFilename, baseFilename);
  };

  return (
    <div className="project-data-tab-panel" role="tabpanel" aria-label="Overlays">
      <section className="workbench-panel images-to-parts-panel overlays-panel">
        <header className="workbench-header">
          <div>
            <h2>Overlays</h2>
            <p>Drag loaded images onto base images to map them as overlays. Multiple overlays can be assigned to each base image.</p>
          </div>
        </header>
        <div className="images-to-parts-grid overlays-grid">
          <div className="images-to-parts-column" onDragOver={(event) => event.preventDefault()} onDrop={() => assignOverlay(movingFilename, null)} data-testid="overlays-unassigned-target">
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
              <article key={`${bucket.partId}-${bucket.image.filename}`} className="images-to-parts-part-card overlay-assignment-card" onDragOver={(event) => event.preventDefault()} onDrop={() => dropToBase(bucket.image.filename)} data-testid={`overlay-target-${bucket.image.filename}`}>
                <div className="overlay-base-column">
                  <h3>{bucket.image.filename}</h3>
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
export { buildOverlayBuckets };
