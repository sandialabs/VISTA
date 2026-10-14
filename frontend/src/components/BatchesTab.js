import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  assignPartToBatch as assignPartToBatchRequest,
  createProjectBatch,
  deleteProjectBatch,
  fetchProjectBatches,
  updateProjectBatch,
} from '../api/batches';

const BATCH_STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'complete', label: 'Complete' },
];

function normalizeBatches(batches = []) {
  return (Array.isArray(batches) ? batches : []).map((batch) => ({
    ...batch,
    name: String(batch?.name || ''),
    owner: String(batch?.owner || ''),
    status: String(batch?.status || 'not_started'),
  }));
}

function summaryForParts(parts = []) {
  return parts.reduce((acc, part) => {
    acc.total += 1;
    if (part.review_state === 'pass') acc.accepted += 1;
    if (part.review_state === 'reject_pending' || part.review_state === 'reject_confirmed') acc.rejected += 1;
    if (part?.metadata?.manual_flagged === true) acc.manual += 1;
    return acc;
  }, { total: 0, accepted: 0, rejected: 0, manual: 0 });
}

function BatchesTab({ projectId, parts = [], onAssignmentsChanged, setError, onInspectBatch }) {
  const [batches, setBatches] = useState([]);
  const [movingPartId, setMovingPartId] = useState('');
  const [selectedPartIds, setSelectedPartIds] = useState([]);
  const [lastSelectedPartId, setLastSelectedPartId] = useState('');
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionRect, setSelectionRect] = useState(null);
  const [hasDraggedSelection, setHasDraggedSelection] = useState(false);
  const [deletedBatchIds, setDeletedBatchIds] = useState([]);
  const partsPaneRef = useRef(null);
  const movingPartIdRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await fetchProjectBatches(projectId);
        if (!cancelled) {
          setBatches(normalizeBatches(payload));
          setDeletedBatchIds([]);
        }
      } catch (err) {
        if (!cancelled && setError) setError(err.message || 'Failed to load batches');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, setError]);

  const getVisiblePartIds = () => {
    if (!partsPaneRef.current) return [];
    return Array.from(partsPaneRef.current.querySelectorAll('.batch-part-chip[data-part-id]'))
      .map((chip) => chip.getAttribute('data-part-id'))
      .filter(Boolean);
  };

  const commitSelectedPartIds = (nextIds, anchorId = '') => {
    const uniqueIds = Array.from(new Set((nextIds || []).filter(Boolean)));
    setSelectedPartIds(uniqueIds);
    if (anchorId) setLastSelectedPartId(anchorId);
  };

  const selectPartFromClick = (partId, event) => {
    if (!partId) return;
    if (event.shiftKey) {
      const visibleIds = getVisiblePartIds();
      const currentIndex = visibleIds.indexOf(partId);
      const anchorIndex = visibleIds.indexOf(lastSelectedPartId);
      if (currentIndex !== -1 && anchorIndex !== -1) {
        const [start, end] = [Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex)];
        const rangeIds = visibleIds.slice(start, end + 1);
        commitSelectedPartIds(event.ctrlKey || event.metaKey ? [...selectedPartIds, ...rangeIds] : rangeIds, partId);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      commitSelectedPartIds(
        selectedPartIds.includes(partId)
          ? selectedPartIds.filter((id) => id !== partId)
          : [...selectedPartIds, partId],
        partId,
      );
      return;
    }
    commitSelectedPartIds([partId], partId);
  };

  const partsByBatch = useMemo(() => {
    const grouped = new Map();
    grouped.set('__unbatched__', []);
    parts.forEach((part) => {
      const key = part?.batch_id && !deletedBatchIds.includes(part.batch_id) ? part.batch_id : '__unbatched__';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(part);
    });
    grouped.forEach((entries) => entries.sort((a, b) => String(a.display_name || a.serial_number || '').localeCompare(String(b.display_name || b.serial_number || ''))));
    return grouped;
  }, [deletedBatchIds, parts]);

  const currentPartsById = useMemo(() => new Map(
    parts
      .filter((part) => part?.id !== undefined && part?.id !== null)
      .map((part) => [String(part.id), part.id]),
  ), [parts]);

  const updateBatch = async (batchId, patch) => {
    try {
      const updated = await updateProjectBatch(projectId, batchId, patch);
      setBatches((prev) => prev.map((batch) => (batch.id === batchId ? normalizeBatches([updated])[0] : batch)));
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to update batch');
    }
  };

  const assignPartToBatch = async (partId, toBatchId) => {
    const currentPartId = currentPartsById.get(String(partId));
    if (currentPartId === undefined) return;

    const selectedCurrentPartIds = Array.from(new Set(
      selectedPartIds
        .map((selectedPartId) => currentPartsById.get(String(selectedPartId)))
        .filter((selectedPartId) => selectedPartId !== undefined),
    ));
    const draggedPartIsSelected = selectedCurrentPartIds.some(
      (selectedPartId) => String(selectedPartId) === String(currentPartId),
    );
    const partIds = draggedPartIsSelected ? selectedCurrentPartIds : [currentPartId];
    try {
      for (const selectedPartId of partIds) {
        await assignPartToBatchRequest(projectId, selectedPartId, toBatchId);
      }
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to assign batch for part');
    } finally {
      movingPartIdRef.current = '';
      setMovingPartId('');
    }
  };

  const draggedPartId = (event) => (
    event?.dataTransfer?.getData('application/x-vista-part-id')
    || event?.dataTransfer?.getData('text/plain')
    || movingPartIdRef.current
    || movingPartId
  );

  const createBatch = async () => {
    const nextNumber = batches.length + 1;
    const payload = await createProjectBatch(projectId, { name: `Batch ${nextNumber}` });
    setBatches((prev) => [...prev, normalizeBatches([payload])[0]]);
    return payload;
  };

  const deleteBatch = async (batch) => {
    if (!batch?.id) return;
    const batchParts = partsByBatch.get(batch.id) || [];
    const confirmed = window.confirm(
      `Delete ${batch.name || 'this batch'}? ${batchParts.length} part${batchParts.length === 1 ? '' : 's'} assigned to this batch will move to Unbatched Parts.`,
    );
    if (!confirmed) return;
    try {
      await deleteProjectBatch(projectId, batch.id);
      setBatches((prev) => prev.filter((item) => item.id !== batch.id));
      setDeletedBatchIds((prev) => (prev.includes(batch.id) ? prev : [...prev, batch.id]));
      setSelectedPartIds((prev) => prev.filter((partId) => !(batchParts.some((part) => part.id === partId))));
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to delete batch');
    }
  };

  const renderPartChip = (part) => (
    <div
      key={part.id}
      className={`image-part-chip batch-part-chip ${selectedPartIds.includes(part.id) ? 'selected' : ''}`}
      draggable
      data-part-id={part.id}
      onClick={(event) => {
        if (hasDraggedSelection) {
          event.preventDefault();
          return;
        }
        selectPartFromClick(part.id, event);
      }}
      onDragStart={(event) => {
        movingPartIdRef.current = part.id;
        setMovingPartId(part.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-vista-part-id', part.id);
          event.dataTransfer.setData('text/plain', part.id);
        }
        if (!selectedPartIds.includes(part.id)) commitSelectedPartIds([part.id], part.id);
      }}
      onDragEnd={() => {
        movingPartIdRef.current = '';
        setMovingPartId('');
      }}
    >
      <div className="batch-part-chip-header">{part.display_name || part.serial_number}</div>

    </div>
  );

  return (
    <div className="project-data-tab-panel" role="tabpanel" aria-label="Batches">
      <section className="workbench-panel">
        <header className="workbench-header">
          <div>
            <h2>Batches</h2>
            <p>Drag parts between batches to override filename-based grouping and assign unbatched parts.</p>
          </div>
        </header>

        <div
          className="images-to-parts-grid batches-grid"
          ref={partsPaneRef}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            // Native chip dragging owns pointer movement that starts on a chip;
            // starting the marquee too causes drag/drop to be cancelled or to
            // collide with selection state updates in some browsers.
            if (event.target.closest('.batch-part-chip, input, select, button, textarea')) return;
            setHasDraggedSelection(false);
            setSelectionStart({ x: event.clientX, y: event.clientY });
            setSelectionRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
          }}
          onMouseMove={(event) => {
            if (!selectionStart) return;
            const x = Math.min(selectionStart.x, event.clientX);
            const y = Math.min(selectionStart.y, event.clientY);
            const width = Math.abs(event.clientX - selectionStart.x);
            const height = Math.abs(event.clientY - selectionStart.y);
            setSelectionRect({ x, y, width, height });
            if (width > 4 || height > 4) setHasDraggedSelection(true);
          }}
          onMouseLeave={() => {
            if (!selectionStart) return;
            setSelectionStart(null);
            setSelectionRect(null);
            setHasDraggedSelection(false);
          }}
          onMouseUp={(event) => {
            if (!selectionRect || !partsPaneRef.current) { setSelectionStart(null); return; }
            const isMarquee = hasDraggedSelection || selectionRect.width > 4 || selectionRect.height > 4;
            if (isMarquee) {
              const chips = Array.from(partsPaneRef.current.querySelectorAll('.batch-part-chip[data-part-id]'));
              const selected = chips.filter((chip) => {
                const rect = chip.getBoundingClientRect();
                return rect.left < selectionRect.x + selectionRect.width
                  && rect.right > selectionRect.x
                  && rect.top < selectionRect.y + selectionRect.height
                  && rect.bottom > selectionRect.y;
              }).map((chip) => chip.getAttribute('data-part-id'));
              commitSelectedPartIds(event.ctrlKey || event.metaKey ? [...selectedPartIds, ...selected] : selected, selected[selected.length - 1] || lastSelectedPartId);
            }
            setSelectionStart(null);
            setSelectionRect(null);
          }}
        >
          {selectionRect && hasDraggedSelection ? (
            <div
              className="batch-selection-marquee"
              data-testid="batch-selection-marquee"
              style={{
                left: selectionRect.x,
                top: selectionRect.y,
                width: selectionRect.width,
                height: selectionRect.height,
              }}
            />
          ) : null}
          <div
            className="images-to-parts-column assignment-source-column sticky-assignment-column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => assignPartToBatch(draggedPartId(event), null)}
            data-testid="batch-target-unbatched"
          >
            <h3>Unbatched Parts</h3>
            <div className="image-part-chip-list">
              {(partsByBatch.get('__unbatched__') || []).length === 0
                ? <p className="muted">No unbatched parts.</p>
                : (partsByBatch.get('__unbatched__') || []).map(renderPartChip)}
            </div>
          </div>

          <div className="images-to-parts-column parts-column">
            <article className="images-to-parts-part-card batch-card" data-testid="batch-target-new" onDragOver={(event) => event.preventDefault()} onDrop={async (event) => { try { const partId = draggedPartId(event); if (!partId) return; const created = await createBatch(); await assignPartToBatch(partId, created.id); } catch (err) { if (setError) setError(err.message); } }}><div className="batch-card-header"><h3>New Batch</h3></div><p className="muted">Drag part(s) here to create a new batch.</p></article>
            {batches.map((batch) => {
              const batchParts = partsByBatch.get(batch.id) || [];
              const summary = summaryForParts(batchParts);
              return (
                <article
                  key={batch.id}
                  className="images-to-parts-part-card batch-card"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => assignPartToBatch(draggedPartId(event), batch.id)}
                  data-testid={`batch-target-${batch.id}`}
                >
                  <div className="batch-card-header">
                    <input
                      className="form-control"
                      aria-label={`Batch name ${batch.name}`}
                      value={batch.name}
                      onChange={(event) => {
                        const value = event.target.value;
                        setBatches((prev) => prev.map((item) => (item.id === batch.id ? { ...item, name: value } : item)));
                      }}
                      onBlur={() => updateBatch(batch.id, { name: batch.name })}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onInspectBatch && onInspectBatch(batch)}
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      className="batch-delete-button"
                      onClick={() => deleteBatch(batch)}
                      aria-label={`Delete batch ${batch.name || 'unnamed'}`}
                      title="Delete batch"
                    >
                      ×
                    </button>
                  </div>
                  <div className="batch-summary muted">
                    Parts: {summary.total} • Accepted: {summary.accepted} • Rejected: {summary.rejected} • Manual: {summary.manual}
                  </div>
                  <div className="batch-card-controls">
                    <label className="form-label">
                      Owner
                      <input
                        className="form-control"
                        value={batch.owner || ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          setBatches((prev) => prev.map((item) => (item.id === batch.id ? { ...item, owner: value } : item)));
                        }}
                        onBlur={() => updateBatch(batch.id, { owner: batch.owner || null })}
                      />
                    </label>
                    <label className="form-label">
                      Status
                      <select
                        className="form-control"
                        value={batch.status || 'not_started'}
                        onChange={(event) => {
                          const value = event.target.value;
                          setBatches((prev) => prev.map((item) => (item.id === batch.id ? { ...item, status: value } : item)));
                          updateBatch(batch.id, { status: value });
                        }}
                      >
                        {BATCH_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="image-part-chip-list">
                    {batchParts.length === 0 ? <p className="muted">No parts assigned.</p> : batchParts.map(renderPartChip)}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

export default BatchesTab;
