import { getAnnotationListType, getAnnotationListValue } from './annotationListHelpers';
import { DEFAULT_ANNOTATION_COLOR, normalizeAnnotationTransparencyPercent } from './inspectionAnnotationDisplay';
import { buildAnnotationEditModel } from './annotationEditModel';

export function AnnotationEditModal(props) {
  const {
    annotationEditModalVisible,
    annotationEditDraft,
    selectedInspectionOverlayStyleTarget,
    inspectionAnnotationItems,
    annotations,
    selectedAnnotationId,
    configuredDefectTypes,
    closeAnnotationEditModal,
    readOnly,
    setAnnotationEditDraft,
    updateAnnotationFromModal,
  } = props;
  if (!annotationEditModalVisible) return null;
  const model = buildAnnotationEditModel({
    annotationEditDraft,
    selectedInspectionOverlayStyleTarget,
    inspectionAnnotationItems,
    annotations,
    selectedAnnotationId,
    configuredDefectTypes,
  });
  if (!model) return null;
  const {
    selectedItem,
    selected,
    selectedOverlay,
    isExternalOverlayConfig,
    draft,
    currentDefectClass,
    editDefectTypes,
    transparencyPercent,
  } = model;
  return (
    <div className="modal" style={{ display: 'flex' }} onClick={closeAnnotationEditModal}>
      <div className="modal-content workbench-utility-modal" role="dialog" aria-label="Edit annotation" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Annotation Details</h3>
          <button
            type="button"
            className="modal-close-btn modal-close-danger"
            aria-label="Cancel edit annotation"
            onClick={closeAnnotationEditModal}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {!isExternalOverlayConfig && (
            <>
              <div className="measurement-fields">
                <select
                  aria-label="Edit annotation defect type"
                  value={currentDefectClass}
                  disabled={readOnly}
                  onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), defect_class: event.target.value }))}
                >
                  <option value="">Defect type</option>
                  {editDefectTypes.map((defectType) => (
                    <option key={defectType.toLocaleLowerCase()} value={defectType}>{defectType}</option>
                  ))}
                </select>
                <select
                  aria-label="Edit annotation disposition"
                  value={draft.disposition}
                  disabled={readOnly}
                  onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), disposition: event.target.value }))}
                >
                  <option value="open">Open</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="reject_part">Reject Part</option>
                  <option value="needs_info">Needs Info</option>
                </select>
              </div>
              <div className="measurement-fields">
                <input
                  type="text"
                  aria-label="Edit annotation comment"
                  value={draft.comment}
                  readOnly={readOnly}
                  onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), comment: event.target.value }))}
                />
              </div>
            </>
          )}
          <div className="measurement-fields annotation-style-fields">
            <div className="annotation-details-summary" aria-label="Annotation details">
              <span><strong>Type</strong> {isExternalOverlayConfig ? 'External overlay' : getAnnotationListType(selected)}</span>
              <span><strong>Display</strong> {isExternalOverlayConfig ? selectedItem?.displayName || selectedItem?.label : getAnnotationListValue(selected)}</span>
              {isExternalOverlayConfig && selectedOverlay?.filename && <span><strong>File</strong> {selectedOverlay.filename}</span>}
            </div>
          </div>
          <div className="measurement-fields annotation-style-fields">
            <label htmlFor="edit-annotation-color">
              Overlay color
              <input
                id="edit-annotation-color"
                type="color"
                aria-label="Edit annotation overlay color"
                value={draft.color || DEFAULT_ANNOTATION_COLOR}
                disabled={readOnly}
                onChange={(event) => setAnnotationEditDraft((prev) => ({ ...(prev || draft), color: event.target.value }))}
              />
            </label>
            <label htmlFor="edit-annotation-transparency">
              Overlay transparency
              <input
                id="edit-annotation-transparency"
                type="number"
                aria-label="Edit annotation overlay transparency percent"
                min="0"
                max="100"
                step="1"
                value={transparencyPercent}
                disabled={readOnly}
                onChange={(event) => {
                  const nextTransparency = normalizeAnnotationTransparencyPercent(event.target.value);
                  setAnnotationEditDraft((prev) => ({
                    ...(prev || draft),
                    transparency_percent: nextTransparency,
                    fill_opacity: Number((1 - (nextTransparency / 100)).toFixed(2)),
                  }));
                }}
              />
              <span className="annotation-style-unit">%</span>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeAnnotationEditModal}>{readOnly ? 'Close' : 'Cancel'}</button>
            {!readOnly && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={updateAnnotationFromModal}
                disabled={!isExternalOverlayConfig && !currentDefectClass}
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
