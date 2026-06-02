import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionRect, setSelectionRect] = useState(null);
  const [deletedBatchIds, setDeletedBatchIds] = useState([]);
  const partsPaneRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const resp = await fetch(`/api/projects/${projectId}/batches`);
        if (!resp.ok) throw new Error(`Failed to load batches (${resp.status})`);
        const payload = await resp.json();
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

  const updateBatch = async (batchId, patch) => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/batches/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(`Failed to update batch (${resp.status})`);
      const updated = await resp.json();
      setBatches((prev) => prev.map((batch) => (batch.id === batchId ? normalizeBatches([updated])[0] : batch)));
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to update batch');
    }
  };

  const assignPartToBatch = async (partId, toBatchId) => {
    const partIds = selectedPartIds.includes(partId) ? selectedPartIds : [partId];
    if (!partIds.length || !partIds[0]) return;
    try {
      for (const selectedPartId of partIds) {
        const resp = await fetch(`/api/projects/${projectId}/parts/batch-assignments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ part_id: selectedPartId, to_batch_id: toBatchId || null }),
        });
        if (!resp.ok) throw new Error(`Failed to assign part (${resp.status})`);
      }
      if (onAssignmentsChanged) await onAssignmentsChanged();
      if (setError) setError(null);
    } catch (err) {
      if (setError) setError(err.message || 'Failed to assign batch for part');
    } finally {
      setMovingPartId('');
    }
  };

  const createBatch = async () => {
    const nextNumber = batches.length + 1;
    const resp = await fetch(`/api/projects/${projectId}/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Batch ${nextNumber}` }),
    });
    if (!resp.ok) throw new Error(`Failed to create batch (${resp.status})`);
    const payload = await resp.json();
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
      const resp = await fetch(`/api/projects/${projectId}/batches/${batch.id}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`Failed to delete batch (${resp.status})`);
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
        if (event.ctrlKey || event.metaKey) {
          setSelectedPartIds((prev) => (prev.includes(part.id) ? prev.filter((id) => id !== part.id) : [...prev, part.id]));
          return;
        }
        setSelectedPartIds([part.id]);
      }}
      onDragStart={() => { setMovingPartId(part.id); if (!selectedPartIds.includes(part.id)) setSelectedPartIds([part.id]); }}
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

        <div className="images-to-parts-grid batches-grid">
          <div
            className="images-to-parts-column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => assignPartToBatch(movingPartId, null)}
            data-testid="batch-target-unbatched"
          >
            <h3>Unbatched Parts</h3>
            <div className="image-part-chip-list">
              {(partsByBatch.get('__unbatched__') || []).length === 0
                ? <p className="muted">No unbatched parts.</p>
                : (partsByBatch.get('__unbatched__') || []).map(renderPartChip)}
            </div>
          </div>

          <div className="images-to-parts-column parts-column" ref={partsPaneRef} onMouseDown={(event) => {
            if (event.target.closest('.batch-part-chip')) return;
            setSelectionStart({ x: event.clientX, y: event.clientY });
            setSelectionRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
          }} onMouseMove={(event) => {
            if (!selectionStart) return;
            const x = Math.min(selectionStart.x, event.clientX);
            const y = Math.min(selectionStart.y, event.clientY);
            const width = Math.abs(event.clientX - selectionStart.x);
            const height = Math.abs(event.clientY - selectionStart.y);
            setSelectionRect({ x, y, width, height });
          }} onMouseUp={() => {
            if (!selectionRect || !partsPaneRef.current) { setSelectionStart(null); return; }
            const chips = Array.from(partsPaneRef.current.querySelectorAll('.batch-part-chip[data-part-id]'));
            const selected = chips.filter((chip) => {
              const rect = chip.getBoundingClientRect();
              return rect.left < selectionRect.x + selectionRect.width && rect.right > selectionRect.x && rect.top < selectionRect.y + selectionRect.height && rect.bottom > selectionRect.y;
            }).map((chip) => chip.getAttribute('data-part-id'));
            setSelectedPartIds(selected);
            setSelectionStart(null);
            setSelectionRect(null);
          }}>
            <article className="images-to-parts-part-card batch-card" onDragOver={(event) => event.preventDefault()} onDrop={async () => { try { const created = await createBatch(); await assignPartToBatch(movingPartId, created.id); } catch (err) { if (setError) setError(err.message); } }}><div className="batch-card-header"><h3>New Batch</h3></div><p className="muted">Drag part(s) here to create a new batch.</p></article>
            {batches.map((batch) => {
              const batchParts = partsByBatch.get(batch.id) || [];
              const summary = summaryForParts(batchParts);
              return (
                <article
                  key={batch.id}
                  className="images-to-parts-part-card batch-card"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => assignPartToBatch(movingPartId, batch.id)}
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
