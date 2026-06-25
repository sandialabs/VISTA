import React, { useMemo, useRef, useState } from 'react';

function tagDuplicateFilename(filename = '', occurrence = 0) {
  const safeFilename = String(filename || 'image').trim() || 'image';
  if (occurrence <= 0) return safeFilename;
  const dotIndex = safeFilename.lastIndexOf('.');
  const suffix = occurrence === 1 ? ' (duplicate)' : ` (duplicate ${occurrence})`;
  if (dotIndex > 0) return `${safeFilename.slice(0, dotIndex)}${suffix}${safeFilename.slice(dotIndex)}`;
  return `${safeFilename}${suffix}`;
}

function buildActiveImageRefs(images) {
  const activeImages = (Array.isArray(images) ? images : []).filter((image) => image?.filename && !image?.deleted_at);
  const filenameCounts = new Map();
  return activeImages.map((image, index) => {
    const filename = String(image.filename || '');
    const occurrence = filenameCounts.get(filename) || 0;
    filenameCounts.set(filename, occurrence + 1);
    const imageId = image?.id ? String(image.id) : '';
    return {
      key: imageId || `filename:${filename}:${index}`,
      id: imageId,
      filename,
      displayName: tagDuplicateFilename(filename, occurrence),
      duplicateOccurrence: occurrence,
      contentUrl: imageId ? `/api/images/${encodeURIComponent(imageId)}/content` : '',
      thumbnailUrl: imageId ? `/api/images/${encodeURIComponent(imageId)}/thumbnail?width=96&height=96` : '',
    };
  });
}

function buildImageIndexes(images) {
  const refs = buildActiveImageRefs(images);
  const byId = new Map();
  const byFilename = new Map();
  refs.forEach((ref) => {
    if (ref.id) byId.set(ref.id, ref);
    if (!byFilename.has(ref.filename)) byFilename.set(ref.filename, []);
    byFilename.get(ref.filename).push(ref);
  });
  return { refs, byId, byFilename };
}

function buildImageRefFromSource(sourceRecord, imageIndexes) {
  const imageId = sourceRecord?.image_id ? String(sourceRecord.image_id) : '';
  const filename = typeof sourceRecord?.filename === 'string' ? sourceRecord.filename : '';
  const matched = (imageId && imageIndexes.byId.get(imageId)) || (filename && (imageIndexes.byFilename.get(filename) || [])[0]) || null;
  if (!matched) return null;
  return { ...matched, filename: filename || matched.filename, id: imageId || matched.id };
}

function getImageAssignmentKey(imageRef) {
  return imageRef?.id ? `id:${imageRef.id}` : `filename:${imageRef?.filename || ''}`;
}

function buildBuckets({ parts, images }) {
  const imageIndexes = buildImageIndexes(images);
  const assignedImageKeys = new Set();
  const assignedLegacyFilenames = new Set();
  const partBuckets = (Array.isArray(parts) ? parts : []).map((part) => {
    const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
    const partImages = sourceImages
      .map((record) => buildImageRefFromSource(record, imageIndexes))
      .filter(Boolean);
    partImages.forEach((image) => assignedImageKeys.add(getImageAssignmentKey(image)));
    sourceImages.forEach((record) => {
      if (!record?.image_id && record?.filename) assignedLegacyFilenames.add(String(record.filename));
    });
    return {
      id: part.id,
      serialNumber: part.serial_number,
      displayName: part.display_name || part.serial_number,
      images: partImages,
    };
  });

  const unassigned = imageIndexes.refs
    .filter((image) => !assignedImageKeys.has(getImageAssignmentKey(image)))
    .filter((image) => !(assignedLegacyFilenames.has(image.filename) && !image.id))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  return { partBuckets, unassigned };
}
function ImagesToPartsTab({ projectId, parts = [], images = [], onAssignmentsChanged, setError }) {
  const initialBuckets = useMemo(() => buildBuckets({ parts, images }), [parts, images]);
  const [localBuckets, setLocalBuckets] = useState(initialBuckets);
  const [movingImages, setMovingImages] = useState([]);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [activeImageModal, setActiveImageModal] = useState(null);
  const [selectedUnassigned, setSelectedUnassigned] = useState([]);
  const [selectionDrag, setSelectionDrag] = useState(null);
  const [showSomeModal, setShowSomeModal] = useState(false);
  const [someFilter, setSomeFilter] = useState('');
  const unassignedRef = useRef(null);

  React.useEffect(() => {
    setLocalBuckets(initialBuckets);
    setSelectedUnassigned([]);
  }, [initialBuckets]);

  React.useEffect(() => {
    if (!activeImageModal) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActiveImageModal(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeImageModal]);

  const findImageRef = (imageKeyOrFilename) => {
    const allImages = [
      ...localBuckets.unassigned,
      ...localBuckets.partBuckets.flatMap((part) => part.images),
    ];
    return allImages.find((image) => image.key === imageKeyOrFilename || image.id === imageKeyOrFilename || image.filename === imageKeyOrFilename) || { filename: imageKeyOrFilename, displayName: imageKeyOrFilename };
  };

  const openImageModal = (imageRef) => {
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
      const response = await fetch(`/api/projects/${projectId}/parts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial_number: partName, display_name: partName }),
      });
      if (!response.ok) throw new Error(`Failed to create part (${response.status})`);
      let createdPart = null;
      try {
        createdPart = await response.json();
      } catch {
        createdPart = null;
      }
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
        const response = await fetch(`/api/projects/${projectId}/parts/image-assignments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: image.filename, image_id: image.id || null, to_part_id: toPartId || null }),
        });
        if (!response.ok) throw new Error(`Failed to move image (${response.status})`);
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
              .sort((left, right) => left.filename.localeCompare(right.filename)),
          };
        }),
        unassigned: toPartId
          ? localBuckets.unassigned.filter((image) => !movedSet.has(image.key || image.id || image.filename))
          : [...localBuckets.unassigned, ...movedImages.filter((img) => !localBuckets.unassigned.some((existing) => (existing.key || existing.id || existing.filename) === (img.key || img.id || img.filename)))]
            .sort((left, right) => left.filename.localeCompare(right.filename)),
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
      const response = await fetch(`/api/projects/${projectId}/parts/${encodeURIComponent(String(part.id))}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Failed to delete part (${response.status})`);
      setLocalBuckets((previous) => ({
        partBuckets: previous.partBuckets.filter((entry) => entry.id !== part.id),
        unassigned: [...previous.unassigned, ...part.images]
          .filter((image, index, all) => all.findIndex((candidate) => (candidate.key || candidate.id || candidate.filename) === (image.key || image.id || image.filename)) === index)
          .sort((left, right) => left.filename.localeCompare(right.filename)),
      }));
      setSelectedUnassigned([]);
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to delete part');
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
