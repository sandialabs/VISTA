import React, { useMemo, useRef, useState } from 'react';

function buildImageLookup(images) {
  return (Array.isArray(images) ? images : []).reduce((lookup, image) => {
    const filename = typeof image?.filename === 'string' ? image.filename : '';
    if (filename && !image?.deleted_at) lookup.set(filename, image);
    return lookup;
  }, new Map());
}

function buildImageRef(filename, imageLookup, sourceRecord = null) {
  const lookupRecord = imageLookup.get(filename) || {};
  const imageId = sourceRecord?.image_id || lookupRecord.id || null;
  return {
    id: imageId ? String(imageId) : '',
    filename,
    contentUrl: imageId ? `/api/images/${encodeURIComponent(String(imageId))}/content` : '',
    thumbnailUrl: imageId ? `/api/images/${encodeURIComponent(String(imageId))}/thumbnail?width=96&height=96` : '',
  };
}

function buildBuckets({ parts, images }) {
  const imageLookup = buildImageLookup(images);
  const filenameToPartId = new Map();
  const partBuckets = (Array.isArray(parts) ? parts : []).map((part) => {
    const sourceImages = Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : [];
    const filenames = sourceImages
      .map((record) => (typeof record?.filename === 'string' ? record.filename : ''))
      .filter((filename) => filename && imageLookup.has(filename));
    filenames.forEach((filename) => filenameToPartId.set(filename, part.id));
    return {
      id: part.id,
      serialNumber: part.serial_number,
      displayName: part.display_name || part.serial_number,
      images: sourceImages
        .map((record) => (typeof record?.filename === 'string' && imageLookup.has(record.filename) ? buildImageRef(record.filename, imageLookup, record) : null))
        .filter(Boolean),
    };
  });

  const unassigned = (Array.isArray(images) ? images : [])
    .filter((image) => !image?.deleted_at)
    .map((image) => (typeof image?.filename === 'string' ? image.filename : ''))
    .filter(Boolean)
    .filter((filename) => !filenameToPartId.has(filename))
    .sort((left, right) => left.localeCompare(right))
    .map((filename) => buildImageRef(filename, imageLookup));

  return { partBuckets, unassigned };
}

