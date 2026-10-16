import {
  DEFAULT_SEGMENT_COLOR,
  SEGMENTATION_HELPER_TOOLS,
  SEGMENTATION_POINT_MARKER_TOOLS,
} from './segmentationConfig';
import { SegmentationToolIcon } from './SegmentationToolIcon';

export function SegmentationOperationToolbar({
  operation,
  pendingSelection,
  selectedSegment,
  sliceSummary,
  onSetOperation,
  onCommitPendingSelection,
}) {
  return (
    <div className="segmentation-helper-toolbar">
      <div className="segmentation-operation-buttons" aria-label="Selection operation">
        <button type="button" className={operation === 'add' ? 'active' : ''} onClick={() => onSetOperation('add')}>
          Add
        </button>
        <button type="button" className={operation === 'subtract' ? 'active' : ''} onClick={() => onSetOperation('subtract')}>
          Subtract
        </button>
        <button type="button" disabled={!pendingSelection} onClick={() => onCommitPendingSelection('add')}>
          Add selection
        </button>
        <button type="button" disabled={!pendingSelection} onClick={() => onCommitPendingSelection('subtract')}>
          Subtract selection
        </button>
      </div>
      <div className="segmentation-helper-current">
        <span className="segmentation-segment-color" style={{ backgroundColor: selectedSegment?.color || DEFAULT_SEGMENT_COLOR }} />
        <strong>{selectedSegment?.name || 'No segment'}</strong>
        <span>{sliceSummary}</span>
      </div>
    </div>
  );
}

function SegmentationToolModeSwitch({ tool, selectedMode, view, onSelectMode }) {
  return (
    <div
      className="segmentation-tool-mode-switch"
      role="group"
      aria-label={`${tool.label} dimensional mode`}
    >
      {tool.modes.map((mode) => (
        <button
          key={mode}
          type="button"
          className={selectedMode === mode ? 'active' : ''}
          aria-pressed={selectedMode === mode}
          aria-label={`${tool.label} ${mode.toUpperCase()} mode`}
          title={`${mode.toUpperCase()} · ${tool.modeLabels?.[mode] || mode}`}
          disabled={view === '3d' && mode === '2d'}
          onClick={() => onSelectMode(tool.id, mode)}
        >
          {mode.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function SegmentationToolTile({ tool, selected, view, selectedMode, onSelectTool, onSelectMode }) {
  const supports3d = tool.modes?.includes('3d');
  const disabledInView = view === '3d';
  return (
    <div
      className={`segmentation-tool-tile ${selected ? 'active' : ''} ${selected && supports3d ? 'has-mode-switch' : ''}`}
    >
      <button
        type="button"
        className={`segmentation-tool-select ${selected ? 'active' : ''}`}
        title={disabledInView ? 'Return to X, Y, or Z to edit the volume.' : tool.detail}
        aria-label={`${tool.label}: ${tool.detail}`}
        data-tooltip={`${tool.label}: ${tool.detail}`}
        disabled={disabledInView}
        onClick={() => onSelectTool(tool.id)}
      >
        <SegmentationToolIcon icon={tool.icon} />
        <span className="segmentation-tool-label">{tool.label}</span>
      </button>
      {selected && supports3d && (
        <SegmentationToolModeSwitch tool={tool} selectedMode={selectedMode} view={view} onSelectMode={onSelectMode} />
      )}
    </div>
  );
}

export function SegmentationToolsGrid({ tool, view, getActiveToolMode, onSelectTool, onSelectMode }) {
  return (
    <div className="segmentation-tools-grid" aria-label="Segmentation tools">
      {SEGMENTATION_HELPER_TOOLS.map((entry) => (
        <SegmentationToolTile
          key={entry.id}
          tool={entry}
          selected={tool === entry.id}
          view={view}
          selectedMode={getActiveToolMode(entry.id)}
          onSelectTool={onSelectTool}
          onSelectMode={onSelectMode}
        />
      ))}
    </div>
  );
}

function SegmentationRangeParameter({ id, label, min, max, value, suffix = '', onChange }) {
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value}{suffix}</output>
    </label>
  );
}

export function SegmentationToolParameters({ state, actions, activeTool, activeToolMode }) {
  const { tool, brushSize, sensitivity, volumeLoading, volumeStatus, pendingSelection } = state;
  return (
    <div className="segmentation-tool-parameters">
      <SegmentationRangeParameter id="segmentation-brush-size" label="Brush size" min="2" max="80" value={brushSize} suffix="px" onChange={actions.setBrushSize} />
      <SegmentationRangeParameter id="segmentation-sensitivity" label="Sensitivity" min="2" max="96" value={sensitivity} onChange={actions.setSensitivity} />
      <p className="muted">
        <strong>{activeToolMode.toUpperCase()} · {activeTool.modeLabels?.[activeToolMode] || 'Slice'}</strong>
        {' — '}
        {activeTool.detail}
      </p>
      {SEGMENTATION_POINT_MARKER_TOOLS.has(tool) && (
        <p className="muted">Defined points are shown as dots on the slice. Double-click closes polygon selections.</p>
      )}
      {(volumeLoading || volumeStatus) && (
        <p
          className={`segmentation-volume-status ${pendingSelection?.truncated ? 'warning' : ''}`}
          role="status"
          aria-live="polite"
        >
          {volumeLoading ? 'Building 3D preview…' : volumeStatus}
        </p>
      )}
    </div>
  );
}
