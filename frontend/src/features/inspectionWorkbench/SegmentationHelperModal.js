import { SEGMENTATION_HELPER_TOOLS, SEGMENTATION_HELPER_VIEWS } from './segmentationConfig';
import { MPR_AXES, MPR_AXIS_CONFIG } from './mprConstants';
import { SegmentationSegmentList } from './SegmentationSegmentList';
import { SegmentationMlPanel } from './SegmentationMlPanel';
import {
  SegmentationOperationToolbar,
  SegmentationToolParameters,
  SegmentationToolsGrid,
} from './SegmentationToolPanel';
import {
  SegmentationMprGrid,
  SegmentationSliceStage,
  SegmentationVolumeStage,
} from './SegmentationWorkspaceViews';

const TAB_NAVIGATION_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

function handleViewTabKeyDown(event) {
  if (!TAB_NAVIGATION_KEYS.includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]'));
  const currentIndex = Math.max(0, tabs.indexOf(document.activeElement));
  const nextIndex = event.key === 'Home'
    ? 0
    : (event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length);
  event.preventDefault();
  tabs[nextIndex]?.focus();
  tabs[nextIndex]?.click();
}

function SegmentationViewTabs({ view, onSelectView }) {
  return (
    <nav
      className="segmentation-helper-view-tabs"
      role="tablist"
      aria-label="Segmentation workspace views"
      onKeyDown={handleViewTabKeyDown}
    >
      {SEGMENTATION_HELPER_VIEWS.map((entry) => (
        <button
          key={entry.id}
          id={`segmentation-view-tab-${entry.id}`}
          type="button"
          role="tab"
          aria-selected={view === entry.id}
          tabIndex={view === entry.id ? 0 : -1}
          aria-controls={`segmentation-view-panel-${entry.id}`}
          className={view === entry.id ? 'active' : ''}
          title={entry.detail}
          onClick={() => onSelectView(entry)}
        >
          <strong>{entry.label}</strong>
          {entry.plane && <small>{entry.plane}</small>}
        </button>
      ))}
    </nav>
  );
}

function SegmentationSliceSliders({ slicePosition, mprDimensions, onSliceChange }) {
  return (
    <div className="segmentation-slice-sliders" aria-label="Slice navigation">
      {MPR_AXES.map((sliceAxis) => {
        const sliceUpper = Math.max(0, (mprDimensions[sliceAxis] || 1) - 1);
        return (
          <label key={sliceAxis} htmlFor={`segmentation-helper-slice-${sliceAxis}`}>
            <span>{MPR_AXIS_CONFIG[sliceAxis]?.sliceLabel || sliceAxis.toUpperCase()}</span>
            <input
              id={`segmentation-helper-slice-${sliceAxis}`}
              type="range"
              min="0"
              max={sliceUpper}
              value={slicePosition[sliceAxis]}
              onChange={(event) => onSliceChange(sliceAxis, event.target.value, mprDimensions)}
            />
            <output>{slicePosition[sliceAxis]} / {sliceUpper}</output>
          </label>
        );
      })}
    </div>
  );
}

function SegmentationHelperSidebar({ state, config, sliceImage, selectedSegment, volumeDimensions, handlers }) {
  const { slicePosition } = sliceImage;
  return (
    <aside className="segmentation-helper-sidebar" aria-label="Segmentation helper controls">
      <div className="segmentation-helper-view-summary">
        <span className="segmentation-helper-axis-dot" style={{ background: config.color }} />
        <div>
          <strong>{SEGMENTATION_HELPER_VIEWS.find((view) => view.id === state.view)?.detail}</strong>
          <small>Crosshair: X {slicePosition.sagittal}, Y {slicePosition.coronal}, Z {slicePosition.axial}</small>
        </div>
      </div>
      <SegmentationSliceSliders
        slicePosition={slicePosition}
        mprDimensions={sliceImage.mprDimensions}
        onSliceChange={handlers.onSliceChange}
      />
      <SegmentationSegmentList
        segments={state.segments}
        selectedSegment={selectedSegment}
        editingSegmentId={state.editingSegmentId}
        volumeDimensions={volumeDimensions}
        onAddSegment={handlers.onAddSegment}
        onSelectSegment={handlers.onSelectSegment}
        onUpdateSegment={handlers.onUpdateSegment}
        onSaveSegmentPatch={handlers.onSaveSegmentPatch}
      />
    </aside>
  );
}