function ImagesToPartsTab({ projectId, parts = [], images = [], onAssignmentsChanged, setError }) {
  const initialBuckets = useMemo(() => buildBuckets({ parts, images }), [parts, images]);
  const [localBuckets, setLocalBuckets] = useState(initialBuckets);
  const [movingFilenames, setMovingFilenames] = useState([]);
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

  const findImageRef = (filename) => {
    const allImages = [
      ...localBuckets.unassigned,
      ...localBuckets.partBuckets.flatMap((part) => part.images),
    ];
    return allImages.find((image) => image.filename === filename) || { filename };
  };

  const openImageModal = (imageRef) => {
    setActiveImageModal({ title: imageRef.filename, images: [imageRef], mode: 'single' });
  };

  const openPartModal = (part) => {
    setActiveImageModal({ title: part.displayName, subtitle: `Serial: ${part.serialNumber || 'Unspecified'}`, images: part.images, mode: 'part' });
  };

  const handleCreatePart = async () => {
    const serialNumberInput = window.prompt('Enter a serial number for the new part:');
    const serialNumber = typeof serialNumberInput === 'string' ? serialNumberInput.trim() : '';
    if (!serialNumber) return;
    const displayNameInput = window.prompt('Enter a display name for the new part (optional):', serialNumber);
    const displayName = typeof displayNameInput === 'string' ? displayNameInput.trim() : '';
    try {
      const response = await fetch(`/api/projects/${projectId}/parts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial_number: serialNumber, display_name: displayName || undefined }),
      });
      if (!response.ok) throw new Error(`Failed to create part (${response.status})`);
      let createdPart = null;
      try {
        createdPart = await response.json();
      } catch {
        createdPart = null;
      }
      const createdPartId = createdPart?.id ? String(createdPart.id) : `new-${Date.now()}`;
      const createdSerialNumber = createdPart?.serial_number || serialNumber;
      const createdDisplayName = createdPart?.display_name || displayName || createdSerialNumber;
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

  const assignFilenamesToPart = async (filenames, toPartId) => {
    if (!filenames.length) return;
    try {
      for (const filename of filenames) {
        const response = await fetch(`/api/projects/${projectId}/parts/image-assignments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, to_part_id: toPartId || null }),
        });
        if (!response.ok) throw new Error(`Failed to move image (${response.status})`);
      }
      const movedSet = new Set(filenames);
      const movedImages = filenames.map(findImageRef);
      const nextBuckets = {
        partBuckets: localBuckets.partBuckets.map((part) => {
          const withoutMoved = part.images.filter((image) => !movedSet.has(image.filename));
          if (part.id !== toPartId) return { ...part, images: withoutMoved };
          return {
            ...part,
            images: [...withoutMoved, ...movedImages.filter((img) => !withoutMoved.some((existing) => existing.filename === img.filename))]
              .sort((left, right) => left.filename.localeCompare(right.filename)),
          };
        }),
        unassigned: toPartId
          ? localBuckets.unassigned.filter((image) => !movedSet.has(image.filename))
          : [...localBuckets.unassigned, ...movedImages.filter((img) => !localBuckets.unassigned.some((existing) => existing.filename === img.filename))]
            .sort((left, right) => left.filename.localeCompare(right.filename)),
      };
      setLocalBuckets(nextBuckets);
      setSelectedUnassigned((prev) => prev.filter((name) => !movedSet.has(name)));
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to assign image(s) to part');
    } finally {
      setMovingFilenames([]);
    }
  };

  const handleDropToPart = async (toPartId) => {
    await assignFilenamesToPart(movingFilenames, toPartId);
  };

  const handleDropToUnassigned = async () => {
    await assignFilenamesToPart(movingFilenames, null);
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
          .filter((image, index, all) => all.findIndex((candidate) => candidate.filename === image.filename) === index)
          .sort((left, right) => left.filename.localeCompare(right.filename)),
      }));
      setSelectedUnassigned([]);
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to delete part');
    }
  };

  const handleChipDragStart = (filename) => {
    if (selectedUnassigned.includes(filename)) setMovingFilenames(selectedUnassigned);
    else setMovingFilenames([filename]);
  };

  const toggleUnassignedSelection = (filename) => {
    setSelectedUnassigned((prev) => (prev.includes(filename) ? prev.filter((item) => item !== filename) : [...prev, filename]));
  };

  const updateSelectionFromRect = (rect) => {
    if (!unassignedRef.current) return;
    const chips = Array.from(unassignedRef.current.querySelectorAll('[data-image-filename]'));
    const selected = chips
      .filter((node) => {
        const bounds = node.getBoundingClientRect();
        return !(bounds.right < rect.left || bounds.left > rect.right || bounds.bottom < rect.top || bounds.top > rect.bottom);
      })
      .map((node) => node.getAttribute('data-image-filename'))
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
      key={imageRef.filename}
      type="button"
      className={`image-part-chip ${isUnassigned && selectedUnassigned.includes(imageRef.filename) ? 'selected' : ''}`}
      draggable
      data-image-filename={imageRef.filename}
      onClick={() => (isUnassigned ? toggleUnassignedSelection(imageRef.filename) : openImageModal(imageRef))}
      onDoubleClick={() => openImageModal(imageRef)}
      onDragStart={() => handleChipDragStart(imageRef.filename)}
      title={imageRef.id ? `Open ${imageRef.filename}` : `${imageRef.filename} has no image record`}
    >
      {showThumbnails && imageRef.thumbnailUrl ? <img src={imageRef.thumbnailUrl} alt="" className="image-part-chip-thumbnail" loading="lazy" /> : null}
      <span>{imageRef.filename}</span>
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
          <div className="images-to-parts-column" onDragOver={(event) => event.preventDefault()} onDrop={handleDropToUnassigned} data-testid="images-to-parts-unassigned-target">
            <div className="unassigned-header-row"><h3>Unassigned</h3><div className="unassigned-actions"><button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedUnassigned(localBuckets.unassigned.map((img) => img.filename))}>All</button><button type="button" className="btn-secondary btn-sm" onClick={() => setShowSomeModal(true)}>Some</button><button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedUnassigned([])}>None</button></div></div>
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
                <p className="muted">Serial: {part.serialNumber}</p>
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
            <div className="modal-body">{activeImageModal.images.length === 0 ? <p className="muted">No mapped images for this part.</p> : <div className={activeImageModal.mode === 'single' ? 'image-part-single-view' : 'image-part-tile-grid'}>{activeImageModal.images.map((imageRef) => (<figure className="image-part-viewer-tile" key={imageRef.filename}>{imageRef.contentUrl ? <img src={imageRef.contentUrl} alt={imageRef.filename} loading="lazy" onError={(event) => { if (imageRef.thumbnailUrl && event.currentTarget.src !== imageRef.thumbnailUrl) event.currentTarget.src = imageRef.thumbnailUrl; }} /> : <div className="image-part-missing-preview">Image unavailable</div>}<figcaption>{imageRef.filename}</figcaption></figure>))}</div>}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImagesToPartsTab;
