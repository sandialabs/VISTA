function Pt3FocusedContext({ selectedPart, summary, inspectorHotkeys }) {
  const { batchCount, partCount, reviewSummary } = summary;
  return (
    <div className="pt3-mpr-context">
      <strong>{selectedPart?.display_name || selectedPart?.serial_number || 'No part selected'}</strong>
      <span>Batches: {batchCount}</span>
      <span>Parts: {partCount}</span>
      <span>Passed: {reviewSummary.pass}</span>
      <span>Rejected: {reviewSummary.reject_confirmed + reviewSummary.reject_pending}</span>
      <span className="pt3-hotkey-hints" data-testid="inspector-hotkey-hints">
        Hotkeys: pass ({inspectorHotkeys.accept_classification.toUpperCase()}), reject (
        {inspectorHotkeys.reject_classification.toUpperCase()}), shortcuts help (
        {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}).
      </span>
    </div>
  );
}

const REVIEW_BUTTONS = [
  { className: 'btn btn-success', state: 'pass', label: 'Pass' },
  { className: 'btn btn-secondary', state: 'unreviewed', label: 'Reset' },
  { className: 'btn btn-danger', state: 'reject_confirmed', label: 'Reject' },
];

function Pt3ReviewButtons({ selectedPart, review }) {
  const { readOnly, savingPartId, onReview } = review;
  return REVIEW_BUTTONS.map(({ className, state, label }) => (
    <button
      key={state}
      className={className}
      disabled={readOnly || savingPartId === selectedPart.id}
      onClick={() => onReview(selectedPart, state)}
    >
      {label}
    </button>
  ));
}

function Pt3ShortcutHelp({ inspectorHotkeys }) {
  return (
    <div className="workbench-notice" data-testid="shortcut-help-panel">
      <strong>Shortcut help</strong>
      <ul>
        <li>Mark Pass: {inspectorHotkeys.accept_classification.toUpperCase()}</li>
        <li>Reject: {inspectorHotkeys.reject_classification.toUpperCase()}</li>
        <li>Toggle this help: {inspectorHotkeys.toggle_shortcut_help.toUpperCase()}</li>
      </ul>
    </div>
  );
}

export function Pt3FocusedWorkbench({
  detailsRef,
  selectedPart,
  summary,
  inspectorHotkeys,
  review,
  shortcutHelpVisible,
  onOpenPartSelection,
  onOpenMetadata,
  mprViewport,
  annotationsPane,
  workbenchModal,
}) {
  return (
    <div className="workbench-details workbench-details-pt3" ref={detailsRef}>
      <div className="pt3-mpr-topbar">
        <Pt3FocusedContext selectedPart={selectedPart} summary={summary} inspectorHotkeys={inspectorHotkeys} />
        <div className="workbench-detail-actions">
          <button type="button" className="btn btn-secondary" onClick={onOpenPartSelection}>
            Part Selection
          </button>
          <button type="button" className="btn btn-secondary" disabled={!selectedPart} onClick={onOpenMetadata}>
            Metadata
          </button>
          {selectedPart && <Pt3ReviewButtons selectedPart={selectedPart} review={review} />}
        </div>
      </div>
      {shortcutHelpVisible && <Pt3ShortcutHelp inspectorHotkeys={inspectorHotkeys} />}
      <div className="pt3-inspection-layout" data-testid="pt3-inspection-layout">
        <div className="pt3-mpr-center">
          {mprViewport}
        </div>
        <aside className="pt3-annotations-column" aria-label="PT3 annotations">
          {annotationsPane}
        </aside>
      </div>
      {workbenchModal}
    </div>
  );
}
