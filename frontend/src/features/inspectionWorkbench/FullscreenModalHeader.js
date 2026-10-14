export function FullscreenModalHeader({ readOnly, model, modal, tools, display, fullscreenHandlers, handlers }) {
  const {
    isMprFullscreen,
  } = model;
  const {
    fullscreenImageModal,
  } = modal;
  const {
    fullscreenMeasureActive,
    fullscreenBoxActive,
    fullscreenCropActive,
  } = tools;
  const {
    annotationsVisible,
  } = display;
  const {
    closeFullscreenImageModal,
    toggleFullscreenMeasure,
    toggleFullscreenBox,
    toggleFullscreenCrop,
  } = fullscreenHandlers;
  const {
    resetFullscreenImageZoom,
    setAnnotationsVisible,
  } = handlers;
  return (
          <div className="modal-header">
            <h3>{fullscreenImageModal.label}</h3>
            <div className="workbench-detail-actions">
	              <label className="annotation-display-toggle">
	                <input
	                  type="checkbox"
	                  checked={annotationsVisible}
	                  onChange={(event) => setAnnotationsVisible(event.target.checked)}
	                />
	                Show annotations
	              </label>
	              <button type="button" className={`btn btn-secondary ${fullscreenMeasureActive ? 'active' : ''}`} disabled={readOnly} onClick={toggleFullscreenMeasure}>
	                {fullscreenMeasureActive ? 'Done Measuring' : 'Measure'}
	              </button>
                  <button type="button" className="btn btn-secondary" onClick={resetFullscreenImageZoom}>
                    Reset zoom
                  </button>
	              <button type="button" className={`btn btn-secondary ${fullscreenBoxActive ? 'active' : ''}`} disabled={readOnly} onClick={toggleFullscreenBox}>
	                Draw box
	              </button>
                  {!isMprFullscreen && (
	                    <button type="button" className={`btn btn-secondary ${fullscreenCropActive ? 'active' : ''}`} disabled={readOnly} onClick={toggleFullscreenCrop}>
                      New Crop
                    </button>
                  )}
	              <button type="button" className="modal-close-btn" aria-label="Close fullscreen image" onClick={closeFullscreenImageModal}>&times;</button>
	            </div>
          </div>
  );
}
