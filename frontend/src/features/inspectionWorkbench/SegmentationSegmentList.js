import { MPR_AXIS_CONFIG } from './mprConstants';

function getAxisSliceUpperBound(axis, volumeDimensions) {
  const axisSize = axis === 'sagittal'
    ? volumeDimensions[0]
    : (axis === 'coronal' ? volumeDimensions[1] : volumeDimensions[2]);
  return Math.max(0, axisSize - 1);
}

function SegmentSliceBoundInput({ segment, field, label, volumeDimensions, onUpdate, onSave }) {
  const id = field === 'minSlice'
    ? `segmentation-segment-min-slice-${segment.id}`
    : `segmentation-segment-max-slice-${segment.id}`;
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        min="0"
        max={getAxisSliceUpperBound(segment.axis, volumeDimensions)}
        value={segment[field]}
        onChange={(event) => onUpdate(segment.id, { [field]: Number(event.target.value) })}
        onBlur={(event) => onSave(segment.id, { [field]: Number(event.target.value) })}
      />
    </label>
  );
}

function SegmentationSegmentEditor({ segment, volumeDimensions, onUpdate, onSave }) {
  return (
    <div className="segmentation-segment-editor">
      <label htmlFor={`segmentation-segment-name-${segment.id}`}>
        Name
        <input
          id={`segmentation-segment-name-${segment.id}`}
          type="text"
          value={segment.name}
          onChange={(event) => onUpdate(segment.id, { name: event.target.value })}
          onBlur={(event) => onSave(segment.id, { name: event.target.value })}
        />
      </label>
      <label htmlFor={`segmentation-segment-color-${segment.id}`}>
        Color
        <input
          id={`segmentation-segment-color-${segment.id}`}
          type="color"
          value={segment.color}
          onChange={(event) => onSave(segment.id, { color: event.target.value })}
        />
      </label>
      <label htmlFor={`segmentation-segment-axis-${segment.id}`}>
        Creation axis
        <input
          id={`segmentation-segment-axis-${segment.id}`}
          type="text"
          value={MPR_AXIS_CONFIG[segment.axis]?.label || segment.axis}
          readOnly
        />
      </label>
      <SegmentSliceBoundInput segment={segment} field="minSlice" label="Min slice" volumeDimensions={volumeDimensions} onUpdate={onUpdate} onSave={onSave} />
      <SegmentSliceBoundInput segment={segment} field="maxSlice" label="Max slice" volumeDimensions={volumeDimensions} onUpdate={onUpdate} onSave={onSave} />
    </div>
  );
}

function SegmentationSegmentRow({ segment, selected, editing, volumeDimensions, onSelect, onUpdate, onSave }) {
  return (
    <li
      className={`segmentation-segment-row ${selected ? 'selected' : ''}`}
      style={{ borderColor: selected ? segment.color : undefined }}
    >
      <button
        type="button"
        className="segmentation-segment-select"
        onClick={() => onSelect(segment, false)}
      >
        <span className="segmentation-segment-color" style={{ backgroundColor: segment.color }} />
        <span>{segment.name}</span>
        <small>{(segment.areas || []).length} areas</small>
      </button>
      <button
        type="button"
        className="annotation-entry-edit"
        aria-label={`Edit ${segment.name}`}
        onClick={() => onSelect(segment, true)}
      >
        Edit
      </button>
      {editing && (
        <SegmentationSegmentEditor
          segment={segment}
          volumeDimensions={volumeDimensions}
          onUpdate={onUpdate}
          onSave={onSave}
        />
      )}
    </li>
  );
}

export function SegmentationSegmentList({
  segments,
  selectedSegment,
  editingSegmentId,
  volumeDimensions,
  onAddSegment,
  onSelectSegment,
  onUpdateSegment,
  onSaveSegmentPatch,
}) {
  return (
    <div className="segmentation-segment-panel">
      <div className="segmentation-panel-title">
        <h4>Segments</h4>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAddSegment}>
          Add new segment
        </button>
      </div>
      <ul className="segmentation-segment-list" data-testid="segmentation-segment-list">
        {segments.length === 0 && (
          <li className="muted">No segments yet. Choose an orientation, then add one.</li>
        )}
        {segments.map((segment) => (
          <SegmentationSegmentRow
            key={segment.id}
            segment={segment}
            selected={selectedSegment?.id === segment.id}
            editing={editingSegmentId === segment.id}
            volumeDimensions={volumeDimensions}
            onSelect={onSelectSegment}
            onUpdate={onUpdateSegment}
            onSave={onSaveSegmentPatch}
          />
        ))}
      </ul>
    </div>
  );
}