function SegmentationWorkspace({ state, axis, ...props }) {
  if (state.view === 'mpr') {
    return (
      <SegmentationMprGrid
        segments={state.segments}
        pendingVolumePreviewSegment={props.pendingVolumePreviewSegment}
        sliceImage={props.sliceImage}
        volumeDimensions={props.volumeDimensions}
        getCanonicalSliceIndex={props.getCanonicalSliceIndex}
        onFocusAxis={props.handlers.onFocusAxis}
      />
    );
  }
  if (state.view === '3d') {
    return <SegmentationVolumeStage viewer={props.volumeViewer} surfacePreviewTruncated={props.surfacePreviewTruncated} />;
  }
  return (
    <SegmentationSliceStage
      state={state}
      axis={axis}
      canonicalSliceIndex={props.getCanonicalSliceIndex(axis, Number(props.sliceImage.slicePosition[axis] || 0))}
      activeToolMode={props.activeToolMode}
      selectedSegment={props.selectedSegment}
      pendingVolumePreviewSegment={props.pendingVolumePreviewSegment}
      sliceImage={props.sliceImage}
      volumeDimensions={props.volumeDimensions}
      stageHandlers={props.stageHandlers}
    />
  );
}

function SegmentationHelperMain({ state, actions, axis, config, ...props }) {
  const { handlers, sliceImage } = props;
  const activeTool = SEGMENTATION_HELPER_TOOLS.find((tool) => tool.id === state.tool) || SEGMENTATION_HELPER_TOOLS[0];
  const activeToolMode = props.getActiveToolMode(activeTool.id);
  const upper = Math.max(0, (sliceImage.mprDimensions[axis] || 1) - 1);
  return (
    <main
      id={`segmentation-view-panel-${state.view}`}
      className="segmentation-helper-main"
      role="tabpanel"
      aria-labelledby={`segmentation-view-tab-${state.view}`}
      aria-label="Segmentation helper workspace"
    >
      <SegmentationOperationToolbar
        operation={state.operation}
        pendingSelection={state.pendingSelection}
        selectedSegment={props.selectedSegment}
        sliceSummary={`${config.sliceLabel} ${sliceImage.slicePosition[axis]} / ${upper}`}
        onSetOperation={actions.setOperation}
        onCommitPendingSelection={handlers.onCommitPendingSelection}
      />
      <SegmentationToolsGrid
        tool={state.tool}
        view={state.view}
        getActiveToolMode={props.getActiveToolMode}
        onSelectTool={handlers.onSelectTool}
        onSelectMode={handlers.onSelectToolMode}
      />
      <SegmentationToolParameters state={state} actions={actions} activeTool={activeTool} activeToolMode={activeToolMode} />
      {state.tool === 'ml-helper' && <SegmentationMlPanel state={state} actions={actions} />}
      <SegmentationWorkspace state={state} axis={axis} activeToolMode={activeToolMode} {...props} />
    </main>
  );
}

/**
 * PT3 segmentation helper dialog. State lives in `useSegmentationHelper`; the
 * panel supplies slice imagery, the 3D viewer element, and handlers that own
 * pointer sessions, persistence, and MPR navigation.
 */
export function SegmentationHelperModal({ state, actions, dialogRef, closeButtonRef, onClose, ...props }) {
  const axis = MPR_AXES.includes(state.axis) ? state.axis : 'axial';
  const config = MPR_AXIS_CONFIG[axis] || MPR_AXIS_CONFIG.axial;
  return (
    <div className="modal segmentation-helper-modal" style={{ display: 'flex' }} onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-content segmentation-helper-modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="Segmentation Helpers"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header segmentation-helper-header">
          <div>
            <h3>Segmentation Helpers</h3>
            <p className="muted">Linked slice and volumetric tools for PT3 segment masks.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="modal-close-btn"
            aria-label="Close Segmentation Helpers"
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <SegmentationViewTabs view={state.view} onSelectView={props.handlers.onSelectView} />
        <div className="segmentation-helper-body">
          <SegmentationHelperSidebar
            state={state}
            config={config}
            sliceImage={props.sliceImage}
            selectedSegment={props.selectedSegment}
            volumeDimensions={props.volumeDimensions}
            handlers={props.handlers}
          />
          <SegmentationHelperMain state={state} actions={actions} axis={axis} config={config} {...props} />
        </div>
      </div>
    </div>
  );
}
