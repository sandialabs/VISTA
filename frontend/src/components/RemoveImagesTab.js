import React, { useMemo, useState } from 'react';

function buildHierarchy(parts = [], images = []) {
  const activeImages = images.filter((image) => !image?.deleted_at);
  const imageByFilename = new Map(activeImages.map((image) => [image.filename, image]));
  const assignedFilenames = new Set();

  const partBuckets = parts.map((part) => {
    const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
    const bucketImages = sourceImages
      .map((source) => {
        const filename = source?.filename;
        if (!filename) return null;
        const image = imageByFilename.get(filename);
        if (!image) return null;
        assignedFilenames.add(filename);
        return image;
      })
      .filter(Boolean);

    return {
      partId: part.id,
      partLabel: part.display_name || part.serial_number || 'Unnamed part',
      serialNumber: part.serial_number || 'Unspecified',
      images: bucketImages,
    };
  });

  const unassignedImages = activeImages.filter((image) => !assignedFilenames.has(image.filename));
  return { partBuckets, unassignedImages };
}

function RemoveImagesTab({ projectId, parts = [], images = [], onImagesRemoved, setError }) {
  const hierarchy = useMemo(() => buildHierarchy(parts, images), [parts, images]);
  const [selectedImageIds, setSelectedImageIds] = useState(new Set());
  const [filenameFilter, setFilenameFilter] = useState('');
  const [filterScope, setFilterScope] = useState('all');
  const [isRemoving, setIsRemoving] = useState(false);

  const allImages = useMemo(
    () => [...hierarchy.partBuckets.flatMap((bucket) => bucket.images), ...hierarchy.unassignedImages],
    [hierarchy]
  );

  const visibleByFilter = useMemo(() => {
    const lowered = filenameFilter.trim().toLowerCase();
    const matches = (image) => (!lowered ? true : (image.filename || '').toLowerCase().includes(lowered));

    if (filterScope === 'unassigned') return hierarchy.unassignedImages.filter(matches);
    if (filterScope.startsWith('part:')) {
      const partId = filterScope.replace('part:', '');
      const bucket = hierarchy.partBuckets.find((entry) => String(entry.partId) === partId);
      return (bucket?.images || []).filter(matches);
    }
    return allImages.filter(matches);
  }, [allImages, filenameFilter, filterScope, hierarchy]);

  const toggleSelected = (imageId) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  };

  const setSelectionFromVisible = (mode) => {
    setSelectedImageIds((prev) => {
      if (mode === 'none') return new Set();
      if (mode === 'all') return new Set(visibleByFilter.map((image) => image.id));
      const next = new Set(prev);
      visibleByFilter.forEach((image) => next.add(image.id));
      return next;
    });
  };

  const removeSelectedImages = async () => {
    const ids = Array.from(selectedImageIds);
    if (ids.length === 0 || isRemoving) return;
    const confirmed = window.confirm(`Delete ${ids.length} selected image${ids.length === 1 ? '' : 's'}?`);
    if (!confirmed) return;

    setIsRemoving(true);
    try {
      for (const imageId of ids) {
        const response = await fetch(`/api/projects/${projectId}/images/${imageId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Unloaded from Project Data Unload Images tab' }),
        });
        if (!response.ok) throw new Error(`Failed to delete image ${imageId} (${response.status})`);
      }
      setSelectedImageIds(new Set());
      if (setError) setError(null);
      if (onImagesRemoved) await onImagesRemoved();
    } catch (err) {
      if (setError) setError(err.message || 'Failed to unload selected images');
    } finally {
      setIsRemoving(false);
    }
  };

  const renderImageRow = (image) => (
    <label key={image.id} className="remove-images-row">
      <input type="checkbox" checked={selectedImageIds.has(image.id)} onChange={() => toggleSelected(image.id)} />
      <span>{image.filename}</span>
    </label>
  );

  return (
    <div className="project-data-tab-panel" role="tabpanel" aria-label="Unload Images">
      <section className="workbench-panel">
        <header className="workbench-header">
          <div>
            <h2>Unload Images</h2>
            <p>Review image hierarchy by part or unassigned, then unload all or filtered subsets.</p>
          </div>
          <button type="button" className="btn btn-danger" onClick={removeSelectedImages} disabled={selectedImageIds.size === 0 || isRemoving}>
            {isRemoving ? 'Unloading...' : `Unload Selected (${selectedImageIds.size})`}
          </button>
        </header>

        <div className="remove-images-filters">
          <input type="text" placeholder="Filter by filename" value={filenameFilter} onChange={(event) => setFilenameFilter(event.target.value)} />
          <select value={filterScope} onChange={(event) => setFilterScope(event.target.value)}>
            <option value="all">All images</option>
            <option value="unassigned">Unassigned only</option>
            {hierarchy.partBuckets.map((bucket) => (
              <option key={bucket.partId} value={`part:${bucket.partId}`}>{bucket.partLabel}</option>
            ))}
          </select>
          <div className="remove-images-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectionFromVisible('all')}>All visible</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectionFromVisible('some')}>Add visible</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectionFromVisible('none')}>None</button>
          </div>
        </div>

        <div className="remove-images-hierarchy">
          <article className="remove-images-group">
            <h3>Unassigned Images ({hierarchy.unassignedImages.length})</h3>
            {hierarchy.unassignedImages.length === 0 ? <p className="muted">No unassigned images.</p> : hierarchy.unassignedImages.map(renderImageRow)}
          </article>
          {hierarchy.partBuckets.map((bucket) => (
            <article className="remove-images-group" key={bucket.partId}>
              <h3>{bucket.partLabel} <span className="muted">({bucket.serialNumber})</span> - {bucket.images.length}</h3>
              {bucket.images.length === 0 ? <p className="muted">No images assigned to this part.</p> : bucket.images.map(renderImageRow)}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default RemoveImagesTab;
