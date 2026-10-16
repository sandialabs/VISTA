/**
 * Manual "Other" annotation creation modal. Hidden in read-only sessions.
 */
export function OtherAnnotationModal({
  readOnly,
  otherAnnotationModalVisible,
  closeOtherAnnotationModal,
  annotationDraft,
  setAnnotationDraft,
  configuredDefectTypes,
  selectedPart,
  createAnnotation,
}) {
  if (readOnly || !otherAnnotationModalVisible) return null;
  return (
    <div className="modal" style={{ display: 'flex' }} onClick={closeOtherAnnotationModal}>
      <div className="modal-content workbench-utility-modal other-annotation-modal" role="dialog" aria-label="Other annotation" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Other Annotation</h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close other annotation"
            onClick={closeOtherAnnotationModal}
          >
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="measurement-fields">
            <select
              aria-label="Annotation defect type"
              value={annotationDraft.defect_class}
              onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, defect_class: event.target.value }))}
            >
              <option value="">Defect type</option>
              {configuredDefectTypes.map((defectType) => (
                <option key={defectType} value={defectType}>{defectType}</option>
              ))}
              <option value="Other">Other</option>
            </select>
            <input
              type="text"
              placeholder="annotation modality"
              value={annotationDraft.modality}
              onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, modality: event.target.value }))}
            />
            <select
              aria-label="Annotation disposition"
              value={annotationDraft.disposition}
              onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, disposition: event.target.value }))}
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
              placeholder="measurement name"
              value={annotationDraft.measurement_name}
              onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, measurement_name: event.target.value }))}
            />
            <input
              type="number"
              placeholder="measurement value"
              value={annotationDraft.measurement_value}
              onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, measurement_value: event.target.value }))}
            />
            <input
              type="text"
              placeholder="annotation comment"
              value={annotationDraft.comment}
              onChange={(event) => setAnnotationDraft((prev) => ({ ...prev, comment: event.target.value }))}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeOtherAnnotationModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={createAnnotation}
              disabled={!selectedPart || !annotationDraft.defect_class.trim()}
            >
              Save annotation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
